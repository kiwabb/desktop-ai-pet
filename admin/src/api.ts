import { useCallback, useEffect, useRef, useState } from 'react'

export interface User { id: string; username: string; role: 'admin' | 'observer' }
export interface PageResult<T> { items: T[]; next_cursor: string | null }
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : '请求失败，请重试'
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/admin/v1${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', headers })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('admin-session-expired'))
    throw new ApiError(body?.detail?.message ?? (response.status === 403 ? '当前身份没有权限执行此操作' : '管理请求失败，请重试'), response.status)
  }
  if (body === null) throw new ApiError('服务端返回了无法读取的响应', response.status)
  return body as T
}
export function write(body?: unknown, idempotencyKey?: string): RequestInit {
  const csrf = document.cookie.split('; ').find(item => item.startsWith('pet_admin_csrf='))?.slice('pet_admin_csrf='.length) ?? ''
  return { method: 'POST', headers: { 'X-CSRF-Token': decodeURIComponent(csrf), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }
}
export function updateQuery(values: Record<string, string | null>, replace = false) {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(values)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key)
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
  window.dispatchEvent(new Event('admin-location'))
}
export function useQuery() {
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search))
  useEffect(() => {
    const sync = () => setQuery(new URLSearchParams(window.location.search))
    window.addEventListener('popstate', sync); window.addEventListener('admin-location', sync)
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('admin-location', sync) }
  }, [])
  return query
}
// One request at a time. Poll only after completion, pause/abort while hidden,
// and fence results by effect lifetime so navigation cannot publish old data.
export function useResource<T>(path: string | null, poll = false, sensitive = false) {
  const [result, setResult] = useState<{ path: string; data: T } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => refreshRef.current(), [])
  useEffect(() => {
    if (!path) { setResult(null); setBusy(false); setError(''); return }
    let alive = true, inFlight = false, failures = 0, resume = false
    let timer: number | undefined, controller: AbortController | undefined
    const load = async () => {
      if (!alive || inFlight || (poll && document.hidden)) return
      window.clearTimeout(timer); resume = false; inFlight = true; controller = new AbortController(); setBusy(true)
      try {
        const data = await api<T>(path, { ...(sensitive ? write() : {}), signal: controller.signal })
        if (alive) { setResult({ path, data }); setError(''); failures = 0 }
      } catch (cause) {
        if (alive && !controller.signal.aborted) {
          if (sensitive && cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) setResult(null)
          setError(messageOf(cause)); failures++
        }
      } finally {
        inFlight = false
        if (alive) {
          setBusy(false)
          if (!document.hidden && (poll || resume)) { const delay = resume ? 0 : Math.min(1000 * 2 ** failures, 30000); resume = false; timer = window.setTimeout(() => void load(), delay) }
        }
      }
    }
    const visibility = () => {
      window.clearTimeout(timer)
      if (document.hidden) controller?.abort()
      else if (inFlight) resume = true
      else void load()
    }
    refreshRef.current = () => {
      // A mutation may complete while the prior list request is still pending.
      // Keep one follow-up refresh rather than silently swallowing invalidation.
      if (inFlight || document.hidden) { resume = true; return }
      void load()
    }
    document.addEventListener('visibilitychange', visibility)
    setError(''); void load()
    return () => { alive = false; window.clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); refreshRef.current = () => {} }
  }, [path, poll, sensitive])
  return { data: result?.path === path ? result.data : null, error, busy, refresh }
}
export function pagePath(path: string, cursor: string | null, extra?: Record<string, string>) {
  const query = new URLSearchParams({ limit: '40', ...extra })
  if (cursor) query.set('cursor', cursor)
  for (const [key, value] of query) if (!value) query.delete(key)
  return `${path}?${query}`
}
// The idempotency key survives uncertain responses; changing the operation body
// starts a new operation. Only call from a locked submit handler.
export function operationKey(ref: { current: { body: string; key: string } | null }, body: unknown) {
  const serialized = JSON.stringify(body)
  if (ref.current?.body !== serialized) ref.current = { body: serialized, key: crypto.randomUUID() }
  return ref.current!.key
}
