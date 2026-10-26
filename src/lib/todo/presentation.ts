import type { ToolCall } from '../agent'
import manifest from '../../../plugins/todo/plugin.json'
import { registerToolPresentation, toolStatusText, type ToolPresentationPlugin } from '../tool-presentation'

function toolKind(name: string) {
  if (name === 'todo.create' || name === 'todo_create') return 'create'
  if (name === 'todo.complete' || name === 'todo_complete') return 'complete'
  if (name === 'todo.list' || name === 'todo_list') return 'list'
  if (name === 'todo.reminder.set' || name === 'todo_reminder_set') return 'reminder'
  return null
}

function resultItem(tool: ToolCall) {
  const item = tool.result?.item
  return typeof item === 'object' && item !== null ? item : null
}

function titleOf(item: unknown) {
  return typeof item === 'object' && item !== null && 'title' in item && typeof item.title === 'string' ? item.title : null
}

function statusOf(item: unknown) {
  if (typeof item !== 'object' || item === null || !('status' in item)) return null
  return item.status === 'pending' || item.status === 'completed' ? item.status : null
}

function reminderTime(item: object | null) {
  if (!item || !('remind_at' in item) || typeof item.remind_at !== 'string') return null
  // Require an explicit offset; never silently interpret a server time as local.
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(item.remind_at)
  if (!parts) return null
  const [, year, month, day, hour, minute, second, , offsetHour = '0', offsetMinute = '0'] = parts
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1]
  if (!days || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null
  const date = new Date(item.remind_at)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  }).format(date)
}

function todoToolPresentation(tool: ToolCall) {
  const kind = toolKind(tool.name)
  const item = resultItem(tool)
  const title = titleOf(item)
  const time = reminderTime(item)
  const cleared = item !== null && 'remind_at' in item && item.remind_at === null
  const hasReminderValue = item !== null && 'remind_at' in item && item.remind_at !== null
  let name = kind === 'create' ? '记录待办' : kind === 'complete' ? '完成待办' : kind === 'list' ? '待办列表' : kind === 'reminder' ? '调整提醒' : tool.name
  let status = toolStatusText(tool.status)
  let text = ''
  if (tool.status !== 'completed') return { name, status, text }

  if (kind === 'reminder') {
    name = cleared ? '取消提醒' : '设置提醒'
    if (!title || (!cleared && !time)) {
      status = '结果待确认'
      text = '提醒结果未确认，请刷新待办列表核对。'
    }
    else {
      status = cleared ? '已取消提醒' : '已设置提醒'
      text = cleared ? `已取消提醒：${title}` : `已设置提醒：${title} · ${time}`
    }
  }
  else if (kind === 'complete') {
    if (!title || statusOf(item) !== 'completed') {
      status = '结果待确认'
      text = '待办完成结果未确认，请刷新待办列表核对。'
    }
    else {
      status = '待办已完成'
      text = `已完成：${title}`
    }
  }
  else if (kind === 'create') {
    if (!title) return { name, status: '结果待确认', text: '待办记录结果未确认，请刷新待办列表核对。' }
    status = '已记录'
    text = `已记录：${title}`
    if (hasReminderValue) {
      name = '记录待办并设置提醒'
      if (time) text += ` · 提醒时间：${time}`
      else {
        status = '结果待确认'
        text += '；提醒时间未确认，请刷新待办列表核对。'
      }
    }
  }
  else if (kind === 'list') {
    const items = tool.result?.items
    if (!Array.isArray(items)) return { name, status: '结果待确认', text: '暂未收到待办查询结果，请刷新待办列表核对。' }
    const titles = items.map(item => {
      const title = titleOf(item)
      const itemStatus = statusOf(item)
      if (!title || !itemStatus) return null
      return `${title}（${itemStatus === 'completed' ? '已完成' : '待完成'}）`
    })
    if (titles.some(title => title === null)) return { name, status: '结果待确认', text: '待办查询结果不完整，请刷新待办列表核对。' }
    status = '已查询'
    text = items.length === 0 ? '当前没有待办事项。' : titles.join('；')
  }
  return { name, status, text }
}

/** Stable across streamed text, snapshot object identity and tool ordering. */
function todoEffectsFingerprint(tools: ToolCall[]) {
  return tools.filter(tool => tool.status === 'completed' && ['create', 'complete', 'reminder'].includes(toolKind(tool.name) ?? '')).map(tool => {
    const item = resultItem(tool)
    return [tool.id, item && 'id' in item ? item.id : null, item && 'status' in item ? item.status : null, item && 'remind_at' in item ? item.remind_at : null]
  }).sort((left, right) => String(left[0]).localeCompare(String(right[0])))
}

/** Tool names (business + model) and refresh groups come straight from the
 * shared manifest, so the presentation registry cannot drift from it. */
export const todoPresentationPlugin: ToolPresentationPlugin = {
  toolNames: manifest.tools.flatMap(tool => [tool.name, tool.handler_key]),
  affects: manifest.affects,
  present: todoToolPresentation,
  effectsFingerprint: todoEffectsFingerprint,
}

registerToolPresentation(todoPresentationPlugin)
