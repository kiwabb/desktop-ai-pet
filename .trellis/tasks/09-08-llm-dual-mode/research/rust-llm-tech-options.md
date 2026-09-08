# Research: Rust 单机模式 LLM 技术选型

- Query: Rust 直连 LLM 提供商的 HTTP/SSE 流式方案、Tauri 2 集成方式、Provider 抽象、流式传输到前端、风险
- Scope: mixed(内部代码 + 外部生态调研)
- Date: 2026-09-08

## 0. 仓库现状(内部调研结论)

- Python server(`server/`)仅使用 **OpenAI 兼容协议**:`pyproject.toml` 依赖 `langchain` + `langchain-openai`;`server/app/config.py:13-15` 配置为 `model_base_url`(默认 `https://api.openai.com/v1`)、`model_api_key`、`model_name`,超时 90s(`PET_AGENT_MODEL_TIMEOUT_SECONDS`)。**没有 Anthropic/Gemini 等第二套 SDK**——"其他 provider" 全部通过 base_url 可配置的 OpenAI 兼容端点接入。
- Rust 端 `src-tauri/Cargo.toml` 已有:`reqwest 0.12`(features: `json`, `stream`, `rustls-tls`)、`tokio`、`futures-util`、`serde/serde_json`。**实现 SSE 流式无需新增 HTTP 依赖**。
- 前端 `src/lib/ai.ts` 已经定义了 `ai_status` / `save_ai_settings` / `list_ai_models` / `stream_chat` 的 invoke 接口(`ChatRequest{requestId, messages}`,流事件类型 `AiStreamEvent{requestId, kind:'chunk'|'done', content}`),但 `src-tauri/src/lib.rs:431-445` 的 invoke_handler **尚未注册这些命令**——Rust 侧是绿地,接口契约可由前端现有代码反推。
- 现有 `agent_client.rs` 通过 `app_handle.emit('agent:view', ...)`(Emitter trait)向前端推快照,前端用 `listen` 消费——仓库已有事件总线模式可循。

---

## 1. Rust HTTP/SSE 客户端方案对比

数据来源:crates.io API(2026-09-08 抓取)。

| 方案 | 最新版本 / 最近更新 | 下载量 | 流式(SSE) | Tool Calling | 新增依赖成本 | 评估 |
|---|---|---|---|---|---|---|
| **reqwest + 手动解析 SSE** | reqwest 0.13.4 / 2026-05(本项目用 0.12) | — | `bytes_stream()` 自行按 `\n\n` 切分 | 自行定义 serde 结构 | **0 个新 crate** | 依赖最少,但需自行处理多行 `data:`、心跳注释、`[DONE]` 等边界 |
| **reqwest + eventsource-stream** | eventsource-stream 0.2.3 / 2022-02 | 2112 万 | 把 `Stream<Item=Bytes>` 适配为 SSE 事件流 | 自行定义 serde 结构 | +1 crate(代码冻结但稳定,async-openai 内部也在用) | **推荐**:SSE 解析久经考验,其余自控 |
| reqwest-eventsource | 0.6.0 / 2024-03 | 1085 万 | 高层封装(含自动重连) | 自行定义 | +1 crate | 自动重连对 LLM 流是**负资产**(重连会重新计费/重复生成),不适合 |
| **async-openai** | 0.41.3 / 2026-07(活跃) | 795 万 | `create_stream()` 内置 SSE | **完整类型**(chat completion chunk、tool_calls delta) | +27 个传递依赖(实测 crates.io 依赖列表) | 功能最全、维护最活跃;支持 OpenAI 兼容端点(`with_api_base`)、Azure、自带限流重试 |
| genai | 0.7.0-beta.23 / 2026-09(非常活跃) | 36 万 | 支持 | 支持 | 中等 | 多 provider 原生协议(OpenAI/Anthropic/Gemini/xAI/Ollama/Groq/DeepSeek/Kimi 等 26+),自定义 OpenAI 兼容端点走 `GENAI_{n}_ENDPOINT` 环境变量或 ServiceTargetResolver;仍处于 0.x beta,API 变动风险 |
| rig-core | 0.42.0 / 2026-08(活跃) | 261 万 | 支持 | 支持(agent 抽象) | 较大 | 偏 agent 框架;README 明确警告 "Here be dragons",频繁 breaking changes |
| llm-chain | 0.13.0 / **2023-11(停更)** | 9.5 万 | — | — | — | **排除**:近 3 年未更新 |

### 推荐结论

**首选:reqwest(现有)+ eventsource-stream,自行用 serde 定义 Chat Completion chunk 类型。**

