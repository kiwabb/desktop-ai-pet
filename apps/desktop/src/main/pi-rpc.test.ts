import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { JsonlProtocolError, StrictJsonlDecoder } from '../runtime/jsonl'
import { PiRpcClient } from './pi-rpc'

class FakePiProcess extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  readonly pid = 42

  constructor() {
    super()
    this.stdin.on('data', () => undefined)
  }

  kill(): boolean {
    this.exitCode = 0
    this.emit('exit', 0, null)
    return true
  }
}

describe('PiJsonlDecoder', () => {
  it('splits only on LF and preserves Unicode line separators inside JSON strings', () => {
    const decoder = new StrictJsonlDecoder()
    const payload = JSON.stringify({ type: 'message_update', text: 'first\u2028second' })
    const bytes = Buffer.from(`${payload}\n`, 'utf8')

    expect(decoder.feed(bytes.subarray(0, 7))).toEqual([])
    expect(decoder.feed(bytes.subarray(7))).toEqual([{ type: 'message_update', text: 'first\u2028second' }])
    expect(() => decoder.finish()).not.toThrow()
  })

  it('accepts CRLF but rejects an unterminated record', () => {
    const decoder = new StrictJsonlDecoder()
    expect(decoder.feed('{"type":"agent_settled","aborted":false}\r\n')).toEqual([{ type: 'agent_settled', aborted: false }])

    const incomplete = new StrictJsonlDecoder()
    incomplete.feed('{"type":"agent_settled","aborted":false}')
    expect(() => incomplete.finish()).toThrow(JsonlProtocolError)
  })
})

describe('PiRpcClient', () => {
  it('correlates responses by request id and separates settlement from prompt acceptance', async () => {
    const child = new FakePiProcess()
    const client = new PiRpcClient({
      requestTimeoutMs: 500,
      spawnPi: () => child,
    })
    const writes: string[] = []
    child.stdin.on('data', (chunk: Buffer) => writes.push(chunk.toString('utf8')))

    const prompt = client.prompt('hello')
    await new Promise<void>((resolve) => setImmediate(resolve))
    const request = JSON.parse(writes[0]) as { id: string; type: string; message: string }
    expect(request.type).toBe('prompt')
    expect(request.message).toBe('hello')

    child.stdout.write(
      `${JSON.stringify({
        id: request.id,
        type: 'response',
        command: 'prompt',
        success: true,
        data: { disposition: 'started' },
      })}\n`,
    )
    await expect(prompt).resolves.toMatchObject({ success: true, data: { disposition: 'started' } })

    child.stdout.write('{"type":"agent_end"}\n')
    child.stdout.write('{"type":"agent_settled","aborted":false}\n')
    await expect(client.waitForAgentSettled()).resolves.toMatchObject({ type: 'agent_settled', aborted: false })
    await client.close()
  })

  it('rejects pending commands when the child exits', async () => {
    const child = new FakePiProcess()
    const client = new PiRpcClient({
      requestTimeoutMs: 500,
      spawnPi: () => child,
    })
    const request = client.getState()
    child.emit('exit', 1, null)
    await expect(request).rejects.toThrow('Pi RPC process exited')
  })
})
