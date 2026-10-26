# Research: 提示词固定布局机制

- Query: 精读 server/app/agent_service.py:30-70 与 src-tauri/src/local_agent/prompts.rs，搞清楚 core_head/fragment×2/core_mid/core_tail 布局的槽位校验、新增插件如何改布局、快照测试位置
- Scope: internal
- Date: 2026-09-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `server/app/agent_service.py:31-62` | 三段 core 文案 + 布局元组 + `_compose_system_prompt` + 模块级 `SYSTEM_PROMPT` |
| `src-tauri/src/local_agent/prompts.rs:10-34` | Rust 镜像：CORE_HEAD/MID/TAIL + `compose_system_prompt` + `system_prompt_base()` |
| `server/tests/test_plugin_manifest.py:42-58,96-109` | Python 端快照测试（钉住完整 SYSTEM_PROMPT 字面量与布局行为） |
| `src-tauri/src/local_agent/prompts.rs:63-114` | Rust 端快照测试（钉住同一份完整字面量） |
| `server/app/plugin_runtime.py:44-53` | `builtin_plugins()` 注册顺序 + `aggregate_prompt_fragments()` |
| `src-tauri/src/local_agent/plugin_runtime.rs:101-106,157-159` | Rust 端 `prompt_fragments()` 聚合与 `builtin_plugins()` |

### 布局机制（关键结论）

1. **布局是硬编码元组**（`agent_service.py:42`）：
   `('core_head', 'fragment', 'core_mid', 'fragment', 'core_tail')`
   即 core_head → fragment槽1 → core_mid → fragment槽2 → core_tail。动态时间上下文由 `model_system_prompt`（:65-81）在尾部追加，不占槽位。
2. **槽位校验 fail-fast**（`agent_service.py:45-59`）：fragment 队列按注册顺序依序填充；队列空了还要填 → `ValueError('插件提示词片段不足，无法填充提示词布局')`；填完还有剩 → `ValueError('插件提示词片段超出提示词布局槽位')`。`SYSTEM_PROMPT` 在**模块导入时**（:62）由 `aggregate_prompt_fragments(builtin_plugins())` 组装——槽位数与片段总数不匹配会让服务**启动即 import 失败**。
3. Rust 镜像（`prompts.rs:17-28`）逻辑相同，但槽位是写死在数组里的两个 `queue.next().expect(...)`，尾部 `assert!(queue.next().is_none(), ...)`；`system_prompt_base()` 用 `OnceLock` 惰性组装，panic 发生在首次调用而非启动。
4. **片段顺序**：`aggregate_prompt_fragments` 按插件注册顺序拼接各插件的 `prompt_fragments()`，插件内部顺序 = plugin.json `prompt_fragments` 声明顺序（todo: `tool_rules` 在前、`reminder_time_rules` 在后，因为后者引用前者的工具名）。当前 todo 恰好贡献 2 个片段，占满 2 个槽。

### 新增 memo 插件需要怎么改

memo 若贡献 N 个 prompt fragment，则布局里 `fragment` 槽总数必须从 2 改为 2+N，且**双端同步改**：

- Python：`agent_service.py:42` 的 `_SYSTEM_PROMPT_LAYOUT` 增加 N 个 `'fragment'`。位置即片段在提示词中的落点；建议 memo 片段放在 todo 片段之后，例如 `('core_head','fragment','fragment','core_mid','fragment','fragment','core_tail')`（memo 两段落在 core_mid 之后、core_tail 之前）。
- Rust：`prompts.rs:17-28` 的 `compose_system_prompt` 目前是写死的两个 `queue.next()`，需要改成与 Python 相同的循环式填充（或直接加两个槽位表达式），保持完全一致。
- **顺序约束**：`builtin_plugins()` 的注册顺序（Python `plugin_runtime.py:44-47`、Rust `plugin_runtime.rs:157-159`）决定谁的片段进哪个槽。把 MemoPlugin 追加在 TodoPlugin 之后即可让 memo 片段落在新增的后部槽位。
- CORE_HEAD/MID/TAIL 文案本身不用改（除非要在 core 里提到"备忘"）。

### 快照测试（必须同步更新，否则双端 CI 失败）

| 测试 | 位置 | 钉住内容 |
|---|---|---|
| `PluginManifestTests.test_system_prompt_composes_core_and_plugin_fragments_verbatim` | `server/tests/test_plugin_manifest.py:96-101` | `EXPECTED_SYSTEM_PROMPT` 完整字面量（:42-58）+ 片段 key 顺序 |
| `test_layout_fills_fragment_slots_in_order_and_rejects_mismatch` | `server/tests/test_plugin_manifest.py:103-109` | 用 `['片段甲','片段乙']` 验证填充顺序、用 1/3/0 个片段验证 ValueError——槽位数变了这个测试的参数也要变 |
| `base_prompt_matches_server_verbatim` | `src-tauri/src/local_agent/prompts.rs:64-83` | Rust 独立转写的同一份完整提示词字面量 |
| `layout_fills_fragment_slots_in_registration_order` / 两个 `should_panic` | `prompts.rs:95-114` | 槽位填充与过多/过少 panic |

注意：`prompts.rs:62` 与 `test_plugin_manifest.py:8-9` 的注释明确说两份字面量是"独立转写"，任一端漂移都会让另一端的快照失败。新增 memo 片段文案后，这两处大字面量都要重写。

### 相关 Specs

- 未发现 `.trellis/spec/` 下直接描述提示词布局的 spec（未逐一检索）。

## Caveats / Not Found

- memo 究竟贡献几个 fragment 由 `plugins/memo/plugin.json` 的 `prompt_fragments` 决定；本研究假设 2 个（对照 todo 的 tool_rules + reminder_time_rules 结构），若只有 1 个则布局只加 1 槽。
- Rust 端 compose 失败是 panic（非优雅错误），发生在首次取 `system_prompt_base()`；Python 端是 import 时 ValueError。两端失败时机不同，测试都覆盖。