理由:
1. 本项目服务器端只走 OpenAI 兼容协议(langchain-openai + 可配 base_url),不需要 async-openai 的全量 API 面(Assistants/Realtime/Audio 等 27 个传递依赖纯属浪费)。
2. `Cargo.toml` 已有 reqwest(json+stream+rustls)+ futures-util,加 eventsource-stream 后**仅 +1 个 crate**。
3. 自有类型便于在流 chunk 里同时抽出 `delta.content` 与 `delta.tool_calls`(OpenAI 兼容端点 deepseek/kimi/qwen 等均遵循此格式),未来扩展 tool calling 无阻碍。
4. reqwest-eventsource 的自动重连语义对 LLM 生成流有害,排除。

**次选:async-openai**(feature `chat-completion`)。若后续要快速支持完整 tool calling 流程、限流重试、Azure 兼容,它的类型系统现成,代价是依赖体积。切换成本低——HTTP 层语义相同。

---

## 2. Tauri 2 特定问题

| 问题 | 结论 |
|---|---|
| tokio 运行时 | Tauri 2 命令标注 `async` 后自动运行在 Tauri 内嵌 tokio 运行时上;`tauri::async_runtime::spawn` 可派生后台任务(本项目 `agent_client.rs:46` 已用 `tauri::async_runtime::JoinHandle`)。reqwest 与之兼容,无需自建 Runtime。 |
| tauri-plugin-http vs 原生 reqwest | tauri-plugin-http(2.6.0, reqwest 实现)是**前端侧** fetch 替代,用于绕过 WebView CORS,通过 IPC 转发请求——多一跳 IPC、且流式消费仍要回落到 event/Channel,得不偿失。LLM 流式应在 **Rust 后端用原生 reqwest**,API key 也不经前端,更安全。 |
| 流式推送到前端 | **Channel API 是当前官方推荐**:"The Tauri channel is the recommended mechanism for streaming data such as streamed HTTP responses to the frontend"(官方文档原文,见来源)。事件系统(`emit`/`listen`)适合全局广播/快照(本项目 agent:view 即此模式),但每个 token 一次全局事件有开销且无法与单次调用绑定;Channel 是**每次 invoke 一个有序、定向的通道**,语义与 LLM 流完全匹配。 |
| API key 存储 | 见第 5 节。 |

## 3. Provider 抽象结构(镜像 Python 配置层)

Python 侧本质是「OpenAI 兼容 + 可配 base_url」的单实现。Rust 侧建议:

```rust
// src-tauri/src/llm/mod.rs
#[derive(Clone, Deserialize)]
pub struct LlmConfig {
    pub base_url: String,   // 对应 PET_AGENT_MODEL_BASE_URL,如 https://api.deepseek.com/v1
    pub api_key: String,    // 对应 PET_AGENT_MODEL_API_KEY
    pub model: String,      // 对应 PET_AGENT_MODEL_NAME
    pub timeout_secs: u64,  // 对应 PET_AGENT_MODEL_TIMEOUT_SECONDS(默认 90)
}

pub struct ChatChunk {
    pub delta: String,                       // 文本增量
    pub tool_calls: Option<Vec<serde_json::Value>>, // 预留:tool call 增量
    pub finish_reason: Option<String>,
}

#[async_trait::async_trait] // 或 Rust 1.75+ 原生 async fn in trait + BoxStream
pub trait LlmProvider: Send + Sync {
    fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Pin<Box<dyn Stream<Item = Result<ChatChunk, LlmError>> + Send>>;
    async fn list_models(&self) -> Result<Vec<String>, LlmError>; // 支撑前端 list_ai_models
}

pub struct OpenAiCompatibleProvider { config: LlmConfig, http: reqwest::Client }
// 唯一实现;base_url 由用户配置,天然覆盖 OpenAI / DeepSeek / Kimi / Qwen / 本地 Ollama(/v1)
```

要点:
- 只有一个实现 + trait,是为了与 Python 侧「配置驱动切换 provider」的语义对齐,而不是在 Rust 里复制 langchain 的多 SDK 结构。
- `base_url` 拼接注意尾部 `/` 与 `/v1` 的坑(见风险 R6)。
- 环境变量回退:Python 侧从 env 读配置,Rust 单机模式同样建议支持 `PET_AGENT_MODEL_*` 环境变量作为默认值(前端 `AiStatus.source: 'environment' | 'local_file'` 已预留此语义)。

## 4. 流式传输到前端:Channel API(推荐)+ 最小代码草图

### Rust 侧

