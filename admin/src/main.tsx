import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowUpRight, Bot, ChevronRight, ClipboardList, Cpu, LayoutDashboard, LogOut, Menu, ShieldCheck, Users, Wrench, X } from 'lucide-react'
import { api, ApiError, messageOf, updateQuery, useQuery, write } from './api'
import type { User } from './api'
import { AccountsPage } from './accounts'
import { ModelPage } from './models'
import { RunsPage } from './runs'
import { OverviewPage, SystemPage, TodosPage, ToolsPage } from './pages'
import { ErrorLine, ErrorState, Loading } from './ui'
import './styles.css'
const nav = [['overview', '总览', LayoutDashboard], ['accounts', '账号与设备', Users], ['runs', '会话与运行', Activity], ['todos', '待办与提醒', ClipboardList], ['model', '模型配置', Cpu], ['tools', '工具目录', Wrench], ['system', '系统与审计', ShieldCheck]] as const
function Login({ onLogin, notice }: { onLogin: (user: User) => void; notice: string }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), lock = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { const result = await api<{ user: User }>('/auth/login', write({ username, password })); setPassword(''); onLogin(result.user) }
    catch (cause) { setError(messageOf(cause)) } finally { setBusy(false); lock.current = false }
  }
  return <main className="login-shell"><div className="login-glow" aria-hidden /><form className="login-card" onSubmit={event => void submit(event)}><div className="brand-mark"><Bot size={22} aria-hidden /></div><p className="eyebrow">桌宠服务 · 内部管理</p><h1>服务端控制台</h1><p className="muted">使用独立管理账号登录。</p>{notice && <p className="notice-line" role="status">{notice}</p>}<label>用户名<input autoFocus autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} disabled={busy} required /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required /></label><ErrorLine error={error} /><button className="primary-button" disabled={busy}>{busy ? '验证中…' : '登录控制台'}<ArrowUpRight size={16} aria-hidden /></button></form></main>
}
function App() {
  const query = useQuery(), page = nav.some(item => item[0] === query.get('page')) ? query.get('page')! : 'overview'
  const [user, setUser] = useState<User | null>(null), [checking, setChecking] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [sidebar, setSidebar] = useState(false), [leaving, setLeaving] = useState(false)
  const generation = useRef(0), logoutLock = useRef(false)
  async function check() {
    const own = ++generation.current; setChecking(true); setError('')
    try { const result = await api<{ user: User }>('/auth/me'); if (own === generation.current) setUser(result.user) }
    catch (cause) { if (own === generation.current) { setUser(null); if (!(cause instanceof ApiError && cause.status === 401)) setError(messageOf(cause)) } }
    finally { if (own === generation.current) setChecking(false) }
  }
  useEffect(() => {
    void check()
    const expired = () => { ++generation.current; setUser(null); setChecking(false); setNotice('管理会话已失效，请重新登录。'); setError('') }
    window.addEventListener('admin-session-expired', expired)
    return () => { ++generation.current; window.removeEventListener('admin-session-expired', expired) }
  }, [])
  async function logout() {
    if (logoutLock.current) return
    logoutLock.current = true; setLeaving(true); setError('')
    try { await api('/auth/logout', write()); setUser(null); setNotice('已退出登录。') }
    catch (cause) { if (!(cause instanceof ApiError && cause.status === 401)) setError(messageOf(cause)) }
    finally { logoutLock.current = false; setLeaving(false) }
  }
  if (checking) return <Loading />
  if (!user) return error ? <main className="login-shell"><ErrorState message={error} retry={() => void check()} /></main> : <Login notice={notice} onLogin={value => { setUser(value); setError(''); setNotice('') }} />
  const content = page === 'overview' ? <OverviewPage /> : page === 'accounts' ? <AccountsPage user={user} /> : page === 'runs' ? <RunsPage user={user} /> : page === 'todos' ? <TodosPage user={user} /> : page === 'model' ? <ModelPage user={user} /> : page === 'tools' ? <ToolsPage /> : <SystemPage user={user} />
  return <div className="app-shell"><aside className={`sidebar ${sidebar ? 'open' : ''}`}><div className="sidebar-brand"><div className="brand-mark"><Bot size={19} aria-hidden /></div><div><strong>桌宠服务</strong><small>内部控制台</small></div><button className="icon-button mobile-close" onClick={() => setSidebar(false)} aria-label="关闭菜单"><X size={17} aria-hidden /></button></div><nav className="sidebar-nav" aria-label="管理页面">{nav.map(([key, text, Icon]) => <button key={key} className={`nav-item ${key === page ? 'active' : ''}`} aria-current={key === page ? 'page' : undefined} onClick={() => { updateQuery({ page: key }); setSidebar(false) }}><Icon size={17} aria-hidden /><span>{text}</span>{key === page && <ChevronRight size={15} aria-hidden />}</button>)}</nav><div className="sidebar-footer"><div className="user-chip"><div className="avatar">{user.username.slice(0, 1)}</div><div><strong>{user.username}</strong><small>{user.role === 'admin' ? '管理员' : '只读观察者'}</small></div></div><button className="logout-button" disabled={leaving} onClick={() => void logout()}><LogOut size={15} aria-hidden />{leaving ? '退出中…' : '退出登录'}</button></div></aside><main className="main-content"><header className="topbar"><button className="icon-button menu-button" onClick={() => setSidebar(true)} aria-label="打开菜单"><Menu size={19} aria-hidden /></button><div className="crumb"><span>服务端管理</span><ChevronRight size={14} aria-hidden /><strong>{nav.find(item => item[0] === page)?.[1]}</strong></div><span className="muted">内部工作区</span></header><div className="page-content"><ErrorLine error={error} />{content}</div></main></div>
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
