# Research: 测试惯例（memo 需要新增/更新的测试清单）

- Query: 列出双端 manifest 等价性测试、提示词快照测试、执行骨架行为矩阵测试的位置与写法要点
- Scope: internal
- Date: 2026-09-17

## Findings

### 1. Manifest 等价性（双端对拍同一 plugin.json）

| 测试 | 位置 | 写法要点 |
|---|---|---|
| Python | `server/tests/test_plugin_manifest.py` | `EXPECTED_MODEL_TOOLS`（:18-40）、`EXPECTED_SYSTEM_PROMPT`（:42-58）、`EXPECTED_VALIDATION_MESSAGES`（:60-68）、`EXPECTED_ENDPOINTS`（:70-79）全部是**独立转写的字面量**；断言 manifest 加载结果 == 字面量（:86-118），并验证 name_mapping 往返（:92-93）、execution_location='server'（:94）、片段 key 顺序（:99） |
| Rust | `src-tauri/src/local_agent/plugins/todo/mod.rs:175-214` | `tool_schemas_match_plugin_manifest` 用独立转写 JSON 钉住 `model_tools()`；`name_mapping_round_trips_every_manifest_tool` 验证每个 handler_key 能映射回业务名 |
| 前端 | `src/lib/tool-presentation.test.ts:55-58` | 展示插件的 toolNames/affects 与 plugin.json 同源 |

**memo 要做**：新建 `plugins/memo/plugin.json` 后，写 memo 版 Python 测试文件（或把 todo 版泛化为参数化双插件测试）+ Rust `plugins/memo/mod.rs` 内同款两个测试 + tool-presentation.test.ts 补 memo 用例。字面量必须手工转写，不能从代码生成（否则失去对拍意义）。

### 2. 提示词快照

| 测试 | 位置 | 要点 |
|---|---|---|
| Python 完整快照 | `test_plugin_manifest.py:96-101` | `SYSTEM_PROMPT == EXPECTED_SYSTEM_PROMPT` 全文比对 |
| Python 布局行为 | `test_plugin_manifest.py:103-109` | `_compose_system_prompt` 填充顺序 + 片段数不足/超出的 ValueError；**槽位数变了参数要改** |
| Rust 完整快照 | `src-tauri/src/local_agent/prompts.rs:64-83` | `base_prompt_matches_server_verbatim`：与 Python 同一份文本的独立转写 |
| Rust 布局行为 | `prompts.rs:95-114` | 填充顺序 + 两个 `#[should_panic]` |

**memo 要做**：memo 片段进布局后，两份大字面量全文重写；布局行为测试的片段数从 2 改为 2+N。

### 3. 执行骨架行为矩阵

**Python**（全部用事务 double，无真实 DB/模型）：
- `server/tests/test_plugin_registry.py`：DummyPlugin 声明式接入（:66-80 幂等+注册路由）、unknown tool 文案对拍（:82-89）、`register_server_tools` 聚合注册（:91-108，**断言实例总数=5，加 memo 后要改**）、片段顺序（:110-125）。
- `server/tests/test_runtime_tools.py`：todo 行为矩阵——创建事务绑定/重试不重写/结果失败回滚/带提醒原子创建（:93-149）、提醒 CAS/冲突/外账号隐藏（:150-195）、参数严格校验（:196,252,271-297）、直连操作无 run（:298-359）、registry 不一致阻止执行（:257-263）。`TransactionalDouble`（:16-60）模拟 conn 并断言 SQL 形状（如必带 `FOR UPDATE`、account_id）。
- `server/tests/test_reminders.py`：提醒专项——重试/修改/清除幂等（:88-110）、冲突与已完成拒绝（:111-137）、DB 时钟判未来（:138-148）、due 查询不消费+排序（:149-160）、complete 清提醒/reopen 不复活（:161-174）、时间解析严格性（:175-204）、HTTP 边界（认证先于参数校验 :205-211、错误消毒 :224+）。

**Rust**（内存 SQLite，`Store::open_memory()`）：
- `src-tauri/src/local_agent/plugin_runtime.rs:194-468`：四工具 roundtrip（:195-250）、非法参数 fail tool 不 fail run（:253-277）、业务冲突变 failed 结果+重复 call 不重写（:280-339）、DummyPlugin AC1（:343-424）、片段注册顺序（:427-468）。
- `src-tauri/src/local_agent/store.rs:851-1221`：提交幂等、事件序、恢复中断、重复工具调用、提醒规则镜像服务端（:981-1049）、孤儿待办回滚（:1052-1071）、due 排序不消费（:1074-1111）、直连写校验（:1157-1204）、时间解析（:1207-1221）。
- `src-tauri/src/backend/mod.rs:992-1025`：`apply_reminder_poll` fencing 矩阵（generation/epoch/in-flight/错误保留旧数据）；`:950-984` todo_config 双模式分发。
- `src-tauri/src/backend/server.rs:505-762`：HTTP 边界——本地 TcpListener 假服务，断言方法/路径/Authorization/请求体，验证响应形状校验、错误消毒（不泄漏 body）、`../bad` id 拒绝。

**前端**：`src/lib/tool-presentation.test.ts`（注册/降级/指纹分发/同源）、`src/lib/conversation-presentation.test.ts`、`src/lib/quick-reminders.test.ts` 等纯函数测试（vitest）。

### memo 版测试清单（对照落地）

1. `server/tests/test_memo_manifest.py`（或泛化现有）：memo 的 MODEL_TOOLS/验证文案/REST 端点字面量；SYSTEM_PROMPT 全文更新（memo 片段插入后）。
2. `src-tauri/src/local_agent/plugins/memo/mod.rs` 内：tool_schemas 对拍 + name_mapping 往返。
3. `prompts.rs` + `test_plugin_manifest.py` 快照与布局参数更新（见 prompt-layout.md）。
4. `test_plugin_registry.py:108` 的实例总数 5 → 5 + memo 工具数；DummyPlugin 测试可加 memo 进 plugins 列表验证多插件共存。
5. memo 行为矩阵：Python 侧新建 `test_memo_tools.py`（复制 test_runtime_tools 的 TransactionalDouble 模式，断言 memos SQL 形状）；Rust 侧在 `plugins/memo/store.rs`/registry 测试中复制 store.rs:981-1111 的提醒规则/due 排序矩阵（改为 review_at 语义）。
6. `backend/mod.rs` 补 `apply_memo_review_poll` 的 fencing 矩阵（对照 :992-1025）。
7. `backend/server.rs` 补 memo HTTP 边界假服务测试。
8. 前端：`tool-presentation.test.ts` 补 memo 插件用例；memo-sort/memo presentation 纯函数测试。

## Caveats / Not Found

- 测试基座是 Python `unittest`（IsolatedAsyncioTestCase）+ Rust 内置 `#[test]`/`#[tokio::test]` + 前端 vitest；无 pytest。
- `test_plugin_manifest.py` 当前写死 todo；泛化还是复制文件由实现者定，但**字面量对拍**模式必须保留。
