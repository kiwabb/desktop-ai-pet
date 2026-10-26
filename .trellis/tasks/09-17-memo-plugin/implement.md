# 备忘录插件 — 实施计划

按依赖顺序执行；每步完成后跑对应验证。提示词布局扩槽必须先于 memo fragments 注册（否则启动即失败）。

## 检查清单

1. **共享 manifest**：`plugins/memo/plugin.json`（5 个工具、name_mapping、prompt_fragments×1-2、validation_messages、affects=["memo-list"]、rest_endpoints）。
   验证：JSON 合法；字段对照 `plugins/todo/plugin.json` 结构。
2. **服务端迁移**：`server/migrations/009_memos.sql`（memos 表 + 两个索引）。
   验证：`cd server && .venv/bin/python -m pytest tests/ -x -q`（启动迁移用例）。
3. **服务端插件包**：`server/app/plugins/memo/{__init,manifest,store,tools}.py`；`plugin_runtime.py:44` 注册；`agent_service.py:42` 布局扩槽 + memo fragment 入位。
   验证：`pytest tests/test_plugin_manifest.py tests/test_plugin_registry.py -q`（实例总数更新）+ 提示词快照重写。
4. **服务端 REST**：`main.py` 挂载 6 个端点 + `store_for('memo')`。
   验证：端点级测试（认证、account 隔离、due 查询）。
5. **单机模式**：`local_agent/plugins/memo/{manifest.rs,mod.rs,store.rs}`；`plugin_runtime.rs:157` 注册；`store.rs` SCHEMA_V1 追加 memos + `user_version<2` 增量；`prompts.rs` 布局扩槽 + 快照重写。
   验证：`cd src-tauri && cargo test`（含双端 manifest 对拍、user_version 1→2 升级用例）。
6. **桌面核心轮询与直连**：`backend/mod.rs` View 三字段 + MemoSource 分发 + `apply_memo_review_poll`/`apply_memo_write`（复用现有 fencing 计数器）；`server.rs` `poll_memo_reviews`；`local.rs` due 轮询；Tauri 命令 + `lib.rs` 注册。
   验证：`cargo test`（fencing 行为矩阵、due 轮询形状校验）。
7. **前端**：`src/lib/memo/presentation.ts` + `tool-plugins.ts` 注册；`agent.ts` Memo 类型/封装/AgentView 字段；`ChatPanel` 页面态枚举化（chat/todos/memos）+ 头部按钮；`MemoList.tsx`（两区、归档切换、手动创建）；`MemoReviewReminders.tsx`；`App.tsx` 唤起 effect 扩展 memo_reviews。
   验证：`pnpm exec tsc --noEmit` + 构建；手动/脚本验证工具卡片渲染与页面刷新。
8. **端到端联调**：服务端模式 + 单机模式各跑一遍 AC2–AC5。

## 验证命令

- 服务端：`cd server && .venv/bin/python -m pytest tests/ -q`
- 单机/核心：`cd src-tauri && cargo test`
- 前端：`pnpm exec tsc --noEmit && pnpm build`
- 行为冒烟：参照 `tools/verify-*.mjs` 惯例补 memo 验证脚本（如需要）。

## 风险文件与回滚点

- `agent_service.py:42` / `prompts.rs:17-28`（布局）——改错即启动失败；先改布局与快照，确认空 fragment 占位可通过，再注册 MemoPlugin。
- `store.rs` user_version 增量——升级逻辑独立事务，失败保持 version=1；用既有数据副本验证升级。
- `ChatPanel.tsx` 页面态重构——todosOpen 引用点约 12 处，逐一核对；页面枚举化先行单独成步。
- `backend/mod.rs` fencing 计数器——若重命名为通用名，需同步 todo 路径全部引用；可保留原名只接入 memo，降低 diff。
- 回滚：memo 全部为新文件 + 各端一行注册，回滚=删文件+删注册行+DROP TABLE（服务端）/保持 user_version=2 空表无害（本地）。

## 启动前检查

- [ ] prd.md 验收标准与实现一致
- [ ] implement.jsonl / check.jsonl 已配置真实 spec/research 条目
- [ ] 三端验证命令在基线（未改动）上先跑通一次
