import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, messageOf, pagePath, updateQuery, useQuery, useResource, write } from './api'
import type { User } from './api'
import { ErrorLine, formatTime, JsonView, Loading, PageIntro, Pager, Refresh } from './ui'
export interface ConfigVersion { id: string; base_url: string; model_name: string; timeout_seconds: number; has_key: boolean; created_at: string; tested?: boolean; rollback_source_version_id?: string | null; key_source?: string | null }
export interface ConfigState { management_enabled: boolean; revision: number; active: ConfigVersion | null; versions: ConfigVersion[]; next_cursor: string | null }
export function ModelPage({ user }: { user: User }) {
  const query = useQuery(), cursor = query.get('model_cursor'), selectedId = query.get('version')
  const resource = useResource<ConfigState>(pagePath('/model-config', cursor))
  const [created, setCreated] = useState<ConfigVersion | null>(null)
  const state = resource.data
  const selected = state?.versions.find(version => version.id === selectedId) ?? (created?.id === selectedId ? created : null) ?? (state?.active?.id === selectedId ? state.active : null)
  const [form, setForm] = useState({ base_url: '', model_name: '', timeout_seconds: 90, api_key: '' })
  const [keySource, setKeySource] = useState('current'), [busy, setBusy] = useState(false), lock = useRef(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [testResult, setTestResult] = useState<unknown>(null)
  const lastSelection = useRef<string | null>(null)
  useEffect(() => {
    if (selected && lastSelection.current !== selected.id) {
      lastSelection.current = selected.id
      setForm({ base_url: selected.base_url, model_name: selected.model_name, timeout_seconds: selected.timeout_seconds, api_key: '' }); setTestResult(null)
    }
  }, [selected])
  async function action(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await work(); resource.refresh() } catch (cause) { setError(messageOf(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  function choose(version: ConfigVersion) { setCreated(version); setTestResult(null); updateQuery({ version: version.id }) }
  function save(event: FormEvent) {
    event.preventDefault()
    void action(async () => {
      const version = await api<ConfigVersion>('/model-config/drafts', write({ ...form, api_key: form.api_key || null, parent_version_id: selected?.id ?? state?.active?.id ?? null }))
      setForm(value => ({ ...value, api_key: '' })); setCreated(version); updateQuery({ version: version.id, model_cursor: null }); setNotice('草稿已保存，尚未改变生效配置。')
    })
  }
  function test() {
    if (!selected) return
    const versionId = selected.id
    void action(async () => {
      const result = await api<{ status: string; error_message: string | null }>(`/model-config/${versionId}/test`, write())
      setTestResult(result)
      if (result.status === 'succeeded') setNotice('所选版本的基础流式连接测试通过；不代表业务工具兼容性已验证。')
      else setError(result.error_message ?? '模型连接测试失败')
    })
  }
  function publish() {
    if (!state || !selected) return
    const version = selected
    void action(async () => { await api('/model-config/publish', write({ version_id: version.id, expected_revision: state.revision })); setNotice(`版本 ${version.id.slice(0, 8)} 已发布，新请求使用此版本；已接收任务保持原版本。`) })
  }
  function rollback() {
    if (!selected) return
    void action(async () => {
      const result = await api<{ draft: ConfigVersion }>('/model-config/rollback', write({ version_id: selected.id, key_source: keySource }))
      setCreated(result.draft); updateQuery({ version: result.draft.id, model_cursor: null }); setNotice('回滚候选已创建并选中，请先测试该候选，再发布。')
    })
  }
  return <><PageIntro title="模型配置" action={<Refresh busy={resource.busy || busy} onClick={resource.refresh} />}>保存草稿、显式测试、发布与回滚；每个新请求绑定接收时的配置版本。</PageIntro><ErrorLine error={error || resource.error} />{notice && <p className="notice-line" role="status">{notice}</p>}
    {!state ? resource.busy ? <Loading /> : null : <div className="two-column model-layout"><section className="panel"><p className="panel-kicker">当前配置 · 修订 {state.revision}</p><h2>{state.management_enabled ? state.active?.model_name ?? '尚无生效版本' : '环境配置模式'}</h2><p className="muted">{state.active ? `${state.active.base_url} · ${state.active.timeout_seconds} 秒` : state.management_enabled ? '请测试并发布有效版本。' : '当前由服务启动配置生效；后台版本尚未接管。'}</p>
      {!state.management_enabled && user.role === 'admin' && <button className="secondary-button" disabled={busy} onClick={() => void action(async () => { await api('/model-config/enable', write()); setNotice('数据库配置模式已启用。') })}>启用数据库配置模式</button>}
      <hr /><h2>{selected ? `已选版本 ${selected.id.slice(0, 8)}` : '新建配置草稿'}</h2><p className="muted">{selected ? `创建于 ${formatTime(selected.created_at)}。编辑后保存会创建新版本；测试和发布仅针对所选已保存版本。` : selectedId ? '所选版本不在当前页，请翻页或重新选择。' : '未选择历史版本，密钥留空将沿用当前生效版本。'}</p>
      <form className="config-form" onSubmit={save}><fieldset disabled={busy || user.role !== 'admin'}><label>服务地址<input value={form.base_url} onChange={event => setForm({ ...form, base_url: event.target.value })} required placeholder="https://provider.example/v1" /></label><label>模型名称<input value={form.model_name} onChange={event => setForm({ ...form, model_name: event.target.value })} required maxLength={256} /></label><div className="form-grid"><label>超时（秒）<input type="number" min={5} max={600} required value={form.timeout_seconds} onChange={event => setForm({ ...form, timeout_seconds: Number(event.target.value) })} /></label><label>替换密钥<input type="password" value={form.api_key} onChange={event => setForm({ ...form, api_key: event.target.value })} autoComplete="new-password" placeholder="留空沿用所选版本密钥" /></label></div>{user.role === 'admin' && <div className="button-row"><button className="primary-button">保存为新草稿</button></div>}</fieldset></form>
      {user.role === 'admin' && selected && <section className="version-actions"><h3>操作已保存版本</h3><p className="muted">连接测试会发起真实模型请求并产生用量，不调用业务工具。</p><div className="button-row"><button className="secondary-button" disabled={busy} onClick={test}>{busy ? '操作进行中…' : '执行真实连接测试'}</button><button className="primary-button" disabled={busy || !selected.tested || !state.management_enabled} onClick={publish}>发布所选版本</button></div><label className="select-label">回滚使用的密钥<select value={keySource} disabled={busy} onChange={event => setKeySource(event.target.value)}><option value="current">沿用当前生效版本密钥</option><option value="historical">使用所选历史版本密钥</option></select></label><button className="secondary-button" disabled={busy} onClick={rollback}>以所选版本创建回滚候选</button></section>}
      {testResult !== null && <section><h3>本次测试结果</h3><JsonView value={testResult} /></section>}
    </section><section className="panel"><h2>版本历史</h2><div className="version-list">{state.versions.map(version => <button key={version.id} className={`version-row version-choice ${selectedId === version.id ? 'selected-version' : ''}`} disabled={busy} aria-pressed={selectedId === version.id} onClick={() => choose(version)}><div><strong>{version.model_name}{version.id === state.active?.id ? ' · 当前生效' : ''}</strong><small>{version.id}</small><small>{version.base_url}</small><small>{formatTime(version.created_at)} · {version.has_key ? '密钥已加密' : '无密钥'}</small>{version.rollback_source_version_id && <small>回滚来源：{version.rollback_source_version_id.slice(0, 8)}</small>}</div><span className={`status-pill ${version.tested ? 'green-pill' : 'muted-pill'}`}>{version.tested ? '测试通过' : '待测试'}</span></button>)}</div>{!state.versions.length && <p className="muted">暂无配置版本。</p>}<Pager cursor={cursor} next={state.next_cursor} queryKey="model_cursor" busy={busy || resource.busy} /></section></div>}
  </>
}
