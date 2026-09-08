import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { safeMessageUrl } from '../lib/chat-interaction'
import './MessageContent.css'

function CodeBlock({ children }: ComponentPropsWithoutRef<'pre'>) {
  const codeRef = useRef<HTMLPreElement>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

  useEffect(() => {
    setCopyState('idle')
  }, [children])

  async function copyCode() {
    const text = codeRef.current?.textContent
    if (text === undefined || text === null) return
    try {
      await navigator.clipboard.writeText(text)
      // Streaming can extend a block while the clipboard write is pending.
      setCopyState(codeRef.current?.textContent === text ? 'copied' : 'idle')
    }
    catch {
      setCopyState('error')
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

const components = {
  pre: CodeBlock,
  a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => {
    const safeHref = href && safeMessageUrl(href)
    return safeHref ? <a href={safeHref} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
  },
  // Model-provided image URLs must never trigger remote tracking requests.
  img: ({ alt }: ComponentPropsWithoutRef<'img'>) => <span className="message-image-description">{alt ? `图片：${alt}` : '图片（未自动加载）'}</span>,
}

export function MessageContent({ content }: { content: string }) {
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMessageUrl} components={components}>{content}</Markdown></div>
}
