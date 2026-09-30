import { describe, expect, it } from 'vitest'
import { isReminderConflict, utilityErrorMessage } from './utility-feedback'

describe('utility error feedback', () => {
  it('only resets the reminder CAS editor for a proven stale reminder', () => {
    expect(isReminderConflict('提醒已被修改，请刷新后重试')).toBe(true)
    expect(isReminderConflict(new Error('提醒计划已变更'))).toBe(true)
    expect(isReminderConflict('请选择一个未来的提醒时间。')).toBe(false)
    expect(isReminderConflict('HTTP 503')).toBe(false)
    expect(isReminderConflict('HTTP 409')).toBe(false)
    expect(isReminderConflict('未能保存，请重试。')).toBe(false)
  })
  it('keeps reminder conflicts actionable instead of treating them as generic save failures', () => {
    expect(utilityErrorMessage(new Error('提醒已被修改，请刷新后重试'), '保存失败', 'reminder')).toBe('提醒已在其他地方修改。请刷新后重新设置。')
    expect(utilityErrorMessage('HTTP 409', '保存失败', 'reminder')).toBe('提醒已在其他地方修改。请刷新后重新设置。')
  })

  it('does not expose arbitrary provider or transport content', () => {
    for (const context of ['settings', 'todo', 'reminder'] as const) {
      expect(utilityErrorMessage('invoke error { endpoint: https://provider.invalid, debug: INTERNAL }', '未能保存，请重试。', context)).toBe('未能保存，请重试。')
    }
  })

  it('distinguishes missing configuration from a deleted todo', () => {
    expect(utilityErrorMessage('配置目录不存在', '无法保存设置。', 'settings')).toBe('无法保存设置。')
    expect(utilityErrorMessage('待办不存在', '保存失败', 'todo')).toBe('这项待办已不存在，请刷新列表。')
    expect(utilityErrorMessage('请先配置助手服务', '保存失败', 'todo')).toBe('请先在设置中保存助手配置，再重新读取。')
  })

  it('interprets the same 404 within the requested resource context', () => {
    const cause = new Error('HTTP404 from https://provider.invalid/v1/models?key=unit-only-secret')
    expect(utilityErrorMessage(cause, '未能读取模型列表。', 'settings')).toBe('服务未找到请求的接口或资源，请检查服务地址。')
    expect(utilityErrorMessage(cause, '未能保存。', 'todo')).toBe('这项待办已不存在，请刷新列表。')
    expect(utilityErrorMessage(cause, '未能保存。', 'reminder')).toBe('这项待办已不存在，请刷新列表。')
  })

  it.each(['HTTP 409', '任务已完成', '待办不存在', '提醒计划已变更', '待办标题需为 1 到 2000 个字符', '提醒时间已经过去'])(
    'does not apply todo business language to a settings error: %s', cause => {
      expect(utilityErrorMessage(cause, '设置未保存，请检查填写内容后重试。', 'settings')).toBe('设置未保存，请检查填写内容后重试。')
    },
  )

  it('retains completed-todo and shared authentication guidance without exposing details', () => {
    expect(utilityErrorMessage('这项待办已完成', '保存失败', 'todo')).toBe('这项待办已经完成，请刷新列表后重试。')
    expect(utilityErrorMessage('HTTP 401 Authorization: unit-only-secret', '读取失败', 'settings')).toBe('验证未通过，请检查设置中的地址和凭证。')
    expect(utilityErrorMessage('HTTP 403 Authorization: unit-only-secret', '读取失败', 'reminder')).toBe('验证未通过，请检查设置中的地址和凭证。')
  })

  it('maps memo conflicts, missing rows and past review times in the memo context', () => {
    expect(utilityErrorMessage('回顾时间已被修改，请刷新后重试', '保存失败', 'memo')).toBe('回顾时间已在其他地方修改。请刷新后重新设置。')
    expect(utilityErrorMessage('备忘或回顾时间已被修改，请刷新后重试', '保存失败', 'memo')).toBe('回顾时间已在其他地方修改。请刷新后重新设置。')
    expect(utilityErrorMessage('备忘不存在或已删除', '保存失败', 'memo')).toBe('这条备忘已不存在，请刷新列表。')
    expect(utilityErrorMessage('未找到备忘，请刷新核对', '保存失败', 'memo')).toBe('这条备忘已不存在，请刷新列表。')
    expect(utilityErrorMessage('回顾时间无效或已经过去，请重新设置', '保存失败', 'memo')).toBe('回顾时间已过，请选择一个未来的时间。')
    expect(utilityErrorMessage('回顾时间必须晚于当前时间', '保存失败', 'memo')).toBe('回顾时间已过，请选择一个未来的时间。')
    expect(utilityErrorMessage('备忘标题需为 1 到 2000 个字符', '保存失败', 'memo')).toBe('备忘标题需为 1 到 2000 个字符。')
    expect(utilityErrorMessage('备忘正文需为不超过 20000 个字符的文本', '保存失败', 'memo')).toBe('备忘正文需为不超过 20000 个字符。')
    expect(utilityErrorMessage('请先配置助手服务', '保存失败', 'memo')).toBe('请先在设置中保存助手配置，再重新读取。')
  })

  it('keeps todo business language and transport details out of the memo context', () => {
    expect(utilityErrorMessage('这项待办已经完成', '保存失败', 'memo')).toBe('保存失败')
    expect(utilityErrorMessage('提醒已被修改，请刷新后重试', '保存失败', 'memo')).toBe('保存失败')
    expect(utilityErrorMessage('invoke error { endpoint: https://provider.invalid, debug: INTERNAL }', '未能保存，请重试。', 'memo')).toBe('未能保存，请重试。')
  })
})
