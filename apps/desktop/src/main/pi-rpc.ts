import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'

import {
  isPiAgentSettled,
  isPiRpcResponse,
  parsePromptDisposition,
  type PiPromptData,
  type PiRpcCommand,
  type PiRpcRecord,
  type PiRpcResponse,
  type PiStateData,
} from '../shared/pi-rpc'
import { StrictJsonlDecoder } from '../runtime/jsonl'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export class PiRpcCommandError extends Error {
  readonly response: PiRpcResponse

  constructor(response: PiRpcResponse) {
    super(response.error || `Pi RPC command failed: ${response.command}`)
    this.name = 'PiRpcCommandError'
    this.response = response
  }
}

interface PiChildProcess {
  stdin: ChildProcessWithoutNullStreams['stdin']
  stdout: ChildProcessWithoutNullStreams['stdout']
  stderr: ChildProcessWithoutNullStreams['stderr']
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: string, listener: (...args: any[]) => void): this
  once(event: string, listener: (...args: any[]) => void): this
  pid?: number
  exitCode: number | null
}

type SpawnPi = (command: string, args: string[], options: SpawnOptions) => PiChildProcess

export interface PiRpcClientOptions {
  command?: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  requestTimeoutMs?: number
  spawnPi?: SpawnPi
}

interface PendingResponse<TData> {
  resolve: (response: PiRpcResponse<TData>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface PiRpcClientEvents {
  record: (record: PiRpcRecord) => void
  stderr: (text: string) => void
  exit: (code: number | null, signal: NodeJS.Signals | null) => void
}

export class PiRpcClient {
  private readonly command: string
  private readonly args: string[]
  private readonly cwd?: string
  private readonly env?: NodeJS.ProcessEnv
  private readonly requestTimeoutMs: number
  private readonly spawnPi: SpawnPi
  private decoder = new StrictJsonlDecoder()
  private readonly pending = new Map<string, PendingResponse<unknown>>()
  private readonly events = new EventEmitter()
  private process: PiChildProcess | null = null
  private sequence = 0
  private settledWaiters = new Set<{
    resolve: (record: PiRpcRecord) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  private bufferedSettlements: PiRpcRecord[] = []

  constructor(options: PiRpcClientOptions = {}) {
    this.command = options.command ?? 'pi'
    this.args = options.args ?? ['--mode', 'rpc']
    this.cwd = options.cwd
    this.env = options.env
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.spawnPi =
      options.spawnPi ??
      ((command, args, spawnOptions) =>
        spawn(command, args, { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams)
  }

  get running(): boolean {
    return this.process !== null && this.process.exitCode === null
  }

  on<K extends keyof PiRpcClientEvents>(event: K, listener: PiRpcClientEvents[K]): () => void {
    this.events.on(event, listener)
    return () => this.events.off(event, listener)
  }

  start(): void {
    if (this.running) return

    const child = this.spawnPi(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.process = child
    this.decoder = new StrictJsonlDecoder()

    child.stdout.on('data', (chunk: Buffer | string) => {
      try {
        for (const record of this.decoder.feed(chunk)) this.handleRecord(normalizePiRpcRecord(record))
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
        child.kill()
      }
    })
    child.stdout.on('end', () => {
      try {
        for (const record of this.decoder.finish()) this.handleRecord(normalizePiRpcRecord(record))
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      this.events.emit('stderr', typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    })
    child.on('error', (error: Error) => this.fail(error))
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => this.handleExit(code, signal))
  }

  async send<TData = unknown>(command: PiRpcCommand): Promise<PiRpcResponse<TData>> {
    this.start()
    const process = this.process
    if (!process || !this.running) throw new Error('Pi RPC process is not running')

    const id = command.id ?? `desktop-ai-pet-${++this.sequence}`
    const request: PiRpcCommand = { ...command, id }
    const response = new Promise<PiRpcResponse<TData>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Pi RPC request timed out: ${request.type}`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve: resolve as (response: PiRpcResponse<unknown>) => void, reject, timer })
    })

    try {
      await this.write(request)
    } catch (error) {
      const pending = this.pending.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    return response
  }

  async prompt(message: string, streamingBehavior?: 'steer' | 'followUp'): Promise<PiRpcResponse<PiPromptData>> {
    const response = await this.send<PiPromptData>({
      type: 'prompt',
      message,
      ...(streamingBehavior ? { streamingBehavior } : {}),
    })
    parsePromptDisposition(response)
    return response
  }

  getState(): Promise<PiRpcResponse<PiStateData>> {
    return this.send({ type: 'get_state' })
  }

  abort(): Promise<PiRpcResponse> {
    return this.send({ type: 'abort' })
  }

  waitForAgentSettled(timeoutMs = this.requestTimeoutMs): Promise<PiRpcRecord> {
    const bufferedSettlement = this.bufferedSettlements.shift()
    if (bufferedSettlement) return Promise.resolve(bufferedSettlement)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settledWaiters.delete(waiter)
        reject(new Error('Timed out waiting for Pi agent_settled'))
      }, timeoutMs)
      const waiter = { resolve, reject, timer }
      this.settledWaiters.add(waiter)
    })
  }

  async close(graceMs = 2_000): Promise<void> {
    const process = this.process
    if (!process) return
    process.stdin.end()
    if (process.exitCode !== null) return

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        process.kill()
        resolve()
      }, graceMs)
      process.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private async write(command: PiRpcCommand): Promise<void> {
    const process = this.process
    if (!process) throw new Error('Pi RPC process is not running')
    const line = `${JSON.stringify(command)}\n`

    await new Promise<void>((resolve, reject) => {
      const accepted = process.stdin.write(line, 'utf8', (error?: Error | null) => {
        if (error) reject(error)
      })
      if (accepted) resolve()
      else process.stdin.once('drain', resolve)
    })
  }

  private handleRecord(record: PiRpcRecord): void {
    this.events.emit('record', record)
    if (record.type === 'agent_settled') {
      if (this.settledWaiters.size === 0) {
        this.bufferedSettlements.push(record)
      } else {
        for (const waiter of this.settledWaiters) {
          clearTimeout(waiter.timer)
          waiter.resolve(record)
        }
        this.settledWaiters.clear()
      }
    }

    if (!isPiRpcResponse(record) || !record.id) return
    const pending = this.pending.get(record.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(record.id)
    if (record.success) pending.resolve(record)
    else pending.reject(new PiRpcCommandError(record))
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiter of this.settledWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.settledWaiters.clear()
    this.bufferedSettlements = []
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.process = null
    const error = new Error(`Pi RPC process exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
    this.fail(error)
    this.events.emit('exit', code, signal)
  }
}

function normalizePiRpcRecord(value: Record<string, unknown>): PiRpcRecord {
  if (typeof value.type !== 'string' || value.type.length === 0) {
    throw new Error('Pi RPC records must have a non-empty string type')
  }
  if (value.type === 'response' && !isPiRpcResponse(value)) {
    throw new Error('Pi RPC response has an invalid shape')
  }
  if (value.type === 'agent_settled' && !isPiAgentSettled(value)) {
    throw new Error('Pi agent_settled event has an invalid shape')
  }
  return value as PiRpcRecord
}
