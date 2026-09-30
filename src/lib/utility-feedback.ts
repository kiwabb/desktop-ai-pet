/** Only an explicit stale-reminder response authorizes replacing its CAS base. */
export function isReminderConflict(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /提醒已被修改|提醒计划已变更|提醒已在其他地方修改/.test(message)
}

type UtilityErrorContext = 'settings' | 'todo' | 'reminder' | 'memo'

/** Context is required: an HTTP status alone cannot identify a business resource. */
export function utilityErrorMessage(cause: unknown, fallback: string, context: UtilityErrorContext): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (context === 'settings') {
    if (/404/.test(message)) return '服务未找到请求的接口或资源，请检查服务地址。'
  } else if (context === 'memo') {
    if (/回顾时间已被修改|回顾计划已变更|回顾已在其他地方修改|冲突|409/.test(message)) return '回顾时间已在其他地方修改。请刷新后重新设置。'
    if (/备忘.*不存在|未找到备忘|404/.test(message)) return '这条备忘已不存在，请刷新列表。'
    if (/回顾时间无效|已经过去|必须晚于当前时间/.test(message)) return '回顾时间已过，请选择一个未来的时间。'
    if (/备忘标题需为/.test(message)) return '备忘标题需为 1 到 2000 个字符。'
    if (/备忘正文需为/.test(message)) return '备忘正文需为不超过 20000 个字符。'
    if (/请先配置|本地存储不可用/.test(message)) return '请先在设置中保存助手配置，再重新读取。'
  } else {
    if (/提醒已被修改|提醒计划已变更|冲突|409/.test(message)) return '提醒已在其他地方修改。请刷新后重新设置。'
    if (/已完成/.test(message)) return '这项待办已经完成，请刷新列表后重试。'
    if (/待办.*不存在|404/.test(message)) return '这项待办已不存在，请刷新列表。'
    if (/提醒时间无效|已经过去/.test(message)) return '提醒时间已过，请选择一个未来的时间。'
    if (/待办标题需为/.test(message)) return '待办标题需为 1 到 2000 个字符。'
    if (/请先配置|本地存储不可用/.test(message)) return '请先在设置中保存助手配置，再重新读取。'
  }
  if (/助手配置已更换/.test(message)) return '助手配置已更换，请刷新后重试。'
  if (/401|403|凭证|API Key|认证/.test(message)) return '验证未通过，请检查设置中的地址和凭证。'
  if (/HTTPS/.test(message)) return '远程服务请使用 HTTPS 地址；本机服务可以使用 HTTP。'
  if (/请输入.*地址/.test(message)) return '请输入有效的服务地址。'
  return fallback
}
