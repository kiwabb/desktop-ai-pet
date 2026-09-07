export type PetState =
  | 'idle'
  | 'curious'
  | 'thinking'
  | 'talking'
  | 'happy'
  | 'sleeping'
  | 'error'

export const petStateLabel: Record<PetState, string> = {
  idle: '陪着你',
  curious: '在听',
  thinking: '思考中',
  talking: '回复中',
  happy: '很开心',
  sleeping: '休息中',
  error: '需要帮助',
}
