# 修复设计边界

本任务补回原已规划契约，不迁移技术栈、不引入第二业务服务。

## 分工与文件归属
- 管理服务：server/app/admin.py、model_config.py、006_admin_repair.sql、新增管理/配置测试。修复 F1-F3/F10/F14/F15 与权限/回滚。
- 运行追踪：agent_service.py、runtime_store.py、新 tracing.py、007_trace_repair.sql（如需要）、新增追踪测试。修复 F4-F9/F11。
- 管理前端：admin/，拆分 main.tsx 以承接完整页面与检查器，修复 F12-F15。
- 根会话：文档、规范、集成验证、独立检查和提交。代理不得修改其他所有权文件，不允许 git reset/stash/commit、启动迁移或真实模型。

## 公共 HTTP 合同
- GET /runs 列表支持 limit、cursor、account_id、status、created_from、created_to（带时区 ISO）；响应 items,next_cursor。账号/设备/待办/审计同样有稳定游标。
- GET /runs/{id} 只返回元数据：现有 trace.calls/tools 字段保留，input_text/arguments/result 不在 GET 返回。POST /runs/{id}/content 经过 admin+CSRF+审计后返回 {input_text,tools:[{id,arguments,result}]}。正文响应 no-store。
- 模型 payload 原 POST 端点保留，返回 available/expired、body、truncated、original_bytes，前端必须展示截断/过期。
- trace.calls 保留 started_at/ended_at/duration_ms/first_response_at/first_visible_text_at/usage；新增 first_token_ms/first_visible_text_ms 如运行层支持，缺失前端使用已记录起止时间的差值且注明口径。
- 工具 metadata 保留 model_call_id/step_index；前端按触发模型步骤将工具夹在模型调用之间，工具详细内容通过受控 POST 读取。
- POST accounts/devices 要求 Idempotency-Key UUID，同 key 同体重试复用对象；设备重试不回显原 token，明确 credential_unavailable 状态，以撤销重发处理。前端保存同一操作 key 直到成功或更改内容，并锁定在途操作。
- 模型 rollback 接受 version_id 和 key_source=current|historical，默认 current；候选保留 rollback 来源，正式发布可追溯。前端显式选择版本而非永远 versions[0]。
- 保留现有 WS/客户端协议，任何 admin 状态不得混入 session seq。

## 观测路径
独立有界追踪写入/超时，观测结果不得控制业务；取消时保存已输出内容、时间和终态；失败缺口只累积不被后续成功覆盖，run 完成后再汇总。正在执行的模型提供 partial 有界预览。采用现有 SDK 明确支持的 stream_usage 能力，不对已执行请求自动重放。

## 验证边界
允许纯隔离单元测试中的 AsyncMock，不允许以其当真实模型/数据库验收。真实数据库只读优先；任何新增真实环境写操作先明确业务用途，禁止为好看造数据。不会自动停止既有 18081 服务。
