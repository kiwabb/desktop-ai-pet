import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

import {
  AGENT_CANCEL_CHANNEL,
  AGENT_EVENT_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
  parseAgentRunCancelRequest,
  parseAgentRunRequest,
  type AgentRunEvent,
} from '../shared/agent-runtime'
import { setPetActivity, type DesktopWindows } from './desktop-windows'
import { petActivityFromAgentEvent } from './pet-activity'
import { PiAgentRuntime, type PiRunTransport } from './pi-agent-runtime'
import { PiRpcClient } from './pi-rpc'

export interface AgentIpcOptions {
  /** Inject a deterministic transport in tests; production uses the Pi CLI. */
  createTransport?: () => PiRunTransport
}

/**
 * Keep the Pi process and run state in the main process. Renderer requests are
 * validated before reaching the runtime, and events are sent only to the
 * currently authorized main window.
 */
export function registerAgentIpc(windows: DesktopWindows, options: AgentIpcOptions = {}): () => void {
  let transport: PiRunTransport | null = null
  let client: PiRpcClient | null = null
  let runtime: PiAgentRuntime | null = null

  const getRuntime = (): PiAgentRuntime => {
    if (runtime) return runtime

    if (options.createTransport) {
      transport = options.createTransport()
    } else {
      client = new PiRpcClient()
      transport = client
    }
    runtime = new PiAgentRuntime(transport)
    runtime.onEvent((event) => {
      sendAgentEvent(windows, event)
      setPetActivity(windows, petActivityFromAgentEvent(event))
    })
    return runtime
  }

  const submit = (event: IpcMainInvokeEvent, value: unknown) => {
    assertSender(event, windows.main, AGENT_SUBMIT_CHANNEL)
    return getRuntime().submit(parseAgentRunRequest(value))
  }

  const cancel = (event: IpcMainInvokeEvent, value: unknown) => {
    assertSender(event, windows.main, AGENT_CANCEL_CHANNEL)
    const request = parseAgentRunCancelRequest(value)
    return getRuntime().cancel(request.sessionId, request.runId)
  }

  ipcMain.handle(AGENT_SUBMIT_CHANNEL, submit)
  ipcMain.handle(AGENT_CANCEL_CHANNEL, cancel)

  return () => {
    ipcMain.removeHandler(AGENT_SUBMIT_CHANNEL)
    ipcMain.removeHandler(AGENT_CANCEL_CHANNEL)
    runtime?.dispose()
    if (client) void client.close()
    runtime = null
    transport = null
    client = null
  }
}

function sendAgentEvent(windows: DesktopWindows, agentEvent: AgentRunEvent): void {
  const main = windows.main
  if (!main || main.isDestroyed() || main.webContents.isDestroyed()) return
  main.webContents.send(AGENT_EVENT_CHANNEL, agentEvent)
}

function assertSender(event: IpcMainInvokeEvent, expected: BrowserWindow | null, channel: string): void {
  if (
    !expected ||
    BrowserWindow.fromWebContents(event.sender) !== expected ||
    event.senderFrame !== expected.webContents.mainFrame
  ) {
    throw new Error(`Unauthorized sender for ${channel}`)
  }
}
