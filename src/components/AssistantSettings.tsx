import { ArrowLeft, Check, ChevronDown, CircleHelp, Eye, EyeOff, Laptop, LoaderCircle, LockKeyhole, RefreshCw, Save, Server, Wifi } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { connectionLabel, listAgentModels } from '../lib/agent'
import type { AgentMode, AgentView } from '../lib/agent'
import { utilityErrorMessage } from '../lib/utility-feedback'
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
  success?: string | null
  onReturnToChat?: () => void
  onModeChange: (mode: AgentMode) => void
  onBaseUrlChange: (value: string) => void
  onCredentialChange: (value: string) => void
  onLocalBaseUrlChange: (value: string) => void
  onLocalApiKeyChange: (value: string) => void
  onLocalModelChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}

const normalizedEndpoint = (value: string | null | undefined) => (value ?? '').trim().replace(/\/+$/, '')

export function AssistantSettings({ status, mode, baseUrl, credential, localBaseUrl, localApiKey, localModel, saving, error, success, onReturnToChat, onModeChange, onBaseUrlChange, onCredentialChange, onLocalBaseUrlChange, onLocalApiKeyChange, onLocalModelChange, onSubmit }: AssistantSettingsProps) {
  const id = useId()
  const [showCredential, setShowCredential] = useState(false)
  const [showLocalKey, setShowLocalKey] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const modelsRequestRef = useRef(0)
  const modelsBusyRef = useRef(false)
  const modelConfigRef = useRef({ mode, localBaseUrl, localApiKey, generation: status?.generation })
  // Compare actual submitted configuration too: a result can settle after render
  // but before the effect below invalidates its request number.
  modelConfigRef.current = { mode, localBaseUrl, localApiKey, generation: status?.generation }
  const configured = status?.configured === true
  const savedMode = status?.mode ?? 'server'
  const reusingCredential = status?.server_has_token === true && normalizedEndpoint(baseUrl) === normalizedEndpoint(status.server_endpoint)
  const reusingLocalKey = status?.local_has_key === true && normalizedEndpoint(localBaseUrl) === normalizedEndpoint(status.local_endpoint)
  const connected = configured && status?.connection === 'connected'
  const serviceError = status?.error || status?.node_error
  const savedLocal = savedMode === 'local'
  const localConnectionText = !configured ? '尚未启用单机模式'
    : status?.connection === 'connecting' ? '正在连接本机助手'
      : !connected ? '本机助手暂不可用，请检查连接'
        : status?.model_configured ? '本机已就绪，等待对话' : '本机待办可用，模型尚未配置'

  useEffect(() => {
    ++modelsRequestRef.current
    modelsBusyRef.current = false
    setLoadingModels(false)
    setModelsLoaded(false)
    setModelOptions([])
    setModelsError(null)
    return () => { ++modelsRequestRef.current }
  }, [mode, localBaseUrl, localApiKey, status?.generation])

  useEffect(() => {
    setShowCredential(false)
    setShowLocalKey(false)
  }, [mode, status?.generation, saving])

  async function loadModels() {
    if (modelsBusyRef.current || saving || mode !== 'local') return
    const request = ++modelsRequestRef.current
    const submitted = modelConfigRef.current
    const isCurrent = () => {
      const current = modelConfigRef.current
      return request === modelsRequestRef.current && current.mode === submitted.mode
        && current.localBaseUrl === submitted.localBaseUrl && current.localApiKey === submitted.localApiKey
        && current.generation === submitted.generation
    }
    modelsBusyRef.current = true
    setLoadingModels(true)
    setModelsError(null)
    try {
      const options = await listAgentModels(localBaseUrl, localApiKey)
      if (!isCurrent()) return
      setModelOptions([...new Set(options)])
      setModelsLoaded(true)
    }
    catch (cause) {
      if (!isCurrent()) return
      console.error('[AssistantSettings] 模型列表读取失败', cause)
      setModelOptions([])
      setModelsLoaded(false)
      setModelsError(utilityErrorMessage(cause, '未能读取模型列表。可以重试，或直接输入模型名称。', 'settings'))
    }
    finally {
      if (isCurrent()) {
        modelsBusyRef.current = false
        setLoadingModels(false)
      }
    }
  }

  function closeDisclosure(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== 'Escape' || !event.currentTarget.open) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.open = false
    event.currentTarget.querySelector('summary')?.focus()
  }

  return (
    <div className="assistant-settings">
      <section className="assistant-settings-connection" aria-label="已保存配置的连接状态">
        <div className="assistant-settings-status-heading"><h2>当前连接</h2><span>{savedLocal ? '单机模式' : '服务端模式'}</span></div>
        <div className={`assistant-settings-status${connected ? ' is-connected' : ''}`} role="status"><Wifi aria-hidden="true" /><strong>{savedLocal ? localConnectionText : connectionLabel(status)}</strong></div>
        <dl><div><dt>{savedLocal ? '模型地址' : '服务地址'}</dt><dd>{status?.endpoint || '尚未配置'}</dd></div><div><dt>模型</dt><dd>{status?.model || (status?.model_configured ? '已配置，服务未返回名称' : '尚未配置')}</dd></div>{!savedLocal && <div><dt>设备登记</dt><dd>{!configured ? '尚未配置' : status?.node_connected ? '已在线' : status?.node_error ? '暂时离线' : '等待登记'}</dd></div>}</dl>
        {serviceError && <p className="assistant-settings-error" role="alert">{utilityErrorMessage(serviceError, '连接暂不可用，请检查服务是否运行，以及地址和凭证。', 'settings')}</p>}
      </section>
      <form className="assistant-connection-card" onSubmit={event => { if (saving) event.preventDefault(); else onSubmit(event) }} aria-busy={saving}>
        <fieldset className="assistant-settings-fields" disabled={saving}>
          <legend className="sr-only">助手连接设置</legend>
          <div className="assistant-settings-mode" role="group" aria-label="助手模式">
            <button type="button" className={mode === 'server' ? 'is-active' : ''} aria-pressed={mode === 'server'} onClick={() => onModeChange('server')}><Server aria-hidden="true" />服务端</button>
            <button type="button" className={mode === 'local' ? 'is-active' : ''} aria-pressed={mode === 'local'} onClick={() => onModeChange('local')}><Laptop aria-hidden="true" />单机</button>
          </div>
          <div className="assistant-settings-intro">
            <h2>编辑连接配置</h2>
            <p>{mode === 'server' ? '连接后，橘伴会通过助手服务处理聊天与待办。' : '由本机直接调用模型，聊天与待办保存在本机。'}</p>
          </div>
          {mode === 'server' ? <>
            <div className="assistant-settings-field">
              <label htmlFor={`${id}-url`}>服务地址</label>
              <input id={`${id}-url`} type="url" value={baseUrl} required autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://assistant.example.com" onChange={event => onBaseUrlChange(event.target.value)} aria-describedby={`${id}-url-help`} />
              <p id={`${id}-url-help`} className="assistant-settings-field-note">使用服务提供方给你的访问地址。</p>
            </div>
            <div className="assistant-settings-field">
              <label htmlFor={`${id}-credential`}>设备凭证</label>
              <div className="assistant-settings-secret">
                <input id={`${id}-credential`} type={showCredential ? 'text' : 'password'} value={credential} required={!reusingCredential} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={reusingCredential ? '留空保留已保存的凭证' : '输入服务签发的设备凭证'} onChange={event => onCredentialChange(event.target.value)} aria-describedby={`${id}-credential-help`} />
                <button type="button" onClick={() => setShowCredential(value => !value)} aria-label={showCredential ? '隐藏设备凭证' : '显示设备凭证'} aria-pressed={showCredential} title={showCredential ? '隐藏设备凭证' : '显示设备凭证'}>{showCredential ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
              </div>
              <p className="assistant-settings-field-note" id={`${id}-credential-help`}>凭证保存在本机私有文件中；更换服务地址需重新填写。</p>
            </div>
          </> : <>
            <div className="assistant-settings-field">
              <label htmlFor={`${id}-local-url`}>模型服务地址</label>
              <input id={`${id}-local-url`} type="url" value={localBaseUrl} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://api.example.com/v1" onChange={event => onLocalBaseUrlChange(event.target.value)} aria-describedby={`${id}-local-url-help`} />
              <p id={`${id}-local-url-help`} className="assistant-settings-field-note">填写兼容接口的根地址，通常以 /v1 结尾。</p>
            </div>
            <div className="assistant-settings-field">
              <label htmlFor={`${id}-local-key`}>API Key</label>
              <div className="assistant-settings-secret">
                <input id={`${id}-local-key`} type={showLocalKey ? 'text' : 'password'} value={localApiKey} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={reusingLocalKey ? '留空保留已保存的 API Key' : '输入模型服务的 API Key'} onChange={event => onLocalApiKeyChange(event.target.value)} aria-describedby={`${id}-local-key-help`} />
                <button type="button" onClick={() => setShowLocalKey(value => !value)} aria-label={showLocalKey ? '隐藏 API Key' : '显示 API Key'} aria-pressed={showLocalKey} title={showLocalKey ? '隐藏 API Key' : '显示 API Key'}>{showLocalKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
              </div>
              <p className="assistant-settings-field-note" id={`${id}-local-key-help`}>密钥保存在系统凭据存储中，仅用于模型调用。</p>
            </div>
            <div className="assistant-settings-field">
              <label htmlFor={`${id}-local-model`}>模型名称</label>
              <div className="assistant-settings-models">
                <input id={`${id}-local-model`} type="text" value={localModel} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="输入模型名称，或获取可用列表" list={`${id}-model-options`} aria-describedby={`${id}-model-help`} onChange={event => onLocalModelChange(event.target.value)} />
                <button type="button" disabled={loadingModels || !localBaseUrl.trim()} onClick={() => void loadModels()} aria-label={loadingModels ? '正在获取模型列表' : '获取模型列表'} title="获取模型列表" aria-busy={loadingModels}>
                  {loadingModels ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                </button>
                <datalist id={`${id}-model-options`}>{modelOptions.map(option => <option key={option} value={option} />)}</datalist>
              </div>
              <p id={`${id}-model-help`} className={`assistant-settings-field-note${modelsError ? ' is-error' : ''}`} role={modelsError ? 'alert' : 'status'}>
                {loadingModels ? '正在读取服务提供的模型…' : modelsError ?? (modelsLoaded ? modelOptions.length ? `已读取 ${modelOptions.length} 个模型，可选择或手动输入。` : '服务未返回模型；请直接输入可用的模型名称。' : '点击右侧获取列表，也可以直接输入模型名称。')}
              </p>
            </div>
          </>}
        </fieldset>
        <div className="assistant-settings-submit">
          {error && <p className="assistant-settings-error" role="alert">{utilityErrorMessage(error, '设置未保存，请检查填写内容后重试。', 'settings')}</p>}
          {success && <div className="assistant-settings-success" role="status"><Check aria-hidden="true" /><div><strong>{success}</strong><p>配置已保存；是否可用请查看上方的当前连接。</p></div></div>}
          <div className="assistant-settings-submit-actions">
            <button className="assistant-settings-save" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}{saving ? '正在保存…' : '保存并连接'}</button>
            {success && onReturnToChat && <button className="assistant-settings-return" type="button" disabled={saving} onClick={onReturnToChat}><ArrowLeft aria-hidden="true" />返回聊天</button>}
          </div>
        </div>
      </form>
      <details className="assistant-settings-help" onKeyDown={closeDisclosure}>
        <summary><CircleHelp aria-hidden="true" />{mode === 'local' ? '单机模式怎么设置？' : '服务端模式怎么设置？'}<ChevronDown aria-hidden="true" /></summary>
        <div>{mode === 'local' ? <p>填写模型服务地址、API Key 和模型名称后保存。暂不配置模型也能使用本机待办；聊天需模型配置完整。模型地址仅支持兼容的接口，远程地址必须使用 HTTPS，本机回环地址可以使用 HTTP。</p> : <p>填写助手服务的地址与设备凭证，保存后查看连接状态。模型由服务端配置和管理；本机服务地址例如 http://127.0.0.1:18081，远程服务须使用 HTTPS。</p>}</div>
      </details>
      <p className="assistant-settings-security"><LockKeyhole aria-hidden="true" />{mode === 'local' ? 'API Key 不会显示在聊天记录中。请只连接可信的模型服务。' : '设备凭证用于验证身份，请勿分享给他人。'}</p>
    </div>
  )
}
