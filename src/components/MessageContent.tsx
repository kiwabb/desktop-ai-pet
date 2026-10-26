import { Check, Copy } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { ComponentPropsWithoutRef, KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { safeMessageUrl } from '../lib/chat-interaction'
import './MessageContent.css'

function CodeBlock({ children }: ComponentPropsWithoutRef<'pre'>) {
  const codeRef = useRef<HTMLPreElement>(null)
  const copyIntentRef = useRef(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

  useEffect(() => {
    copyIntentRef.current += 1
    setCopyState('idle')
  }, [children])

  useEffect(() => () => { copyIntentRef.current += 1 }, [])

  async function copyCode() {
    const text = codeRef.current?.textContent
    if (text === undefined || text === null) return
    const intent = ++copyIntentRef.current
    try {
      await navigator.clipboard.writeText(text)
      // Streaming can extend a block while the clipboard write is pending.
      if (intent === copyIntentRef.current) setCopyState(codeRef.current?.textContent === text ? 'copied' : 'idle')
    }
    catch {
      if (intent === copyIntentRef.current) setCopyState('error')
    }
  }

  return (
    <div className="message-code-block">
      <div className="message-code-toolbar"><span role="status">{copyState === 'copied' ? '代码已复制' : '代码'}</span><button type="button" onClick={() => { void copyCode() }} aria-label="复制代码">{copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copyState === 'copied' ? '已复制' : '复制代码'}</button></div>
      <pre ref={codeRef}>{children}</pre>
      {copyState === 'error' && <p className="message-copy-error" role="alert">复制失败，请选择代码后手动复制。</p>}
    </div>
  )
}

function handleTableKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const table = event.currentTarget
  if (event.defaultPrevented || event.target !== table || table.ownerDocument.activeElement !== table
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
    || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
  const maximum = table.scrollWidth - table.clientWidth
  if (maximum <= 0 || table.clientWidth <= 0) return
  const step = Math.min(160, Math.max(48, table.clientWidth * .6))
  const left = Math.max(0, Math.min(maximum, table.scrollLeft + (event.key === 'ArrowRight' ? step : -step)))
  event.preventDefault()
  table.scrollTo({ left, behavior: 'instant' })
}

function MessageTable({ children }: ComponentPropsWithoutRef<'table'>) {
  return <div className="message-table-scroll" role="region" aria-label="回复中的表格" tabIndex={0} onKeyDown={handleTableKeyDown}><table>{children}</table></div>
}

const components = {
  pre: CodeBlock,
  table: MessageTable,
  a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => {
    const safeHref = href && safeMessageUrl(href)
    return safeHref ? <a href={safeHref} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
  },
  // Model-provided image URLs must never trigger remote tracking requests.
  img: ({ alt }: ComponentPropsWithoutRef<'img'>) => <span className="message-image-description">{alt ? `图片：${alt}` : '图片（未自动加载）'}</span>,
}

export const MessageContent = memo(function MessageContent({ content }: { content: string }) {
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMessageUrl} components={components}>{content}</Markdown></div>
})
