import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CheckCircle2, Copy, Smartphone, X } from 'lucide-react'
import { api, messageOf, operationKey, pagePath, useQuery, useResource, write } from './api'
import type { PageResult, User } from './api'
import { EmptyState, ErrorLine, formatTime, Loading, PageIntro, Pager, Refresh } from './ui'
interface Account { id: string; name: string; created_at: string }
interface Device { id: string; account_id: string; account_name: string; name: string; roles: string[]; revoked_at: string | null; created_at: string }
interface Credential { device_id: string; account_id: string; device_token?: string; credential_unavailable: boolean }
export function AccountsPage({ user }: { user: User }) {
  const query = useQuery(), ac = query.get('accounts_cursor'), dc = query.get('devices_cursor')
  const accounts = useResource<PageResult<Account>>(pagePath('/accounts', ac))
  const devices = useResource<PageResult<Device>>(pagePath('/devices', dc))
  const [name, setName] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [issue, setIssue] = useState<{ account: Account; name: string } | null>(null)
  const [credential, setCredential] = useState<Credential | null>(null)
  const [busy, setBusy] = useState(false), lock = useRef(false)
  const [copyError, setCopyError] = useState(''), [copying, setCopying] = useState(false)
  const accountKey = useRef<{ body: string; key: string } | null>(null)
  const deviceKey = useRef<{ body: string; key: string } | null>(null)
  const refresh = () => { accounts.refresh(); devices.refresh() }
  async function mutate(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await work(); refresh() } catch (cause) { setError(messageOf(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const body = { name: name.trim() }
    void mutate(async () => { await api('/accounts', write(body, operationKey(accountKey, body))); accountKey.current = null; setName(''); setNotice('账号已创建。') })
  }
  function issueDevice(event: FormEvent) {
    event.preventDefault()
    if (!issue?.name.trim()) return
    const body = { account_id: issue.account.id, name: issue.name.trim(), roles: ['control', 'node'] }
    void mutate(async () => {
      const result = await api<Credential>('/devices', write(body, operationKey(deviceKey, body)))
      deviceKey.current = null; setIssue(null); setCopyError(''); setCredential(result)
    })
  }
  function revoke(id: string) {
    if (!window.confirm('确认撤销此设备凭证？撤销后该凭证不能继续访问。')) return
    void mutate(async () => { await api(`/devices/${id}/revoke`, write()); setNotice('设备凭证已撤销。'); if (credential?.device_id === id) setCredential(null) })
  }
  async function copy() {
    if (!credential?.device_token || copying) return
    setCopying(true); setCopyError('')
    try { await navigator.clipboard.writeText(credential.device_token); setCredential(null); setNotice('设备凭证已复制。') }
    catch { setCopyError('复制失败，凭证已保留。请手动选中复制，或重试。') }
    finally { setCopying(false) }
  }
  return <><PageIntro title="账号与设备" action={<Refresh busy={accounts.busy || devices.busy} onClick={refresh} />}>设备凭证仅签发时展示一次，请在关闭前妥善保存。</PageIntro>
    <ErrorLine error={error || accounts.error || devices.error} />{notice && <p className="notice-line" role="status">{notice}</p>}
    <div className="two-column accounts-layout"><section className="panel"><div className="panel-heading"><h2>业务账号</h2></div>
      {user.role === 'admin' && <form className="inline-form" onSubmit={create}><input aria-label="新账号名称" value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} placeholder="新账号名称" required /><button className="primary-button" disabled={busy || !name.trim()}>创建账号</button></form>}
      {!accounts.data ? accounts.busy ? <Loading /> : null : <><div className="table-wrap"><table><thead><tr><th>账号</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{accounts.data.items.map(account => <tr key={account.id}><td><strong>{account.name}</strong><small>{account.id}</small></td><td>{formatTime(account.created_at)}</td><td>{user.role === 'admin' && <button className="text-button" disabled={busy} onClick={() => { setError(''); setIssue({ account, name: '' }) }}>发放设备</button>}</td></tr>)}</tbody></table></div>{!accounts.data.items.length && <EmptyState title="暂无业务账号" />}</>}
      <Pager cursor={ac} next={accounts.data?.next_cursor} queryKey="accounts_cursor" busy={accounts.busy} />
    </section><section className="panel"><h2>设备凭证</h2>{!devices.data ? devices.busy ? <Loading /> : null : <div className="device-list">{devices.data.items.map(device => <div className="device-row" key={device.id}><Smartphone size={18} aria-hidden /><div><strong>{device.name}</strong><small>{device.account_name} · {device.roles.map(role => role === 'control' ? '控制端' : '节点端').join(' / ')}</small><small>{device.id}</small></div><span className={`status-pill ${device.revoked_at ? 'muted-pill' : 'green-pill'}`}>{device.revoked_at ? '已撤销' : '有效'}</span>{user.role === 'admin' && !device.revoked_at && <button className="icon-button danger" disabled={busy} aria-label={`撤销设备 ${device.name}`} onClick={() => revoke(device.id)}><X size={16} aria-hidden /></button>}</div>)}{!devices.data.items.length && <EmptyState title="暂无设备" />}</div>}<Pager cursor={dc} next={devices.data?.next_cursor} queryKey="devices_cursor" busy={devices.busy} /></section></div>
    {issue && <div className="modal-backdrop"><form className="modal config-form" role="dialog" aria-modal="true" aria-labelledby="issue-title" onSubmit={issueDevice}><h2 id="issue-title">为 {issue.account.name} 发放设备</h2><label>设备名称<input autoFocus value={issue.name} maxLength={200} required disabled={busy} onChange={event => setIssue({ ...issue, name: event.target.value })} /></label><p className="muted">此设备具有控制与节点权限。</p><ErrorLine error={error} /><div className="button-row"><button className="primary-button" disabled={busy || !issue.name.trim()}>{busy ? '签发中…' : '签发凭证'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setIssue(null)}>取消</button></div></form></div>}
    {credential && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="credential-title"><CheckCircle2 size={22} aria-hidden /><h2 id="credential-title">{credential.credential_unavailable ? '设备已创建，原凭证无法恢复' : '设备凭证已签发'}</h2><p className="muted">设备标识：{credential.device_id}</p>{credential.credential_unavailable ? <><p className="muted">本次为同一操作的重试。此前签发的凭证仍有效，但不能再次查询；请撤销该设备后重新签发。</p><button className="secondary-button" disabled={busy} onClick={() => revoke(credential.device_id)}>撤销此设备</button></> : <><p className="muted">关闭后无法再次查看。请复制或手动保存。</p><code className="secret-box" tabIndex={0}>{credential.device_token}</code><ErrorLine error={copyError} /><button className="primary-button" disabled={copying} onClick={() => void copy()}><Copy size={16} aria-hidden />{copying ? '复制中…' : '复制并关闭'}</button></>}<ErrorLine error={error} /><button className="text-button" disabled={copying || busy} onClick={() => { if (credential.credential_unavailable || window.confirm('已保存凭证？关闭后无法再次查询。')) setCredential(null) }}>关闭</button></section></div>}
  </>
}
