# 实施顺序

1. 三个有明确文件归属的 trellis-implement 并行实现；先协调本任务 design.md 的 API 契约。各自补风险相关回归测试。
2. 根会话整合检查所有报告项，执行 server unittest、admin 类型/构建与无新增脚手架的纯逻辑检查，验证 PostgreSQL SQL 形状。
3. 能用现有真实环境完成的检查直接做；缺少账号/迁移/模型权限不伪造成功，记录剩余真实验收条件。
4. trellis-check 独立复查并修复发现问题，重复受影响检查。
5. 更新 admin-control-plane 规范、README、verification；按作用域 commit，不夹带桌宠 UI 改动。验证实际 remote；无 remote 不虚构 push。
6. 根据实际验收状态完成/保留任务，记录 journal。未满足真实验收不能假装完整交付。

## 风险文件
模型状态/运行接收事务、观测队列、敏感正文接口、前端选择与轮询状态。新增迁移仅增量，不改既有005历史。
