import type { ReactNode } from 'react'
import { Boxes, CircleAlert, RefreshCw, ChevronRight, RotateCcw } from 'lucide-react'
import { updateQuery } from './api'
export function formatTime(value?: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未采集' }
export function label(value: string) {
  const labels: Record<string, string> = { queued: '排队中', running: '执行中', completed: '已完成', succeeded: '成功', failed: '失败', interrupted: '已中断', pending: '待完成', success: '成功', failure: '失败', partial: '采集中', incomplete: '追踪不完整', complete: '采集完整', legacy: '历史未埋点', server: '服务端', device: '设备端', healthy: '正常', unknown: '未知', provider: '提供方返回', unavailable: '未采集' }
  return labels[value] ?? value
}
export function Badge({ value }: { value: string }) { return <span className={`status-pill ${['success', 'succeeded', 'completed', 'complete'].includes(value) ? 'green-pill' : ['failed', 'failure', 'incomplete', 'interrupted'].includes(value) ? 'red-pill' : 'blue-pill'}`}>{label(value)}</span> }
export function PageIntro({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="page-intro"><div><p className="eyebrow">内部管理 · 服务端</p><h1>{title}</h1><p className="muted">{children}</p></div>{action}</div> }
export function Loading() { return <div className="loading" role="status"><RefreshCw size={17} className="spin" aria-hidden />正在读取服务端记录</div> }
export function ErrorLine({ error }: { error: string }) { return error ? <div className="error-line" role="alert"><CircleAlert size={16} aria-hidden />{error}</div> : null }
export function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <section className="panel empty-state"><ErrorLine error={message} /><button className="secondary-button" onClick={retry}>重试</button></section> }
export function EmptyState({ title = '暂无记录', text = '当前查询没有服务端记录。' }: { title?: string; text?: string }) { return <div className="empty-state"><Boxes size={22} aria-hidden /><h3>{title}</h3><p>{text}</p></div> }
export function Refresh({ busy, onClick }: { busy: boolean; onClick: () => void }) { return <button className="icon-button" disabled={busy} onClick={onClick} aria-label="刷新当前记录"><RefreshCw size={17} aria-hidden /></button> }
export function Pager({ cursor, next, queryKey, busy }: { cursor: string | null; next?: string | null; queryKey: string; busy: boolean }) { return <nav className="pager" aria-label="列表分页"><button className="secondary-button" disabled={!cursor || busy} onClick={() => updateQuery({ [queryKey]: null })}><RotateCcw size={14} aria-hidden />返回首页</button><span>{cursor ? '历史记录页' : '最新记录页'}</span><button className="secondary-button" disabled={!next || busy} onClick={() => updateQuery({ [queryKey]: next ?? null })}>下一页<ChevronRight size={14} aria-hidden /></button></nav> }
export function JsonView({ value }: { value: unknown }) { return <pre className="json-view">{JSON.stringify(value, null, 2) ?? '未采集'}</pre> }
