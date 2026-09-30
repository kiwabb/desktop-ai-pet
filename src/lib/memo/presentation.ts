import type { ToolCall } from '../agent'
import manifest from '../../../plugins/memo/plugin.json'
import { registerToolPresentation, toolStatusText, type ToolPresentationPlugin } from '../tool-presentation'

function toolKind(name: string) {
  if (name === 'memo.create' || name === 'memo_create') return 'create'
  if (name === 'memo.list' || name === 'memo_list') return 'list'
  if (name === 'memo.update' || name === 'memo_update') return 'update'
  if (name === 'memo.archive' || name === 'memo_archive') return 'archive'
  if (name === 'memo.review.set' || name === 'memo_review_set') return 'review'
  return null
}

function resultItem(tool: ToolCall) {
  const item = tool.result?.item
  return typeof item === 'object' && item !== null ? item : null
}

function titleOf(item: unknown) {
  return typeof item === 'object' && item !== null && 'title' in item && typeof item.title === 'string' ? item.title : null
}

function kindOf(item: object | null) {
  if (!item || !('kind' in item)) return null
  return item.kind === 'goal' ? 'goal' : item.kind === 'note' ? 'note' : null
}

function reviewTime(item: object | null) {
  if (!item || !('review_at' in item) || typeof item.review_at !== 'string') return null
  // Require an explicit offset; never silently interpret a server time as local.
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(item.review_at)
  if (!parts) return null
  const [, year, month, day, hour, minute, second, , offsetHour = '0', offsetMinute = '0'] = parts
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1]
  if (!days || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null
  const date = new Date(item.review_at)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function memoToolPresentation(tool: ToolCall) {
  const kind = toolKind(tool.name)
  const item = resultItem(tool)
  const title = titleOf(item)
  const time = reviewTime(item)
  const itemKind = kindOf(item)
  const noun = itemKind === 'goal' ? '长期目标' : '备忘'
  const cleared = item !== null && 'review_at' in item && item.review_at === null
  const hasReviewValue = item !== null && 'review_at' in item && item.review_at !== null
  let name = kind === 'create' ? `记录${noun}` : kind === 'list' ? '备忘列表' : kind === 'update' ? `更新${noun}` : kind === 'archive' ? '归档备忘' : kind === 'review' ? '调整回顾' : tool.name
  let status = toolStatusText(tool.status)
  let text = ''
  if (tool.status !== 'completed') return { name, status, text }

  if (kind === 'review') {
    name = cleared ? '取消回顾' : '设置回顾'
    if (!title || (!cleared && !time)) {
      status = '结果待确认'
      text = '回顾结果未确认，请刷新备忘录核对。'
    }
    else text = cleared ? `已取消回顾：${title}` : `已设置回顾：${title} · ${time}`
  }
  else if (kind === 'archive') {
    const archived = item !== null && 'status' in item && item.status === 'archived'
    name = archived ? '归档备忘' : '取消归档'
    if (!title) {
      status = '结果待确认'
      text = '归档结果未确认，请刷新备忘录核对。'
    }
    else text = archived ? `已归档：${title}` : `已取消归档：${title}`
  }
  else if (!tool.result) return { name, status, text }
  else if (title) {
    text = `${kind === 'update' ? '已更新' : '已记录'}：${title}`
    if (kind === 'create' && hasReviewValue) {
      name = `记录${noun}并设置回顾`
      if (time) text += ` · 回顾时间：${time}`
      else {
        status = '结果待确认'
        text += '；回顾时间未确认，请刷新备忘录核对。'
      }
    }
  }
  else if (Array.isArray(tool.result.items)) {
    const titles = tool.result.items.map(item => {
      const title = titleOf(item)
      if (!title) return null
      const goal = kindOf(typeof item === 'object' && item !== null ? item : null) === 'goal'
      const archived = typeof item === 'object' && item !== null && 'status' in item && item.status === 'archived'
      return `${title}（${archived ? '已归档' : goal ? '长期目标' : '备忘'}）`
    }).filter((value): value is string => value !== null)
    text = tool.result.items.length === 0 ? '当前没有备忘。' : titles.join('；') || '已返回查询结果。'
  }
  else text = '执行结果已保存。'
  return { name, status, text }
}

/** Stable across streamed text, snapshot object identity and tool ordering. */
function memoEffectsFingerprint(tools: ToolCall[]) {
  return tools.filter(tool => tool.status === 'completed' && ['create', 'update', 'archive', 'review'].includes(toolKind(tool.name) ?? '')).map(tool => {
    const item = resultItem(tool)
    return [tool.id, item && 'id' in item ? item.id : null, item && 'status' in item ? item.status : null, item && 'review_at' in item ? item.review_at : null]
  }).sort((left, right) => String(left[0]).localeCompare(String(right[0])))
}

/** Tool names (business + model) and refresh groups come straight from the
 * shared manifest, so the presentation registry cannot drift from it. */
export const memoPresentationPlugin: ToolPresentationPlugin = {
  toolNames: manifest.tools.flatMap(tool => [tool.name, tool.handler_key]),
  affects: manifest.affects,
  present: memoToolPresentation,
  effectsFingerprint: memoEffectsFingerprint,
}

registerToolPresentation(memoPresentationPlugin)
