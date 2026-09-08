import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import { ArrowLeft, Bot, Pause, Play, Search, Wrench } from 'lucide-react'
import { pagePath, updateQuery, useQuery, useResource } from './api'
import type { PageResult, User } from './api'
import { Badge, EmptyState, ErrorLine, formatTime, JsonView, Loading, PageIntro, Pager, Refresh } from './ui'
import { delayMs, localDateInput, entriesOf, extentOf, intersects, milliseconds, usageSummary } from './trace-helpers'
import type { Run, RunDetail, TraceEntry } from './trace-helpers'

export function RunsPage({ user }: { user: User }) {
  const query = useQuery(), runId = query.get('run'), cursor = query.get('runs_cursor')
  const account = query.get('account_id') ?? '', status = query.get('status') ?? '', from = query.get('created_from') ?? '', to = query.get('created_to') ?? ''
  const [filter, setFilter] = useState({ account, status, from, to }), [filterError, setFilterError] = useState('')
  useEffect(() => setFilter({ account, status, from, to }), [account, status, from, to])
  const list = useResource<PageResult<Run>>(runId ? null : pagePath('/runs', cursor, { account_id: account, status, created_from: from, created_to: to }))
  function search(event: FormEvent) {
    event.preventDefault(); setFilterError('')
    const start = filter.from ? new Date(filter.from) : null, end = filter.to ? new Date(filter.to) : null
    if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && start > end)) { setFilterError('请输入有效时间范围，结束时间不得早于开始时间。'); return }
    updateQuery({ account_id: filter.account.trim() || null, status: filter.status || null, created_from: start?.toISOString() ?? null, created_to: end?.toISOString() ?? null, runs_cursor: null })
  }
  if (runId) return <RunView key={runId} runId={runId} user={user} />
  return <><PageIntro title="会话与运行" action={<Refresh busy={list.busy} onClick={list.refresh} />}>按账号、时间与状态定位真实运行，进入模型和工具执行链路。</PageIntro><section className="panel"><form className="filter-form" onSubmit={search}><label>账号标识<input value={filter.account} onChange={event => setFilter({ ...filter, account: event.target.value })} placeholder="全部账号，或填写账号 UUID" /></label><label>运行状态<select value={filter.status} onChange={event => setFilter({ ...filter, status: event.target.value })}><option value="">全部状态</option>{[['queued', '排队中'], ['running', '执行中'], ['completed', '已完成'], ['failed', '失败'], ['interrupted', '已中断']].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label>开始时间（本地）<input type="datetime-local" value={localDateInput(filter.from)} onChange={event => setFilter({ ...filter, from: event.target.value })} /></label><label>结束时间（本地）<input type="datetime-local" value={localDateInput(filter.to)} onChange={event => setFilter({ ...filter, to: event.target.value })} /></label><button className="primary-button" disabled={list.busy}><Search size={15} aria-hidden />查询</button></form><ErrorLine error={filterError || list.error} />
      {!list.data ? list.busy ? <Loading /> : null : <><div className="table-wrap"><table><thead><tr><th>运行 / 会话</th><th>账号</th><th>状态</th><th>接收时间</th><th>追踪</th><th>操作</th></tr></thead><tbody>{list.data.items.map(run => <tr key={run.id}><td><strong>{run.id.slice(0, 8)}</strong><small>会话 {run.session_id}</small></td><td className="mono">{run.account_id}</td><td><Badge value={run.status} /></td><td>{formatTime(run.created_at)}</td><td><Badge value={run.trace_integrity} /></td><td><button className="text-button" onClick={() => updateQuery({ run: run.id, record: null })}>检查链路</button></td></tr>)}</tbody></table></div>{!list.data.items.length && <EmptyState />}</>}
      <Pager cursor={cursor} next={list.data?.next_cursor} queryKey="runs_cursor" busy={list.busy} />
    </section></>
}
function RunView({ runId, user }: { runId: string; user: User }) {
  const query = useQuery(), selectedId = query.get('record')
  const resource = useResource<RunDetail>(`/runs/${encodeURIComponent(runId)}`, true)
  const run = resource.data, entries = useMemo(() => run ? entriesOf(run) : [], [run])
  const [range, setRange] = useState<[number, number] | null>(null), [follow, setFollow] = useState(!selectedId)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = entries.find(entry => entry.id === selectedId) ?? (!selectedId ? entries.at(-1) : undefined)
  const visible = range ? entries.filter(entry => intersects(entry, range)) : entries
  const usage = run ? usageSummary(run.trace.calls) : null
  useEffect(() => {
    if (!selectedId && selected) updateQuery({ record: selected.id }, true)
  }, [selectedId, selected])
  useEffect(() => { if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [entries, follow])
  function select(entry: TraceEntry) { setFollow(false); setRange(null); updateQuery({ record: entry.id }, true) }
  function chooseRange(value: [number, number] | null) {
    setRange(value); setFollow(false)
    const first = value ? entries.find(entry => intersects(entry, value)) : undefined
    if (first) updateQuery({ record: first.id }, true)
  }
  return <><button className="text-button back-button" onClick={() => updateQuery({ run: null, record: null })}><ArrowLeft size={16} aria-hidden />返回运行列表</button><PageIntro title="执行链路" action={<Refresh busy={resource.busy} onClick={resource.refresh} />}>运行 {runId} · 页面隐藏时暂停刷新；失败后自动退避重试。</PageIntro><ErrorLine error={resource.error} />
    {!run ? resource.busy ? <Loading /> : null : <><div className="trace-summary"><Badge value={run.status} /><Badge value={run.trace.integrity} /><span>模型调用 {run.trace.calls.length} 次</span><span>工具 {run.tools.length} 次</span><span>总用量 {usage?.total === null ? '未采集' : `${usage?.total.toLocaleString('zh-CN')} Token`}{!!usage?.missing && `（${usage.known} 次已采集，${usage.missing} 次未采集）`}</span></div>{run.trace.gap_reason && <p className="notice-line">采集说明：{run.trace.gap_reason}</p>}{run.error && <ErrorLine error={run.error} />}
      <section className="panel"><h2>时间概览</h2><p className="muted">横向位置对应真实时间；拖动选区或使用范围输入筛选记录。没有结束时间的步骤只显示开始点。工具耗时依据持久事件时间，不等于模型计时。</p><TimeOverview entries={entries} selected={selected?.id} range={range} onRange={chooseRange} onSelect={select} /></section>
      <div className="trace-layout"><section className="panel records-panel"><div className="panel-heading"><h2>执行记录 · {visible.length}</h2><button className="secondary-button" onClick={() => { setFollow(value => !value); setRange(null) }}>{follow ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}{follow ? '暂停跟随' : '跟随最新'}</button></div><div className="record-list" ref={listRef} onScroll={event => { const element = event.currentTarget; if (element.scrollHeight - element.scrollTop - element.clientHeight > 60) setFollow(false) }}>{visible.map(entry => <button key={entry.id} className={`record-row ${selected?.id === entry.id ? 'selected-record' : ''}`} aria-pressed={selected?.id === entry.id} onClick={() => select(entry)}>{entry.kind === 'tool' ? <Wrench size={16} aria-hidden /> : <Bot size={16} aria-hidden />}<div><strong>{entry.title}</strong><small>{formatTime(new Date(entry.start).toISOString())}</small><small>{entry.call ? milliseconds(entry.call.duration_ms) : entry.end !== null ? `${milliseconds(entry.end - entry.start)} · 事件时间差` : '结束时间未采集'}</small></div>{(entry.call || entry.tool) && <Badge value={(entry.call ?? entry.tool)!.status} />}</button>)}{!visible.length && <EmptyState title={entries.length ? '此范围没有记录' : '未采集执行步骤'} />}</div>{range && <button className="text-button" onClick={() => setRange(null)}>清除时间筛选</button>}</section>
      <section className="panel inspector-panel">{selected ? <Inspector key={`${runId}:${selected.id}`} run={run} entry={selected} user={user} /> : <EmptyState title={selectedId ? '该记录未采集或已过期' : '选择一条记录'} text="从时间概览或执行记录进入检查器。" />}</section></div>
    </>}
  </>
}
function TimeOverview({ entries, selected, range, onRange, onSelect }: { entries: TraceEntry[]; selected?: string; range: [number, number] | null; onRange: (range: [number, number] | null) => void; onSelect: (entry: TraceEntry) => void }) {
  const [zoom, setZoom] = useState(1), [draft, setDraft] = useState<[number, number] | null>(null)
  const [minimum, maximum] = extentOf(entries), span = maximum - minimum
  const anchor = useRef<number | null>(null), canvas = useRef<HTMLDivElement>(null)
  const activeRange = draft ?? range
  useEffect(() => {
    const target = Array.from(canvas.current?.querySelectorAll<HTMLButtonElement>('[data-record]') ?? []).find(button => button.dataset.record === selected)
    target?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' })
  }, [selected, zoom])
  function point(event: PointerEvent<HTMLDivElement>) { const rect = event.currentTarget.getBoundingClientRect(); return minimum + Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * span }
  if (!entries.length) return <EmptyState title="暂无可绘制时间记录" />
  return <><div className="timeline-controls"><label>时间缩放 <input type="range" min={1} max={8} step={0.5} value={zoom} onChange={event => setZoom(Number(event.target.value))} />{zoom} 倍</label><button className="text-button" onClick={() => { setZoom(1); onRange(null) }}>查看全部时间</button></div><div className="time-scroll"><div ref={canvas} className="time-canvas" style={{ width: `${zoom * 100}%` }}><div className="time-ticks"><span>{formatTime(new Date(minimum).toISOString())}</span><span>+{milliseconds(span)}</span></div><div className="brush-surface" onPointerDown={event => { anchor.current = point(event); setDraft([anchor.current, anchor.current]); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (anchor.current !== null) { const end = point(event); setDraft([Math.min(anchor.current, end), Math.max(anchor.current, end)]) } }} onPointerUp={event => { if (anchor.current !== null) { const end = point(event); onRange([Math.min(anchor.current, end), Math.max(anchor.current, end)]); anchor.current = null; setDraft(null) } }} onPointerCancel={() => { anchor.current = null; setDraft(null) }}><span>拖动选择时间范围</span>{activeRange && <div className="brush-selection" style={{ left: `${(activeRange[0] - minimum) / span * 100}%`, width: `${(activeRange[1] - activeRange[0]) / span * 100}%` }} />}</div>
      {entries.map(entry => <div key={entry.id} className={`time-lane ${entry.orphan ? 'unlinked-lane' : ''}`}><button data-record={entry.id} className={`time-bar ${entry.kind} ${selected === entry.id ? 'selected-bar' : ''} ${entry.end === null || entry.end === entry.start ? 'time-point' : ''}`} style={{ left: `${(entry.start - minimum) / span * 100}%`, width: entry.end !== null ? `${Math.max(0, entry.end - entry.start) / span * 100}%` : undefined }} onClick={() => onSelect(entry)} aria-label={`选择${entry.title}，${formatTime(new Date(entry.start).toISOString())}`} title={entry.title}><span>{entry.title}</span></button></div>)}
    </div></div><div className="range-inputs"><label>范围起点（相对毫秒）<input type="number" min={0} max={span} value={Math.round((range?.[0] ?? minimum) - minimum)} onChange={event => { const start = Math.max(0, Math.min(span, Number(event.target.value))) + minimum; onRange([start, Math.max(start, range?.[1] ?? maximum)]) }} /></label><label>范围终点（相对毫秒）<input type="number" min={0} max={span} value={Math.round((range?.[1] ?? maximum) - minimum)} onChange={event => { const end = Math.max(0, Math.min(span, Number(event.target.value))) + minimum; onRange([Math.min(end, range?.[0] ?? minimum), end]) }} /></label></div></>
}
interface Payload { status: 'available' | 'expired'; kind: string; body?: unknown; truncated?: boolean; original_bytes?: number }
interface Content { input_text: string; tools: { id: string; arguments: unknown; result: unknown }[] }
function Inspector({ run, entry, user }: { run: RunDetail; entry: TraceEntry; user: User }) {
  const [kind, setKind] = useState<string | null>(null), [contentOpen, setContentOpen] = useState(false)
  const call = entry.call, item = call?.payloads.find(payload => payload.kind === kind)
  const payload = useResource<Payload>(item && !item.expired && user.role === 'admin' ? `/runs/${run.id}/payloads/${item.id}` : null, call?.status === 'running' && kind === 'model_response', true)
  const content = useResource<Content>(contentOpen && user.role === 'admin' ? `/runs/${run.id}/content` : null, entry.tool?.status === 'running', true)
  const toolContent = content.data?.tools.find(tool => tool.id === entry.tool?.id)
  const partial = call?.status === 'running' || payload.data?.body && typeof payload.data.body === 'object' && 'partial' in payload.data.body && payload.data.body.partial === true
  const tokenDelay = call?.first_token_ms
  return <><p className="panel-kicker">所选记录检查器</p><h2>{entry.title}</h2><p className="muted mono">{entry.id}</p><dl className="metrics"><div><dt>开始时间</dt><dd>{formatTime(new Date(entry.start).toISOString())}</dd></div><div><dt>结束时间</dt><dd>{entry.end !== null ? formatTime(new Date(entry.end).toISOString()) : '未采集'}</dd></div>{call && <><div><dt>模型耗时</dt><dd>{milliseconds(call.duration_ms)}</dd></div><div><dt>首生成块延迟</dt><dd>{milliseconds(tokenDelay)}</dd></div><div><dt>首可见文本延迟</dt><dd>{milliseconds(call.first_visible_text_ms ?? delayMs(call.started_at, call.first_visible_text_at))}</dd></div><div><dt>首响应块延迟</dt><dd>{milliseconds(delayMs(call.started_at, call.first_response_at))}</dd></div><div><dt>输入 Token</dt><dd>{call.usage?.input_tokens?.toLocaleString('zh-CN') ?? '未采集'}</dd></div><div><dt>输出 Token</dt><dd>{call.usage?.output_tokens?.toLocaleString('zh-CN') ?? '未采集'}</dd></div><div><dt>总 Token</dt><dd>{call.usage?.total_tokens?.toLocaleString('zh-CN') ?? '未采集'}</dd></div></>}</dl>
    {call && <><p className="muted">首生成块包含工具或文本生成，排除空响应块；旧记录缺少该指标时显示未采集。首响应块与首文本时间差是墙钟口径，独立毫秒字段为单调时钟口径。</p>{call.usage?.input_token_details && <><h3>提供方输入 Token 明细</h3><JsonView value={call.usage.input_token_details} /></>}<p className="muted">用量来源：{call.usage_source === 'provider' ? '提供方返回' : '未采集'}{call.error_type && ` · 错误类型：${call.error_type}`}</p>{user.role === 'admin' ? <><div className="button-row"><button className="secondary-button" disabled={!call.payloads.some(value => value.kind === 'application_request')} onClick={() => setKind('application_request')}>查看请求上下文</button><button className="secondary-button" disabled={!call.payloads.some(value => value.kind === 'model_response')} onClick={() => setKind('model_response')}>查看模型输出</button></div><ErrorLine error={payload.error} />{kind && <p className="muted">{kind === 'application_request' ? '应用层请求快照；不是完整上游 HTTP 报文。' : '模型输出正文；执行中显示已持久化的部分输出。'} 每次读取记录访问审计。</p>}{item?.expired || payload.data?.status === 'expired' ? <p className="notice-line">正文已到期，不能从历史业务数据重建。</p> : payload.data?.status === 'available' ? <><p className="notice-line">{partial ? '部分输出，仍在采集' : '已保存正文'}{payload.data.truncated ? ` · 已截断，原始 ${payload.data.original_bytes?.toLocaleString('zh-CN')} 字节` : ''}</p><JsonView value={payload.data.body} /></> : kind && payload.busy ? <Loading /> : kind && !item ? <p className="muted">正文尚未采集。</p> : null}</> : <p className="muted">观察者可查看元数据，正文仅管理员可读。</p>}</>}
    {(entry.kind === 'tool' || entry.kind === 'queue') && <>{entry.tool?.error && <ErrorLine error={entry.tool.error} />}{user.role === 'admin' ? <><button className="secondary-button" onClick={() => { if (contentOpen) content.refresh(); else setContentOpen(true) }} disabled={content.busy}>{contentOpen ? '刷新正文' : entry.kind === 'tool' ? '读取工具输入输出' : '读取用户请求正文'}</button><ErrorLine error={content.error} />{contentOpen && content.busy && !content.data ? <Loading /> : content.data ? entry.kind === 'tool' ? toolContent ? <><h3>工具参数</h3><JsonView value={toolContent.arguments} /><h3>工具结果</h3><JsonView value={toolContent.result} /></> : <p className="muted">此工具正文未采集。</p> : <pre className="json-view">{content.data.input_text}</pre> : null}</> : <p className="muted">观察者无正文访问权限。</p>}</>}
    {entry.kind === 'end' && <p className="muted">此记录仅证明服务端运行已结束，不证明客户端已收到或展示。</p>}
  </>
}
