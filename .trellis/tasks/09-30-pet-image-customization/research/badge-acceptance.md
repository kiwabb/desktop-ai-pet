# Optional uploaded header mark

## Decision — 2026-10-03
User requested the paw mark can change, then clarified “安装上传的图片定制” (context: 按照上传的图片定制). This supersedes the initial upload-only assumption. Generate a matching paw mark from the existing real pet reference/base using configured image provider; show extra request cost/count and preview before explicit application. Do not require a separately supplied logo. Preserve original paw as reset/fallback.

## Acceptance boundary
- Existing schemes without a badge retain original paw and current theme. Default pet is unchanged.
- Explicitly generate one matching paw mark using the saved real reference/base; account for the additional image request. Validate bounded raster output; preview remains separate from active header. Existing pet source files remain unchanged.
- Explicit save on an active scheme synchronizes header across chat/Todo/Memo/settings. Switching and reopening recover matching saved mark.
- Restore original is an explicit editable choice. Missing optional image recovers the paw and explanatory warning without hiding pet or deleting scheme.
- No sample images/data added to runtime to claim completion. Unit fixtures, native control inspection and actual selected-file upload are separately reported.

Implementation and verification in progress.

## Current verification
- Native build 66261 passed. Opened exact development bundle, existing 小虎 restored.
- New dedicated section and generate/cancel controls observed through native UI. Explicitly clicked generate; persisted badge job cc95e900-1be3-49d5-bd0a-a76cd5f3e247 is running with request_count 0 and result null. Credential lookup pending; user asked to handle system prompt.
- No actual generated badge exists yet. Candidate preview/save/reset/reuse and final header quality remain unverified. No fixture inserted into runtime.

## Authorization resumed
User reported system authorization complete. Previous credential-wait job timed out with request_count 0. Explicit UI retry created cc33acf7-c91a-45b2-a90f-b9296c0ff8f8; request_count reached 1, status running, result null. Model dispatch is now real, completion still pending.

## 2026-10-03 原生真实验收完成（配套猫爪范围）

- 数据来源：真实本机方案“小虎”和已有聊天/待办/备忘数据；没有种子数据或模拟图片。实际调用 gpt-image-2，job `cc33acf7-c91a-45b2-a90f-b9296c0ff8f8` ready，request_count=1。
- 真实透明灰褐毛边、粉色肉垫猫爪；候选预览期间旧标志保留，保存后标题更新。
- 待办、备忘、设置及聊天紧凑/展开标题均实际查看。备忘显示真实空状态；没有新发聊天请求或改动业务记录。
- 恢复原猫爪并保存后标题恢复；点击“使用已生成猫爪”并保存后重新应用，无新增图片请求。
- Cmd+Q 退出并重新打开同一构建，聊天标题仍显示新猫爪，历史记录正常加载。
- 持久化复核见 badge-real-result.json：saved_badge 匹配 ready 结果，主色 #b3a469，原参考图及四状态文件 SHA256 全部不变。
- 本轮范围为配套猫爪；不代表完整定制功能所有异常场景均已原生验收，也未发布 GitHub。
