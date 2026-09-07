# Implementation Plan

- [x] 用户确认最终最小方案，任务已启动。
- [x] 实现代理负责 server/app/todo_tools.py、agent_service.py、新迁移、相关测试和 ChatPanel 必要结果格式化；保留其他任务代码与图像。
- [x] 运行有意义的工具边界测试；前端结果类型修改后执行一次 pnpm build。新增 Rust IPC 后执行一次有针对性的 cargo check/test；无新改动时不重复构建。
- [x] 增加 Rust agent_list_todos、集中 TS 类型和原气泡框内的 TodoList；处理加载/失败/空状态、刷新和配置代际。
- [ ] 验证打开列表无需模型：真实 GET 对照、模型未配置仍可查询、查看前后 agent run 数量不变；不写演示事项。
- [ ] 验证列表/聊天导航保留草稿与消息；切换配置后的旧响应不能覆盖当前数据。
- [x] check 代理检查账号隔离、重复完成、事务与旧功能兼容，修复后按风险验证。
- [x] 在真实服务执行新增迁移并重启本项目 API；不更换数据库、模型或设备凭证。
- [ ] 真实只读/无目标请求验证查询和追问；仅对用户明确指定的事项验收完成写入，或接受用户手动验收。
- [x] 更新服务说明、协议业务状态和规格；记录各层证据及未验证项。

本工作区根目录不是 Git 仓库，不初始化、不宣称提交。原 MVP 待验事项不因新增工具而自动视为通过。

## Direct completion button increment

- [x] Add shared account-scoped business method, authenticated POST endpoint and typed Rust/TS completion command.
- [x] Add row button/loading/error handling, idempotence and stale-response protection.
- [x] Run focused shared completion/HTTP/Rust tests and frontend/native build for new command; review all affected paths.
- [x] Restart this project's service/client with the new build. Validate failure boundaries without changing an unspecified real todo; record UI or user acceptance separately.

## Visual correction

- [x] Inspect official Things/Todoist references and document the scoped visual direction.
- [x] Update only TodoList.tsx/CSS for task-first rows, left completion control, compact dates and quiet toolbar.
- [x] Frontend build passed; static review preserved async guards and fixed refresh hover contrast.
- [ ] Observe actual native appearance and successful user-selected completion; no sample records or mock desktop used.

## Reopen increment

- [x] Add account-scoped idempotent reopen HTTP/store/native/TS flow with focused tests.
- [x] Make the same row control usable in both states; retain async protections and focus continuity.
- [x] Build affected frontend/native code once, review, restart owned service/client and record evidence boundaries.
