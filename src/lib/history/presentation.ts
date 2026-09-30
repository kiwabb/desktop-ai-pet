import type { ToolCall } from '../agent'
import { registerToolPresentation, type ToolPresentationPlugin } from '../tool-presentation'

function historyExcerpt(item: unknown): string | null {
  if (typeof item !== 'object' || item === null || !('excerpt' in item) || typeof item.excerpt !== 'string') return null
  const characters = Array.from(item.excerpt.replace(/\s+/g, ' ').trim())
  const clipped = characters.length > 80 || ('excerpt_truncated' in item && item.excerpt_truncated === true)
  return `${characters.slice(0, 80).join('')}${clipped ? '…' : ''}`
}

function historyToolPresentation(tool: ToolCall) {
  const name = '查找聊天记录'
  if (tool.status !== 'completed') {
    const status = { running: '正在查找…', failed: '查找失败', needs_reconciliation: '查找中断' }[tool.status]
    return { name, status, text: '' }
  }
  const items: unknown = tool.result?.items
  if (!Array.isArray(items)) return { name, status: '结果待确认', text: '暂未收到聊天记录查询结果。' }
  const excerpts = items.map(historyExcerpt)
  if (excerpts.some(excerpt => excerpt === null)) return { name, status: '结果待确认', text: '聊天记录查询结果不完整，请重新查找。' }
  if (items.length === 0) {
    return {
      name,
      status: '已完成',
      text: tool.result?.search_mode === 'recent_messages' ? '暂无更早的聊天记录。' : '未找到匹配的聊天记录。',
    }
  }
  const preview = excerpts.slice(0, 2).filter(excerpt => excerpt !== '').join('；')
  const more = tool.result?.has_more === true ? '还有更多聊天片段。' : ''
  return { name, status: '已完成', text: `返回 ${items.length} 条聊天片段，仅展示有限摘录。${more}${preview}` }
}

/** Local-only read capability; it does not refresh or mutate business lists. */
export const historyPresentationPlugin: ToolPresentationPlugin = {
  toolNames: ['local.history.search', 'local_history_search'],
  affects: [],
  present: historyToolPresentation,
  effectsFingerprint: () => [],
}

registerToolPresentation(historyPresentationPlugin)
