import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isNearChatBottom, safeMessageUrl, shouldSubmitComposer } from '../src/lib/chat-interaction.ts'

const enter = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, compositionActive: false, timeStamp: 1000, compositionEndedAt: -Infinity }
assert.equal(shouldSubmitComposer(enter), true)
for (const change of [{ shiftKey: true }, { isComposing: true }, { compositionActive: true }, { keyCode: 229 }, { key: 'Escape' }, { compositionEndedAt: 990 }])
  assert.equal(shouldSubmitComposer({ ...enter, ...change }), false)
assert.equal(shouldSubmitComposer({ ...enter, compositionEndedAt: 900 }), true)
assert.equal(isNearChatBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 540 }), true)
assert.equal(isNearChatBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 300 }), false)
assert.equal(isNearChatBottom({ scrollHeight: 400, clientHeight: 400, scrollTop: -10 }), true)
assert.equal(isNearChatBottom({ scrollHeight: 1500, clientHeight: 400, scrollTop: 300 }), false, 'stream growth must not re-enable history following')
for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd', '//example.com', '/internal', 'https://user:secret@example.com', 'java\nscript:alert(1)', 'https://example.com\u0000', 'https://'])
  assert.equal(safeMessageUrl(url), undefined, url)
assert.equal(safeMessageUrl('https://例子.中国/说明?q=橘伴'), new URL('https://例子.中国/说明?q=橘伴').href)
assert.equal(safeMessageUrl('https://example.com/a?q=hello%20world'), 'https://example.com/a?q=hello%20world')
assert.equal(safeMessageUrl('mailto:hello@example.com'), 'mailto:hello@example.com')

// Exercise the actual local submission handlers without mounting a product
// preview or invoking native/service APIs. Extract their AST nodes rather than
// maintaining a second implementation of the acknowledgement race logic.
const panelSource = ts.createSourceFile('ChatPanel.tsx', readFileSync(new URL('../src/components/ChatPanel.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function localHandler(name, bindings) {
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(panelSource)
  assert.ok(declaration, `Missing actual handler: ${name}`)
  const source = ts.transpileModule(declaration.getText(panelSource), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(bindings), `${source}; return ${name}`)(...Object.values(bindings))
}
const submittedDraftRef = { current: null }
const sendingRef = { current: false }
const originalDraft = '  单元检查草稿\n'
let draft = originalDraft
const acknowledgeSubmission = localHandler('acknowledgeSubmission', { submittedDraftRef, setDraft: update => { draft = update(draft) } })
let resolveAccepted
const accepted = new Promise(resolve => { resolveAccepted = resolve })
let sendCount = 0
let expandedCount = 0
const submit = localHandler('submit', {
  draft: originalDraft, streaming: false, sendingRef, compositionRef: { current: false }, configured: true,
  status: { connection: 'connected', model_configured: true }, submittedDraftRef, acknowledgeSubmission,
  onSend: content => { sendCount++; assert.equal(content, originalDraft.trim()); return { requestId: 'unit-request', accepted } },
  expanded: false, onExpandedChange: value => { assert.equal(value, true); expandedCount++ },
  openSettings: () => { throw new Error('Unexpected settings navigation') },
})
const firstSend = submit({ preventDefault() {} })
await submit({ preventDefault() {} })
assert.equal(sendCount, 1, 'Immediate repeat submit is fenced before a React state commit')
const submitted = submittedDraftRef.current
acknowledgeSubmission(submitted)
assert.equal(draft, '', 'Acceptance clears the matching raw draft including outer whitespace')
draft = originalDraft
resolveAccepted()
await firstSend
assert.equal(draft, originalDraft, 'Late promise acceptance cannot clear a newly entered identical draft')
assert.equal(sendingRef.current, false)
assert.equal(expandedCount, 1)
const newer = { content: '新草稿', requestId: 'unit-new-request' }
submittedDraftRef.current = newer
draft = newer.content
acknowledgeSubmission(submitted)
assert.equal(submittedDraftRef.current, newer, 'Old confirmation must not consume a newer request marker')
assert.equal(draft, newer.content)
draft = '已继续编辑'
acknowledgeSubmission(newer)
assert.equal(draft, '已继续编辑', 'Acceptance preserves a changed draft')

// One-off TSX/CSS loader for rendering the real component in this static
// regression. Test strings never enter application state or a preview service.
const sourceRoot = new URL('../src/', import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier, context.parentURL)
      for (const extension of ['.ts', '.tsx'])
        if (existsSync(fileURLToPath(url) + extension)) return nextResolve(url.href + extension, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.css')) return { format: 'module', source: 'export {}', shortCircuit: true }
    if (url.startsWith(sourceRoot) && url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    }
    return nextLoad(url, context)
  },
})
try {
  const { MessageContent } = await import('../src/components/MessageContent.tsx')
  const render = content => renderToStaticMarkup(createElement(MessageContent, { content }))
  const unsafe = render('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![说明](https://example.com/track.png)')
  assert.ok(!/<script|<img|javascript:|track\.png/.test(unsafe))
  assert.ok(unsafe.includes('图片：说明'))
  const markdown = render('# 标题\n\n**重点**\n\n- 第一项\n- 第二项\n\n[说明](https://例子.中国/文档)\n\n```js\n  const x = "<tag>";\n\n```\n\n| 列 | 值 |\n|---|---|\n| A | B |')
  for (const tag of ['<h1>', '<strong>', '<ul>', '<table>', '<pre>', '复制代码', 'rel="noopener noreferrer"']) assert.ok(markdown.includes(tag), tag)
  assert.ok(markdown.includes('  const x = &quot;&lt;tag&gt;&quot;;\n\n'), 'code indentation and trailing newline remain selectable/copyable')
  assert.doesNotThrow(() => render('**未完成\n\n```ts\nconst value ='))
}
finally { hooks.deregister() }
console.log('chat interaction static regressions passed: IME, reading threshold, safe URLs, actual Markdown SSR; no runtime/service messages created')