```rust
use futures_util::StreamExt;
use tauri::ipc::Channel;

#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StreamPayload {
    Chunk { content: String },
    Done,
    Error { message: String },
}

#[tauri::command]
async fn stream_chat(
    state: tauri::State<'_, LlmState>,
    request: ChatRequest,                 // 与 src/lib/ai.ts 的 ChatRequest 对齐
    on_event: Channel<StreamPayload>,     // Tauri 自动注入,前端传入
) -> Result<(), String> {
    let provider = state.provider().ok_or("LLM 未配置")?;
    let mut stream = provider.chat_stream(request.messages);

    while let Some(item) = stream.next().await {
        match item {
            Ok(chunk) if !chunk.delta.is_empty() => {
                // 前端关闭/取消时 send 返回 Err,直接终止 HTTP 流
                if on_event.send(StreamPayload::Chunk { content: chunk.delta }).is_err() {
                    break;
                }
            }
            Ok(_) => {}
            Err(e) => {
                let _ = on_event.send(StreamPayload::Error { message: e.to_string() });
                return Ok(());
            }
        }
    }
    let _ = on_event.send(StreamPayload::Done);
    Ok(())
}
```

SSE 循环核心(reqwest + eventsource-stream):

```rust
use eventsource_stream::Eventsource;

let resp = http
    .post(format!("{}/chat/completions", config.base_url.trim_end_matches('/')))
    .bearer_auth(&config.api_key)
    .json(&serde_json::json!({
        "model": config.model, "messages": messages, "stream": true
    }))
    .timeout(Duration::from_secs(config.timeout_secs))   // 总超时;另见风险 R4
    .send().await?
    .error_for_status()?;

let mut events = resp.bytes_stream().eventsource();
while let Some(ev) = events.next().await {
    let ev = ev?;
    if ev.data == "[DONE]" { break; }                    // OpenAI 兼容流终止标记
    let chunk: ChatCompletionChunk = serde_json::from_str(&ev.data)?; // 自有 serde 类型
    // yield ChatChunk { delta: chunk.choices[0].delta.content.unwrap_or_default(), ... }
}
```

### 前端侧(对接现有 `src/lib/ai.ts`)

```ts
import { Channel, invoke } from '@tauri-apps/api/core'

type StreamPayload =
  | { kind: 'chunk'; content: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export function streamChat(request: ChatRequest, onChunk: (text: string) => void) {
  const channel = new Channel<StreamPayload>()
  channel.onmessage = (msg) => {
    if (msg.kind === 'chunk') onChunk(msg.content)
    // done / error 由调用方收尾
  }
  return invoke<void>('stream_chat', { request, onEvent: channel })
}
```

要点:
- Channel 与本次 invoke 一一对应,天然有序、不会被其他窗口的全局事件污染;
- 若需跨窗口广播最终态(如聊天气泡最终写入),可沿用现有 `emit('agent:view', ...)` 快照模式,两者不冲突。

## 5. API Key 存储建议

| 方案 | 机制 | 结论 |
|---|---|---|
| **keyring crate(4.2.0,2026-08 更新,2385 万下载)** | macOS Keychain / Windows Credential Manager / Linux Secret Service | **推荐用于 API key**:OS 级加密,不落明文文件;Rust 侧直接读写,不经前端 |
| tauri-plugin-store(2.4.4) | app 数据目录下**明文 JSON** | 仅用于非敏感设置(base_url、model 名);**不要存 key** |
| 明文本地文件(现状 `agent_client.rs` 的 Config 文件模式) | 明文 | 仅作迁移过渡;key 应迁往 keyring |

建议组合:`tauri-plugin-store`(或沿用现有本地 JSON)存非敏感配置 + `keyring` 存 `api_key`;前端 `AiStatus.source` 加 `'keychain'` 变体。

