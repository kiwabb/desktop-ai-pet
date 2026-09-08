# 桌面 AI 白猫技术架构

> 2026-09-08：本文描述当前实际运行的双模式架构。服务端模式的链路细节与决策依据见 [服务端智能体架构](SERVER_AGENT_ARCHITECTURE.md)。

本文解释桌宠窗口、2D 动画和 AI 对话之间的边界。桌面端支持两种助手模式，可在设置页切换：**服务端模式**（连接独立 Python 智能体服务）与**单机模式**（不启动服务端，由桌面端 Rust 直调 OpenAI 兼容模型端点）。

## 运行边界

```text
macOS / Windows
└─ Tauri 2
   ├─ Rust 原生层
   │  ├─ 宠物透明置顶窗口
   │  ├─ 对话透明置顶窗口
   │  ├─ 模式分发：backend::server / backend::local
   │  ├─ 单机运行时：local_agent（工具循环）+ llm（SSE 客户端）
   │  ├─ 本地持久化：SQLite（agent-local.db）
   │  └─ 凭据存储：OS Keychain / Credential Manager / Secret Service
   └─ React WebView
      ├─ PetStage
      ├─ ChatPanel
      ├─ PetState 状态机
      └─ LayeredPetRenderer
         ├─ idle.png
         ├─ blink.png
         └─ talk.png
```

## 双窗口

宠物窗口保持小尺寸，避免透明区域拦截桌面点击。聊天使用独立窗口按需显示，两个窗口通过 Tauri 事件同步宠物状态。

macOS 将两个窗口转换为浮动 `NSPanel`，并启用跨 Space 和全屏辅助标志。应用不能覆盖登录界面、锁屏、屏幕保护程序或受系统保护的安全界面。

## 2D 动画

`pet-2d-renderer.ts` 预加载三张 `1207×1303` 透明 PNG。它根据 `idle`、`curious`、`thinking`、`talking`、`happy`、`sleeping` 和 `error` 状态切换画面，并安排随机眨眼。

CSS 负责呼吸、轻微位移、说话切帧和拖拽形变。三张图片共用相同画布和角色位置，因此状态切换不会改变白猫轮廓。

应用只加载上述 PNG，不加载任何骨骼工程、Atlas 或 3D 模型。

## 双模式对话链路

前端从不直连模型或 Python 服务：一律 `invoke()` 八个 `agent_*` 命令，并监听唯一的 `agent:view` 事件接收同构的 `AgentView` 快照投影。模式切换发生在 Rust 内部（`backend/mod.rs` 按已保存的 mode 分发），前端零分支。

```text
服务端模式：
React → src/lib/agent.ts → Tauri commands → backend::server
   → WebSocket 控制通道 + HTTP → Python 服务（FastAPI + LangGraph）
   → 模型服务 / PostgreSQL / Redis

单机模式：
React → src/lib/agent.ts → Tauri commands → backend::local
   → local_agent 运行时（系统提示词 + 历史窗口 + ≤8 步工具循环）
   → llm（reqwest + eventsource-stream 的 OpenAI 兼容 SSE）
   → 模型服务；会话/待办落本地 SQLite；提醒到期本地扫描
```

两种模式产出同一事件模型与快照投影（`agent_protocol.rs`），经同一个 `agent:view` 出口推送；`connection` / `model_configured` 等状态字段在两种模式下语义同构。

## 模式切换与配置

设置页选择模式，两套配置共存于应用配置目录的 `agent-config.json`（临时文件 + rename 原子写入，Unix 上 0600），切换互不覆盖。保存即递增 generation、中止旧链路任务，按新模式重建后端，不串台。

- 服务端模式配置：服务地址 + 设备凭证（设备凭证保存在上述 0600 私有文件中）。
- 单机模式配置：模型服务地址（远程强制 HTTPS，仅回环允许 HTTP）+ API Key + 模型名称；支持 `GET {base_url}/models` 拉取模型列表下拉选择，接口不可用时回退手输。

**单机模式 API Key 不落盘**：保存在 OS 凭据存储（macOS Keychain / Windows Credential Manager / Linux Secret Service，service `desktop-ai-pet`、account `local-llm-api-key`）。旧版本配置文件中的明文 key 会在启动时迁入凭据存储并擦除配置文件字段。浏览器存储、日志和 `AgentView` 都只暴露"是否已配置"布尔值，不出现 key 本身。

环境变量 `PET_AGENT_MODEL_BASE_URL` / `PET_AGENT_MODEL_API_KEY` / `PET_AGENT_MODEL_NAME` 作为单机模式默认值回退，仅填充未配置的字段（见根 `.env.example`）。

## 状态转换

```text
idle ──发送──> thinking ──首个 token──> talking ──done──> happy ──900ms──> idle
                               └──错误──────────────────────> error
```

## 验收边界

- `pnpm pet2d:validate` 证明三张图片对齐，并且旧渲染依赖未进入运行边界。
- `pnpm build` 证明前端可以编译，不证明桌面窗口可见。
- 可见 Tauri 窗口证明桌面运行，不证明 AI 服务已调用。
- 界面收到并显示真实流式增量，才证明对话链路完成。
- `node tools/verify-chat-interaction.mjs` 与 `node tools/verify-pet-live-status.mjs` 覆盖前端契约回归；`node tools/verify-local-agent.mjs` 覆盖单机模式的结构回归（凭据落盘卫生、命令注册、模式文案）；`cargo test` 覆盖 SSE 解析、工具循环与本地存储行为。真实模型端点需手动验收。
