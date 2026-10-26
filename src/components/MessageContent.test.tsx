import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MessageContent } from './MessageContent'

function render(content: string) {
  return renderToStaticMarkup(<MessageContent content={content} />)
}

describe('message Markdown rendering (isolated SSR)', () => {
  it('keeps table semantics inside a named keyboard-accessible scrolling region', () => {
    const markup = render('| 方法 | 适合情况 |\n| :--- | ---: |\n| 按项目分类 | 多个项目并行 |')
    expect(markup).toContain('class="message-table-scroll" role="region" aria-label="回复中的表格" tabindex="0"><table>')
    expect(markup).toContain('<thead>')
    expect(markup).toContain('<tbody>')
    expect(markup).toContain('<th style="text-align:left">方法</th>')
    expect(markup).toContain('<td style="text-align:right">多个项目并行</td>')
    expect(markup).not.toContain('aria-live')
  })

  it('preserves real Markdown structure and exact selectable code text', () => {
    const markup = render('# 整理桌面\n\n## 先做一件事\n\n1. 收起不用的物品\n2. 留下正在使用的工具\n\n> 从小处开始。\n\n```js\n  const label = "<原文>";\n\n```')
    for (const tag of ['<h1>', '<h2>', '<ol>', '<blockquote>', '<pre>', '复制代码']) expect(markup).toContain(tag)
    expect(markup).toContain('  const label = &quot;&lt;原文&gt;&quot;;\n\n')
  })

  it('retains safe links while refusing raw HTML and automatic model image requests', () => {
    const markup = render('[说明](https://example.com/read)\n\n[危险链接](javascript:alert%281%29)\n\n![描述](https://example.com/tracker.png)\n\n<script>window.bad = true</script>')
    expect(markup).toContain('href="https://example.com/read" target="_blank" rel="noopener noreferrer"')
    expect(markup).toContain('<span>危险链接</span>')
    expect(markup).toContain('图片：描述')
    expect(markup).not.toContain('javascript:')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('tracker.png')
    expect(markup).not.toContain('<script')
  })
})