## 6. 风险清单与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | **TLS/证书**:桌面用户可能有企业代理 MITM 证书、自签内网网关。当前 `rustls-tls` feature 用 webpki-roots 内置根证书,不认系统证书库 | 将 reqwest feature 改为 `rustls-tls-native-roots`(读系统根证书;本项目 tokio-tungstenite 已用同名 feature,语义一致);文档注明自签网关需用户将 CA 加入系统信任库 |
| R2 | **代理**:部分用户走 HTTP/SOCKS5 代理 | reqwest 默认读取 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量(system proxy);如需 GUI 配置代理,用 `ClientBuilder::proxy()`。勿用 tauri-plugin-http 绕路 |
| R3 | **取消在途流**:用户中途停止生成 | (a) Channel `send` 失败即视为前端已断开,break 后 drop `Response` → reqwest 关闭连接;(b) 更可靠:把流循环放进 `tauri::async_runtime::spawn`,保存 `JoinHandle`(本项目 `agent_client.rs` 已有此模式),取消命令调用 `handle.abort()`;(c) 前端侧丢弃 Channel 引用即可触发 (a) |
| R4 | **超时**:仅设总 timeout 无法应对「连接活着但不再吐 token」的挂起 | 总超时(reqwest `.timeout()`)**叠加** chunk 间读超时:`tokio::time::timeout(Duration::from_secs(30), stream.next())` 包住每次读取;默认值对齐 Python 侧 90s 总超时 |
| R5 | **SSE 解析边界**:`data:` 跨 TCP 包、多行 data、心跳注释(`: keep-alive`)、`data: [DONE]` | 用 eventsource-stream 解决前两者(它按 SSE 规范拼缓冲);`[DONE]` 与空 delta 自行判断;心跳注释会被解析为 comment,安全忽略 |
| R6 | **base_url 拼接**:用户填 `https://host/v1/` vs `https://host/v1` vs 不带 `/v1` | 拼接前 `trim_end_matches('/')`;参照 Python 侧语义(直接信任用户输入的完整 base,含 `/v1`);`list_models` 命令(GET `/models`)可做配置自检 |
| R7 | **reqwest 版本滞后**:crates.io 最新 0.13.4,本项目 pin 0.12 | 非阻塞项;0.12 仍可用,若升级注意与 tokio-tungstenite 0.28 依赖树共存即可 |
| R8 | **错误语义差异**:各 OpenAI 兼容端点错误体格式不一(有的非标准 JSON) | 错误处理只依赖 HTTP 状态码 + 尽力解析 body 为字符串上抛,不假设错误 JSON 结构 |
| R9 | **Token 高频 IPC**:超长回复逐 token 推 Channel 的 IPC 频率 | Channel 是为流式设计的有序通道,开销低于全局 event;如 profiling 后发现瓶颈,可在 Rust 侧做 ~50ms 微批聚合(对 ChatChunk 合并后再 send) |

## 外部来源

- Tauri 官方文档 — Calling Rust from the Frontend(Channel 推荐用于流式 HTTP 响应,含代码示例):https://v2.tauri.app/develop/calling-rust/
- `tauri::ipc::Channel` API 文档(tauri 2.11.5):https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html
- async-openai(README:OpenAI 兼容 provider、SSE streaming、feature flags;chat-stream 示例):https://github.com/64bit/async-openai ,https://crates.io/crates/async-openai
- genai(多 provider 原生协议、GENAI_{n}_ENDPOINT 自定义兼容端点):https://github.com/jeremychone/rust-genai
- rig-core(README 含 breaking change 警告):https://github.com/0xPlaygrounds/rig
- crates.io 版本/维护数据(2026-09-08 查询):https://crates.io/crates/async-openai ,/genai ,/rig-core ,/llm-chain ,/eventsource-stream ,/reqwest-eventsource ,/keyring ,/tauri-plugin-store ,/tauri-plugin-http ,/reqwest
- keyring(crate,OS 凭据存储):https://crates.io/crates/keyring
- tauri-plugin-store(明文 JSON 持久化):https://github.com/tauri-apps/plugins-workspace

## 内部引用

| 文件 | 说明 |
|---|---|
| `server/pyproject.toml` | langchain + langchain-openai,OpenAI 兼容协议 |
| `server/app/config.py:13-16` | model_base_url / api_key / name / timeout 配置项 |
| `src-tauri/Cargo.toml:16-23` | 已有 reqwest 0.12(rustls/stream/json)、tokio、futures-util |
| `src/lib/ai.ts` | 前端已定义的 stream_chat 契约(待 Rust 实现) |
| `src-tauri/src/lib.rs:431-445` | invoke_handler 尚无 ai 相关命令 |
| `src-tauri/src/agent_client.rs:46` | 现有 JoinHandle 后台任务 + emit 快照模式 |

## Caveats / 未覆盖

- 未实测 eventsource-stream 与各国产 OpenAI 兼容端点(DeepSeek/Kimi/Qwen)的边缘行为(如 reasoning_content 字段),实现时建议先用一个端点做集成验证。
- async-openai 0.41 的 feature 裁剪(`chat-completion` 单独启用)后的实际传递依赖数未逐一验证,27 个是全量默认依赖数。
- genai 0.7 处于 beta,若未来确实需要 Anthropic/Gemini **原生协议**(而非 OpenAI 兼容模式),再评估切换。
- 本机访问 v2.tauri.app 偶发 TLS 错误(curl exit 35),文档内容以重试成功的抓取为准;如链接失效可用 docs.rs 的 Channel 文档替代。
