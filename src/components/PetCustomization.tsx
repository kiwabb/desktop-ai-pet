import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ImagePlus, LoaderCircle, Palette, RotateCcw, Square, Trash2, Upload, X } from 'lucide-react'
import { useCustomization } from '../lib/useCustomization'
import { loadPetBadge, loadPetSprites, PET_KINDS, PET_KIND_LABELS, readReference, validateReferenceFiles } from '../lib/customization'
import type { BadgeUpdate, PetKind, PetSprites, PetTheme } from '../lib/customization'
import { presetTheme } from '../lib/customization-theme'
import { PetThemePreview } from './PetThemePicker'
import { ReferenceThemeQueue } from '../lib/reference-theme-queue'
import './PetCustomization.css'
import { BadgeMark } from './CompanionBadge'

export function PetCustomization({ hidden = false }: { hidden?: boolean }) {
  const { view, available, error: syncError, refresh, mutate, activate } = useCustomization()
  useEffect(() => {
    if (hidden || !available) return
    let disposed = false
    void refresh().catch(() => { if (!disposed) setError('主题服务信息读取失败，请重新读取定制信息。') })
    return () => { disposed = true }
  }, [hidden, available, refresh])
  const [files, setFiles] = useState<File[]>([])
  const [selectionId, setSelectionId] = useState<string | null>(null)
  const [preparingTheme, setPreparingTheme] = useState(false)
  const themeQueue = useRef<ReferenceThemeQueue | null>(null)
  if (!themeQueue.current) themeQueue.current = new ReferenceThemeQueue(mutate)
  useEffect(() => () => themeQueue.current?.dispose(), [])
  const [references, setReferences] = useState<string[]>([])
  const [name, setName] = useState('我的伙伴')
  const [selected, setSelected] = useState<string | null>(null)
  const [sprites, setSprites] = useState<PetSprites | null>(null)
  const [badgeDraft, setBadgeDraft] = useState<BadgeUpdate | undefined>()
  const [badgeSrc, setBadgeSrc] = useState<string | null>(null)
  const [badgeLoading, setBadgeLoading] = useState(false)
  const [badgeError, setBadgeError] = useState<string | null>(null)
  const [kind, setKind] = useState<PetKind>('base')
  const [accent, setAccent] = useState('#d39964')
  const [theme, setTheme] = useState<PetTheme | undefined>()
  const [rename, setRename] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const settingsDirty = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsUrlRef = useRef<HTMLInputElement>(null)
  const settingsFocusPending = useRef(false)
  useLayoutEffect(() => {
    if (!settingsFocusPending.current) return
    settingsFocusPending.current = false
    if (hidden) return
    const target = settingsOpen ? settingsUrlRef.current : settingsButtonRef.current
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  }, [settingsOpen, hidden])
  const previousReady = useRef<string | null>(null)
  const observedBadgeRun = useRef<string | null>(null)
  const preset = view?.presets.find(item => item.id === selected)
  const job = view?.job
  const badgeJob = view?.badge_job?.preset_id === preset?.id ? view?.badge_job : null
  const badgeRunning = view?.badge_job?.status === 'running'
  const running = job?.status === 'running' || badgeRunning
  const badgeToken = badgeDraft?.action === 'reset' ? null : badgeDraft?.action === 'select' ? badgeDraft.token : preset?.badge
  useEffect(() => { setBadgeDraft(undefined) }, [preset?.id, preset?.badge])
  useEffect(() => {
    if (badgeJob?.status === 'running') { observedBadgeRun.current = badgeJob.id; setBadgeDraft(undefined); return }
    // Only completion observed in this open preset starts a preview. A saved
    // candidate on reopen/reset requires explicit reuse, never an implicit edit.
    if (badgeJob?.status === 'ready' && badgeJob.result && observedBadgeRun.current === badgeJob.id) setBadgeDraft({ action: 'select', token: badgeJob.result })
    observedBadgeRun.current = null
  }, [badgeJob?.id, badgeJob?.status, badgeJob?.result, preset?.id])
  useEffect(() => {
    let disposed = false
    setBadgeSrc(null); setBadgeError(null); setBadgeLoading(!!badgeToken)
    if (preset) void loadPetBadge(preset.id, badgeToken).then(src => { if (!disposed) setBadgeSrc(src) }).catch(() => { if (!disposed) setBadgeError('标志无法读取，暂时显示原猫爪。请重新生成或恢复猫爪。') }).finally(() => { if (!disposed) setBadgeLoading(false) })
    return () => { disposed = true }
  }, [preset?.id, badgeToken])
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file))
    setReferences(urls)
    return () => urls.forEach(url => URL.revokeObjectURL(url))
  }, [files])
  useEffect(() => {
    if (!view || settingsDirty.current) return
    setBaseUrl(view.settings.base_url); setModel(view.settings.model)
  }, [view])
  useEffect(() => {
    if (job?.status === 'ready' && previousReady.current !== job.id) {
      previousReady.current = job.id; setSelected(job.id)
    }
  }, [job])
  useEffect(() => {
    setSprites(null); setDeleteId(null)
    if (!preset) return
    let disposed = false
    setRename(preset.name); setAccent(preset.accent); setTheme(preset.theme ?? undefined)
    void loadPetSprites(preset.id).then(next => { if (!disposed) setSprites(next) })
      .catch(() => { if (!disposed) setError('预览图片无法打开，请重试或重新生成。') })
    return () => { disposed = true }
  }, [preset?.id, preset?.accent, preset?.name, JSON.stringify(preset?.theme)])
  async function run(action: () => Promise<unknown>, success?: string) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null); setNotice(null)
    try { await action(); if (success) setNotice(success) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function selectFiles(next: File[]) {
    try {
      if (next.length) validateReferenceFiles(next)
      const selection = crypto.randomUUID()
      setFiles(next); setSelectionId(selection); setError(null); setPreparingTheme(next.length > 0)
      themeQueue.current!.select(next.length ? signal => Promise.all(next.map(file => readReference(file, signal))) : null, selection, setError, () => setPreparingTheme(false))
    } catch (cause) { setError((cause as Error).message) }
  }
  function addFiles(next: File[]) { selectFiles([...files, ...next]) }
  async function generate() {
    await run(async () => {
      validateReferenceFiles(files)
      if (!name.trim() || [...name.trim()].length > 40) throw new Error('请填写 1–40 个字的伙伴名字。')
      if (!themeReady || !themeDraft) throw new Error('请等待这组图片的主题设计完成。')
      await mutate('start', { name: name.trim(), draftId: themeDraft.id, themeAttempt: themeDraft.attempt })
    })
  }
  async function savePreset() {
    if (!preset) return
    await mutate('update', { id: preset.id, name: rename.trim(), accent, ...(theme ? { theme } : {}), ...(badgeDraft ? { badge: badgeDraft } : {}) })
    setBadgeDraft(undefined)
  }
  const themeDraft = view?.theme_draft?.selection_id === selectionId ? view.theme_draft : null
  const themeReady = !!selectionId && files.length > 0 && !preparingTheme && themeDraft?.status === 'ready' && !!themeDraft.theme
  const configured = !!view?.settings.base_url && !!view.settings.model
  const previewStyle = presetTheme(accent, theme)
  const retryDisclosure = <p className="customization-disclosure">发送到 <strong>{view?.settings.base_url || '尚未配置服务'}</strong>，模型 <strong>{view?.settings.model || '尚未配置'}</strong>。重做陪伴形象为 4 次请求，其余单个状态为 1 次；按实际服务计费。</p>
  return <section className="pet-customization" hidden={hidden} aria-label="定制桌宠" onKeyDown={event => {
    if (event.key === 'Escape' && deleteId) { event.stopPropagation(); event.preventDefault(); setDeleteId(null) }
  }}>
    <div className="customization-heading"><div><h2>把喜欢的模样，留在身边</h2><p>几张参考图，一个属于你的伙伴。</p></div><Palette size={25} aria-hidden="true" /></div>
    {!available && <p className="customization-notice">请在桌面应用中上传和生成。浏览器预览不会调用图片服务。</p>}
    {(error || syncError) && <div className="customization-error" role="alert"><span>{error || syncError}</span>{syncError && <button type="button" onClick={() => void run(refresh)}>重新读取</button>}</div>}
    {view?.warning && <p className="customization-notice" role="status">{view.warning}</p>}
    {notice && <p className="customization-notice" role="status">{notice}</p>}

    <div className="customization-library">
      <div className="customization-section-title"><h3>我的桌宠</h3><button type="button" disabled={busy || !available || view?.active_id === 'default'} onClick={() => void run(() => activate('default'), '已恢复原来的白猫与奶油杏色主题。')}><RotateCcw size={14} aria-hidden="true" />恢复默认</button></div>
      <div className="customization-preset-list" role="group" aria-label="已保存的桌宠">
        <button type="button" aria-pressed={!selected} onClick={() => { setSelected(null); setError(null) }}><ImagePlus size={15} aria-hidden="true" />新伙伴</button>
        {view?.presets.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setError(null) }}><span className="customization-swatch" style={{ background: item.accent }} />{item.name}{view.active_id === item.id && <Check size={14} aria-label="正在使用" />}</button>)}
      </div>
    </div>

    {preset && <div className="customization-preview" style={previewStyle}>
      <div className="customization-section-title"><h3>先看看它的模样</h3><span>预览不会改变桌面</span></div>
      <div className="customization-portrait">{sprites ? <img src={sprites[kind]} alt={`${preset.name}的${PET_KIND_LABELS[kind]}形象`} /> : <p>正在读取形象…</p>}</div>
      <div className="customization-states" aria-label="预览动作">{PET_KINDS.map(state => <button type="button" key={state} aria-pressed={kind === state} onClick={() => setKind(state)}>{PET_KIND_LABELS[state]}</button>)}</div>
      <p className="customization-hint">确认四个状态是同一个伙伴，毛发边缘和落脚点自然，再应用。</p>
      <PetThemePreview accent={accent} theme={theme} saved />
      <div className="customization-badge" aria-label="配套猫爪">
        <div className="customization-badge-preview"><BadgeMark src={badgeSrc} className="customization-badge-mark" /><div><h3>它的专属猫爪</h3><p>{badgeLoading ? '正在读取标志…' : badgeDraft ? '预览中，保存后才会替换面板标志。' : '根据这只伙伴的模样，生成同色系小猫爪。'}</p></div></div>
        <div className="customization-actions"><button type="button" disabled={busy || running || !available || !configured} onClick={() => void run(() => mutate('badge_start', { id: preset.id }))}><ImagePlus size={15} aria-hidden="true" />{badgeJob?.status === 'running' ? '正在生成猫爪…' : badgeJob ? '重新生成猫爪' : '生成配套猫爪'}</button>
          {badgeJob?.status === 'ready' && badgeJob.result && badgeJob.result !== badgeToken && <button type="button" disabled={busy || running} onClick={() => { setBadgeDraft({ action: 'select', token: badgeJob.result! }); setBadgeError(null) }}>使用已生成猫爪</button>}
          <button type="button" disabled={busy || badgeRunning || (!badgeToken && !badgeDraft)} onClick={() => { setBadgeDraft({ action: 'reset' }); setBadgeError(null) }}><RotateCcw size={14} aria-hidden="true" />恢复原猫爪</button>
          {badgeJob?.status === 'running' && <button type="button" disabled={busy} onClick={() => void run(() => mutate('badge_cancel', { id: badgeJob.id }))}>取消生成</button>}
        </div>
        <p className="customization-hint">点击生成会把当前伙伴形象发送到 {view?.settings.base_url || '尚未配置的图片服务'}（{view?.settings.model || '未配置模型'}），发起 1 次收费图片请求。取消仅停止本地等待；使用已生成猫爪不会再次请求。</p>
        {badgeJob && <p className="customization-hint" role="status">猫爪已发起 {badgeJob.request_count} 次请求。{badgeJob.status === 'running' ? '生成中，当前标志保持不变。' : badgeJob.status === 'ready' ? '已生成，请预览后保存。' : badgeJob.status === 'cancelled' ? '已取消，不会自动重试。' : badgeJob.status === 'interrupted' ? '上次生成已中断，不会自动重试。' : '生成未完成，不会自动重试。'}</p>}
        {(badgeError || badgeJob?.error) && <p className="customization-error" role="alert">{badgeError || badgeJob?.error}</p>}
      </div>
      <div className="customization-edit-row"><label>伙伴名字<input value={rename} maxLength={40} onChange={event => setRename(event.target.value)} /></label></div>
      <div className="customization-actions"><button type="button" className="customization-primary" disabled={busy || badgeLoading || (badgeDraft?.action === 'select' && !!badgeError) || !sprites || running || !rename.trim()} onClick={() => void run(async () => { await loadPetSprites(preset.id); await savePreset(); await activate(preset.id) }, '已应用到桌宠和所有面板。')}><Check size={15} aria-hidden="true" />{busy ? '正在保存…' : '应用到桌面'}</button>
        <button type="button" disabled={busy || badgeLoading || (badgeDraft?.action === 'select' && !!badgeError) || running || !rename.trim()} onClick={() => void run(savePreset, view?.active_id === preset.id ? '当前方案已更新。' : '方案已保存，尚未应用。')}>保存修改</button>
        <button type="button" disabled={busy || running || view?.active_id === preset.id} onClick={() => setDeleteId(preset.id)} aria-label={`删除${preset.name}`}><Trash2 size={15} aria-hidden="true" />删除</button>
      </div>
      {view?.active_id === preset.id && <p className="customization-hint">正在使用的方案，保存修改后会同步到桌面。恢复默认或切换后才能删除。</p>}
      {deleteId === preset.id && <div className="customization-delete" role="group" aria-label="确认删除"><p>删除「{preset.name}」及其生成图片？无法撤销。</p><button type="button" disabled={busy} onClick={() => void run(async () => { await mutate('delete', { id: preset.id }); setSelected(null) }, '方案已删除。')}>确认删除</button><button type="button" onClick={() => setDeleteId(null)}>保留</button></div>}
      {job?.id === preset.id && !running && view?.active_id !== preset.id && <details className="customization-retry"><summary>对某个状态不满意？</summary><p>重做陪伴形象会重建全部四个状态。</p>{retryDisclosure}{PET_KINDS.map(state => <button type="button" disabled={busy} key={state} onClick={() => void run(() => mutate('retry', { id: job.id, stage: state }))}>重做{PET_KIND_LABELS[state]}</button>)}</details>}
    </div>}

    {!preset && <div className="customization-create">
      <label className="customization-name">给它一个名字<input value={name} maxLength={40} onChange={event => setName(event.target.value)} disabled={running || busy} placeholder="例如：团团" /></label>
      <div className="customization-import-intro"><h3>导入图片，AI 为它设计主题</h3><p>AI 会看角色的颜色与气质，设计面板、按钮和材质。</p>
        {view?.theme_service?.available ? <p className="customization-disclosure">添加或移除图片会自动发送这组图片到 <strong>{view.theme_service.base_url}</strong>，由 <strong>{view.theme_service.model}</strong> 设计主题，每次 1 次模型请求；后续生成桌宠另需 4 次图片请求。</p> : <p className="customization-notice">先在右上角助手设置中连接支持看图的聊天模型，再导入参考图。</p>}
      </div>
      <div className="customization-reference-grid">{files.map((file, index) => <div className="customization-reference" key={`${file.name}-${index}`}><img src={references[index]} alt={`参考图 ${index + 1}：${file.name}`} /><button type="button" disabled={busy || running} aria-label={`移除参考图${index + 1}`} onClick={() => selectFiles(files.filter((_, i) => i !== index))}><X size={14} aria-hidden="true" /></button></div>)}
        {files.length < 4 && <label className={`customization-upload${busy || running ? ' is-disabled' : ''}`}><Upload size={22} aria-hidden="true" /><span>{files.length ? '再加一张' : '上传参考图'}</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy || running || !available || !view?.theme_service?.available} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} /></label>}
      </div>
      <p className="customization-hint">选择同一个角色的 1–4 张清晰照片或插画。PNG / JPEG / WebP，每张最多 10 MB，合计 30 MB。</p>
      {files.length > 0 && <div className="customization-theme-progress" aria-live="polite">
        {(preparingTheme || themeDraft?.status === 'running') && <p><LoaderCircle size={17} className="customization-spinner" aria-hidden="true" />{preparingTheme ? '正在检查参考图…' : 'AI 正在看图，设计专属主题…'}</p>}
        {themeDraft && <p className="customization-hint">主题分析已发起 {themeDraft.request_count} 次请求。</p>}
        {themeDraft?.error && <p className="customization-error" role="alert">{themeDraft.error}</p>}
        {themeDraft && ['failed', 'cancelled', 'interrupted'].includes(themeDraft.status) && <button type="button" disabled={busy || running || preparingTheme} onClick={() => void run(() => mutate('theme_retry', { id: themeDraft.id }))}><RotateCcw size={14} aria-hidden="true" />重新设计主题</button>}
        {themeReady && <PetThemePreview accent={themeDraft!.theme!.primary} theme={themeDraft!.theme!} />}
      </div>}
      <div className="customization-provider"><div><strong>{configured ? '图片服务已配置' : '先连接图片服务'}</strong><p>{configured ? view?.settings.model : '与聊天服务分开，图片只在你开始生成后发送。'}</p></div><button ref={settingsButtonRef} type="button" aria-expanded={settingsOpen} onClick={() => { settingsFocusPending.current = true; setSettingsOpen(value => !value) }}>{settingsOpen ? '收起设置' : configured ? '修改服务' : '配置服务'}</button></div>
      {configured && <p className="customization-disclosure">点击开始将把参考图发送到 <strong>{view?.settings.base_url}</strong>，通常发起 4 次图片请求。服务商按实际调用计费，取消不能保证停止计费。</p>}
      <button type="button" className="customization-primary customization-generate" disabled={!available || !configured || !files.length || !themeReady || !name.trim() || busy || running} onClick={() => void generate()}><ImagePlus size={17} aria-hidden="true" />生成我的桌宠</button>
    </div>}

    {settingsOpen && <form className="customization-settings" onSubmit={event => { event.preventDefault(); void run(async () => { await mutate('save_settings', { settings: { base_url: baseUrl.trim(), model: model.trim(), api_key: key, clear_key: clearKey } }); setKey(''); setClearKey(false); settingsDirty.current = false }, '图片服务设置已保存；尚未发起生成请求。') }}>
      <h3>图片服务</h3><p>需要支持参考图编辑、透明 PNG 和 base64 图片返回的服务。仅在你点击“使用聊天连接”时复制聊天地址和密钥，图片模型保持独立。</p>
      <button type="button" disabled={!available || busy || running || !model.trim()} onClick={() => void run(async () => {
        const saved = await mutate('use_chat_connection', { model: model.trim() })
        setBaseUrl(saved.settings.base_url); setModel(saved.settings.model); setKey(''); setClearKey(false); settingsDirty.current = false
      }, '已复制聊天地址和密钥并保存；尚未发起生成请求。')}>使用聊天连接</button>
      <label>API 地址<input ref={settingsUrlRef} type="url" required value={baseUrl} placeholder="https://你的服务/v1" onChange={event => { settingsDirty.current = true; setBaseUrl(event.target.value); setKey('') }} /></label>
      <label>图片模型<input required value={model} placeholder="服务商提供的图片模型名称" onChange={event => { settingsDirty.current = true; setModel(event.target.value) }} /></label>
      <label>API Key<input type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)} placeholder={view?.settings.has_key ? '已保存；同地址留空保留' : '仅保存到系统凭据存储'} /></label>
      <label className="customization-checkbox"><input type="checkbox" checked={clearKey} onChange={event => setClearKey(event.target.checked)} />清除已保存的图片密钥</label>
      <button type="submit" disabled={!available || busy || running}>保存图片服务</button>
    </form>}
    {job && <div className="customization-job" aria-label="生成任务"><div className="customization-section-title"><h3>{job.name}</h3><span>{job.status === 'running' ? '生成中' : job.status === 'ready' ? '已生成，等待应用' : job.status === 'cancelled' ? '已取消' : job.status === 'interrupted' ? '上次生成已中断' : '生成未完成'}</span></div>
      <ol>{PET_KINDS.map(state => <li key={state} data-done={job.completed.includes(state)}>{job.completed.includes(state) ? <Check size={15} aria-hidden="true" /> : job.status === 'running' && job.stage === state ? <LoaderCircle className="customization-spinner" size={15} aria-hidden="true" /> : <span className="customization-stage-dot" />}<span>{PET_KIND_LABELS[state]}</span></li>)}</ol>
      <p role="status">{job.status === 'running' ? job.stage === 'saving' ? '检查图片并保存配套主题…' : `正在生成${PET_KIND_LABELS[job.stage]}形象，请稍候。` : '不会自动重试收费请求。'} 已发起 {job.request_count} 次请求。</p>
      {job.error && <p className="customization-error" role="alert">{job.error}</p>}
      {!running && job.status !== 'ready' && <p className="customization-disclosure">继续会向 <strong>{view?.settings.base_url || '尚未配置服务'}</strong>（{view?.settings.model || '尚未配置模型'}）发起 {PET_KINDS.filter(state => !job.completed.includes(state)).length} 次请求；已完成的图片会保留。</p>}
      {job.status === 'running' ? <button type="button" disabled={busy} onClick={() => void run(() => mutate('cancel', { id: job.id }))}><Square size={13} aria-hidden="true" />取消生成</button> : job.status !== 'ready' && <button type="button" disabled={busy} onClick={() => void run(() => mutate('retry', { id: job.id, stage: null }))}><RotateCcw size={14} aria-hidden="true" />继续生成未完成状态</button>}
    </div>}
  </section>
}
