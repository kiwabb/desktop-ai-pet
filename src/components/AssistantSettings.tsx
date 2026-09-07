import { BookOpen, Check, CircleHelp, Eye, EyeOff, Heart, KeyRound, Link, LoaderCircle, LockKeyhole, Save, ShieldCheck, Sparkles, Wifi } from 'lucide-react'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { connectionLabel } from '../lib/agent'
import type { AgentView } from '../lib/agent'
import './AssistantSettings.css'

interface AssistantSettingsProps {
  status: AgentView | null
  baseUrl: string
  credential: string
  saving: boolean
  error: string | null
  onBaseUrlChange: (value: string) => void
  onCredentialChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}

export function AssistantSettings({ status, baseUrl, credential, saving, error, onBaseUrlChange, onCredentialChange, onSubmit }: AssistantSettingsProps) {
  const id = useId()
  const [showCredential, setShowCredential] = useState(false)
  const configured = status?.configured === true
  const reusingCredential = configured && baseUrl.replace(/\/$/, '') === status?.endpoint
  const connected = configured && status?.connection === 'connected'
  const serviceError = status?.error || status?.node_error

  return (
    <div className="assistant-settings">
      <div className="assistant-settings-grid">
        <form className="assistant-settings-card assistant-connection-card" onSubmit={onSubmit}>
          <div className="assistant-settings-intro">
            <span className="assistant-settings-shield"><ShieldCheck aria-hidden="true" /></span>
            <div><h2>连接助手服务</h2><p>填写服务地址和设备凭证，<br />模型由服务端配置。</p></div>
          </div>
          <div className="assistant-settings-field">
            <label htmlFor={`${id}-url`}><Link aria-hidden="true" />服务地址</label>
            <input id={`${id}-url`} type="url" value={baseUrl} required autoComplete="off" spellCheck={false} placeholder="https://assistant.example.com" onChange={event => onBaseUrlChange(event.target.value)} aria-describedby={`${id}-url-help`} />
            <details id={`${id}-url-help`} className="assistant-settings-help"><summary><CircleHelp aria-hidden="true" />什么是服务地址？</summary><p>运行助手服务的访问地址，由服务提供方提供，例如 http://127.0.0.1:18081。</p></details>
          </div>
          <div className="assistant-settings-field">
            <label htmlFor={`${id}-credential`}><KeyRound aria-hidden="true" />设备凭证</label>
            <div className="assistant-settings-secret">
              <input id={`${id}-credential`} type={showCredential ? 'text' : 'password'} value={credential} required={!reusingCredential} autoComplete="off" spellCheck={false} placeholder={reusingCredential ? '留空使用当前设备凭证' : '输入服务签发的设备凭证'} onChange={event => onCredentialChange(event.target.value)} aria-describedby={`${id}-credential-help`} />
              <button type="button" onClick={() => setShowCredential(value => !value)} aria-label={showCredential ? '隐藏设备凭证' : '显示设备凭证'} aria-pressed={showCredential}>{showCredential ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
            </div>
            <p className="assistant-settings-field-note" id={`${id}-credential-help`}>保存在本机私有文件中，用于设备身份验证。</p>
          </div>
          <section className="assistant-settings-model" aria-label="服务端模型">
            <h3><Sparkles aria-hidden="true" />助手模型</h3>
            <span className="assistant-settings-model-chip">{status?.model || (status?.model_configured ? '服务端未返回模型名称' : '尚未配置')}</span>
            <p>{status?.model_configured ? '由助手服务配置和管理' : '连接后由服务端提供模型配置'}</p>
          </section>
          {error && <div className="assistant-settings-error" role="alert">{error}</div>}
          <button className="assistant-settings-save" type="submit" disabled={saving}>
            <span>{saving ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}<strong>{saving ? '正在保存' : '保存并连接'}</strong></span>
            <small>保存设置并连接到助手服务</small>
          </button>
        </form>
        <aside className="assistant-settings-aside" aria-label="连接状态与说明">
          <section className="assistant-settings-card assistant-status-card">
            <h2><ShieldCheck aria-hidden="true" />连接状态<span className={`assistant-settings-status-dot${connected ? ' is-connected' : ''}`} aria-hidden="true" /></h2>
            <div className={`assistant-settings-status${connected ? ' is-connected' : ''}`} role="status">
              <Wifi aria-hidden="true" /><div><strong>{connectionLabel(status)}</strong><small>{configured ? '当前已保存配置的连接状态' : '保存配置后开始连接'}</small></div>
            </div>
            <dl><div><dt>服务地址</dt><dd>{status?.endpoint || '尚未配置'}</dd></div><div><dt>设备凭证</dt><dd>{configured ? '已配置' : '尚未配置'}</dd></div><div><dt>模型配置</dt><dd>{status?.model_configured ? '已配置' : '尚未配置'}</dd></div><div><dt>设备登记</dt><dd>{!configured ? '尚未配置' : status?.node_connected ? '已在线' : status?.node_error ? '暂时离线' : '等待登记'}</dd></div></dl>
            {serviceError && <p className="assistant-settings-error" role="alert">{serviceError}</p>}
          </section>
          <section className="assistant-settings-card assistant-guide-card">
            <h2><BookOpen aria-hidden="true" />使用说明</h2>
            <ol><li><span>1</span>填写助手服务的访问地址。</li><li><span>2</span>输入服务签发的设备凭证。</li><li><span>3</span>保存并连接，查看连接状态。</li></ol>
          </section>
          <section className="assistant-settings-card assistant-security-card">
            <h2><LockKeyhole aria-hidden="true" />安全提示</h2>
            <ul><li><Check aria-hidden="true" />设备凭证请勿分享给他人。</li><li><Check aria-hidden="true" />仅连接来自可信来源的服务。</li><li><Check aria-hidden="true" />连接异常时，检查地址和凭证。</li></ul>
          </section>
        </aside>
      </div>
      <footer className="assistant-settings-footer"><span>有助手 · 每一天都更可爱 <Heart aria-hidden="true" /></span></footer>
    </div>
  )
}
