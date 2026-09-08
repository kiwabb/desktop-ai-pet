import { BookOpen, Check, CircleHelp, Eye, EyeOff, Heart, KeyRound, Link, LoaderCircle, LockKeyhole, RefreshCw, Save, ShieldCheck, Sparkles, Wifi } from 'lucide-react'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { connectionLabel, listAgentModels } from '../lib/agent'
import type { AgentMode, AgentView } from '../lib/agent'
import './AssistantSettings.css'

interface AssistantSettingsProps {
  status: AgentView | null
  mode: AgentMode
  baseUrl: string
  credential: string
  localBaseUrl: string
  localApiKey: string
  localModel: string
  saving: boolean
  error: string | null
  onModeChange: (mode: AgentMode) => void
  onBaseUrlChange: (value: string) => void
  onCredentialChange: (value: string) => void
  onLocalBaseUrlChange: (value: string) => void
  onLocalApiKeyChange: (value: string) => void
  onLocalModelChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}

export function AssistantSettings({ status, mode, baseUrl, credential, localBaseUrl, localApiKey, localModel, saving, error, onModeChange, onBaseUrlChange, onCredentialChange, onLocalBaseUrlChange, onLocalApiKeyChange, onLocalModelChange, onSubmit }: AssistantSettingsProps) {
  const id = useId()
  const [showCredential, setShowCredential] = useState(false)
  const [showLocalKey, setShowLocalKey] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const configured = status?.configured === true
  const savedMode = status?.mode ?? 'server'
  const reusingCredential = status?.server_has_token === true && baseUrl.replace(/\/$/, '') === status?.server_endpoint
  const reusingLocalKey = status?.local_has_key === true && localBaseUrl.replace(/\/$/, '') === status?.local_endpoint
  const connected = configured && status?.connection === 'connected'
  const serviceError = status?.error || status?.node_error

  async function loadModels() {
    setLoadingModels(true)
    setModelsError(null)
    try {
      setModelOptions(await listAgentModels(localBaseUrl, localApiKey))
    }
    catch (cause) {
      setModelOptions([])
      setModelsError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      setLoadingModels(false)
    }
  }

  return (
    <div className="assistant-settings">
      <div className="assistant-settings-grid">
        <form className="assistant-settings-card assistant-connection-card" onSubmit={onSubmit}>
          <div className="assistant-settings-mode" role="group" aria-label="助手模式">
            <button type="button" className={mode === 'server' ? 'is-active' : ''} aria-pressed={mode === 'server'} onClick={() => onModeChange('server')}>服务端</button>
            <button type="button" className={mode === 'local' ? 'is-active' : ''} aria-pressed={mode === 'local'} onClick={() => onModeChange('local')}>单机</button>
          </div>
          {mode === 'server' ? (
            <>
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
            </>
          ) : (
            <>
              <div className="assistant-settings-intro">
                <span className="assistant-settings-shield"><Sparkles aria-hidden="true" /></span>
                <div><h2>单机模式</h2><p>由本机直接调用模型服务，<br />无需启动助手服务端。</p></div>
              </div>
              <div className="assistant-settings-field">
                <label htmlFor={`${id}-local-url`}><Link aria-hidden="true" />模型服务地址</label>
                <input id={`${id}-local-url`} type="url" value={localBaseUrl} autoComplete="off" spellCheck={false} placeholder="https://api.example.com/v1" onChange={event => onLocalBaseUrlChange(event.target.value)} aria-describedby={`${id}-local-url-help`} />
                <details id={`${id}-local-url-help`} className="assistant-settings-help"><summary><CircleHelp aria-hidden="true" />什么是模型服务地址？</summary><p>OpenAI 兼容接口的根地址（含 /v1），远程地址必须使用 HTTPS，仅本机回环地址允许 HTTP。</p></details>
              </div>
              <div className="assistant-settings-field">
                <label htmlFor={`${id}-local-key`}><KeyRound aria-hidden="true" />API Key</label>
                <div className="assistant-settings-secret">
                  <input id={`${id}-local-key`} type={showLocalKey ? 'text' : 'password'} value={localApiKey} required={!reusingLocalKey} autoComplete="off" spellCheck={false} placeholder={reusingLocalKey ? '留空使用当前 API Key' : '输入模型服务的 API Key'} onChange={event => onLocalApiKeyChange(event.target.value)} aria-describedby={`${id}-local-key-help`} />
                  <button type="button" onClick={() => setShowLocalKey(value => !value)} aria-label={showLocalKey ? '隐藏 API Key' : '显示 API Key'} aria-pressed={showLocalKey}>{showLocalKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
                </div>
                <p className="assistant-settings-field-note" id={`${id}-local-key-help`}>保存在系统凭据存储中，仅用于调用模型服务。</p>
              </div>
              <div className="assistant-settings-field">
                <label htmlFor={`${id}-local-model`}><Sparkles aria-hidden="true" />模型名称</label>
                <div className="assistant-settings-models">
                  <input id={`${id}-local-model`} type="text" value={localModel} autoComplete="off" spellCheck={false} placeholder="例如 gpt-4o-mini" list={`${id}-model-options`} onChange={event => onLocalModelChange(event.target.value)} />
                  <button type="button" disabled={loadingModels} onClick={loadModels} aria-label="获取模型列表" title="获取模型列表">
                    {loadingModels ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                  </button>
                  <datalist id={`${id}-model-options`}>
                    {modelOptions.map(option => <option key={option} value={option} />)}
                  </datalist>
                </div>
                <p className="assistant-settings-field-note">{modelsError ?? (modelOptions.length > 0 ? '从模型服务获取的列表，可下拉选择或手动输入。' : '可点击右侧按钮获取模型列表，接口不可用时直接输入模型名称。')}</p>
              </div>
            </>
          )}
          {error && <div className="assistant-settings-error" role="alert">{error}</div>}
          <button className="assistant-settings-save" type="submit" disabled={saving}>
            <span>{saving ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}<strong>{saving ? '正在保存' : '保存并连接'}</strong></span>
            <small>{mode === 'server' ? '保存设置并连接到助手服务' : '保存设置并启用单机模式'}</small>
          </button>
        </form>
        <aside className="assistant-settings-aside" aria-label="连接状态与说明">
          <section className="assistant-settings-card assistant-status-card">
            <h2><ShieldCheck aria-hidden="true" />连接状态<span className={`assistant-settings-status-dot${connected ? ' is-connected' : ''}`} aria-hidden="true" /></h2>
            <div className={`assistant-settings-status${connected ? ' is-connected' : ''}`} role="status">
              <Wifi aria-hidden="true" /><div><strong>{connectionLabel(status)}</strong><small>{configured ? '当前已保存配置的连接状态' : '保存配置后开始连接'}</small></div>
            </div>
            {savedMode === 'server' ? (
              <dl><div><dt>服务地址</dt><dd>{status?.endpoint || '尚未配置'}</dd></div><div><dt>设备凭证</dt><dd>{configured ? '已配置' : '尚未配置'}</dd></div><div><dt>模型配置</dt><dd>{status?.model_configured ? '已配置' : '尚未配置'}</dd></div><div><dt>设备登记</dt><dd>{!configured ? '尚未配置' : status?.node_connected ? '已在线' : status?.node_error ? '暂时离线' : '等待登记'}</dd></div></dl>
            ) : (
              <dl><div><dt>模型服务地址</dt><dd>{status?.endpoint || '尚未配置'}</dd></div><div><dt>模型</dt><dd>{status?.model || '尚未配置'}</dd></div><div><dt>模型配置</dt><dd>{status?.model_configured ? '已配置' : '尚未配置'}</dd></div></dl>
            )}
            {serviceError && <p className="assistant-settings-error" role="alert">{serviceError}</p>}
          </section>
          <section className="assistant-settings-card assistant-guide-card">
            <h2><BookOpen aria-hidden="true" />使用说明</h2>
            {savedMode === 'server' ? (
              <ol><li><span>1</span>填写助手服务的访问地址。</li><li><span>2</span>输入服务签发的设备凭证。</li><li><span>3</span>保存并连接，查看连接状态。</li></ol>
            ) : (
              <ol><li><span>1</span>填写模型服务地址和 API Key。</li><li><span>2</span>获取模型列表并选择模型。</li><li><span>3</span>保存后即可开始对话。</li></ol>
            )}
          </section>
          <section className="assistant-settings-card assistant-security-card">
            <h2><LockKeyhole aria-hidden="true" />安全提示</h2>
            {savedMode === 'server' ? (
              <ul><li><Check aria-hidden="true" />设备凭证请勿分享给他人。</li><li><Check aria-hidden="true" />仅连接来自可信来源的服务。</li><li><Check aria-hidden="true" />连接异常时，检查地址和凭证。</li></ul>
            ) : (
              <ul><li><Check aria-hidden="true" />API Key 请勿分享给他人。</li><li><Check aria-hidden="true" />仅连接来自可信来源的模型服务。</li><li><Check aria-hidden="true" />远程模型服务必须使用 HTTPS。</li></ul>
            )}
          </section>
        </aside>
      </div>
      <footer className="assistant-settings-footer"><span>有助手 · 每一天都更可爱 <Heart aria-hidden="true" /></span></footer>
    </div>
  )
}
