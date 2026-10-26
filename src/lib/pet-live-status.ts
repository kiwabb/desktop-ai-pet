import type { AgentView } from './agent'
import type { PetState } from './pet-state'

export interface PetLiveStatus {
  title: string
  detail: string
  tone: 'neutral' | 'pending' | 'ready' | 'error'
  accessibleLabel: string
}

type ConnectionState = Pick<AgentView, 'mode' | 'configured' | 'connection' | 'model_configured' | 'node_connected' | 'node_error' | 'error'>

export function getPetLiveStatus(view: ConnectionState | null, petState: PetState): PetLiveStatus {
  const status = (detail: string, tone: PetLiveStatus['tone'], accessibleLabel: string, title = '陪着你'): PetLiveStatus => ({ title, detail, tone, accessibleLabel })
  if (!view)
    return status('正在读取状态', 'neutral', '正在读取助手连接状态')
  if (!view.configured || view.connection === 'unconfigured')
    return status('助手待配置', 'neutral', '助手服务未配置')
  if (view.connection === 'connecting')
    return status('正在连接', 'pending', '正在连接助手服务')
  if (view.connection !== 'connected')
    return view.mode === 'local'
      ? status('本地运行不可用', 'error', '单机模式本地存储不可用，请打开设置重新保存配置')
      : status('连接已断开', 'error', '助手连接已断开，等待重新连接')
  if (!view.model_configured)
    return status('模型待配置', 'pending', '助手已连接，模型未配置')
  if (view.error)
    return status('助手需要检查', 'error', '助手已连接，但服务报告错误，请打开对话查看')
  if (!view.node_connected)
    return view.node_error
      ? status('聊天可用 · 设备离线', 'pending', '聊天已连接，设备暂时离线')
      : status('聊天可用 · 登记中', 'pending', '聊天已连接，设备正在登记')
  if (petState === 'thinking')
    return status('正在整理思路', 'ready', '助手与设备已连接，正在思考', '思考中')
  if (petState === 'talking')
    return status('正在回复你', 'ready', '助手与设备已连接，正在回复', '回复中')
  if (petState === 'error')
    return status('打开对话查看', 'error', '最近的任务未完成，请打开对话查看详情', '需要帮助')
  if (petState === 'curious')
    return status('你说，我在听', 'ready', '助手已就绪，正在听你说', '在听')
  if (petState === 'happy')
    return status('继续陪着你', 'ready', '助手已就绪，继续陪着你', '很开心')
  if (petState === 'sleeping')
    return status('点我就醒来', 'ready', '助手正在休息，点击即可唤醒', '休息中')
  return status('在线待命', 'ready', '助手与设备已连接，模型已配置')
}
