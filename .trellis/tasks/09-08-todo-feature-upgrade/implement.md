# 执行计划: 待办功能完善

按依赖顺序，自底向上：

## Step 1 服务端端点（server/）
1. `runtime_store.py`：create_todo / update_todo_title / delete_todo（含事务与校验）
2. `main.py`：POST / PATCH / DELETE `/v1/todos[/{id}]`
3. `server/tests/` 新增 pytest：认证、校验、404、成功路径
4. 验证：`cd server && .venv/bin/python -m pytest tests/ -q`

## Step 2 Rust 层（src-tauri/）
1. `local_agent/store.rs`：三个本地方法 + 单测
2. `backend/`：trait + ServerBackend(HTTP) + LocalBackend(store) + 3 个新 command
3. `lib.rs` 注册 command
4. 验证：`cd src-tauri && cargo check && cargo clippy && cargo test`

## Step 3 前端（src/）
1. `src/lib/agent.ts` 三个薄封装；`src/lib/quick-reminders.ts` 快捷时间纯函数；排序/分组纯函数
2. `TodoList.tsx` + CSS：输入行、行内编辑、删除、快捷 chips、分组折叠、行动效
3. 验证：`pnpm exec tsc -b` + 五个验证脚本全绿

## Step 4 端到端
1. `python3 tools/verify-agent-service.py`（服务端模式回归，本地服务端在跑）
2. 手动：两种模式下增删改 + 快捷提醒 + 分组折叠

## 回滚点
- 服务端端点是纯新增，不改动既有路由；前端新功能失败时旧路径（聊天建待办）不受影响。
- 每个 Step 完成即验证，不堆到最后。
