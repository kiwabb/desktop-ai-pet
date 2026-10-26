type PetAction = {
  label: string
  path: string
  durationMs: number
  priority: number
  resumable: boolean
}

type PetActivity = {
  status: 'idle' | 'running' | 'cancelling' | 'waiting' | 'completed' | 'cancelled' | 'failed'
  sessionId: string | null
  runId: string | null
  updatedAt: number
}

const actions: Record<string, PetAction> = {
  eating: {
    label: '吃饭',
    path: './assets/pets/white-cat-actions/eating-ai-v2-smooth/action.webp',
    durationMs: 7350,
    priority: 10,
    resumable: true,
  },
  playWand: {
    label: '玩逗猫棒',
    path: './assets/pets/white-cat-actions/play-wand/action.webp',
    durationMs: 4500,
    priority: 20,
    resumable: false,
  },
  bellyUp: {
    label: '翻肚皮',
    path: './assets/pets/white-cat-actions/belly-up/action.webp',
    durationMs: 4500,
    priority: 20,
    resumable: false,
  },
}

const root = document.querySelector<HTMLElement>('#pet-root')
if (!root) throw new Error('Missing #pet-root')

const app = document.createElement('main')
app.className = 'pet-app'
app.innerHTML = `
  <section class="pet-stage" aria-label="白猫动作舞台">
    <div class="pet-meta"><strong>白猫</strong><span data-status>正在休息</span></div>
    <div class="pet-shadow" aria-hidden="true"></div>
    <img class="pet-frame idle" src="./assets/pets/white-cat-v2/idle.png" alt="" draggable="false">
    <img class="pet-frame blink" src="./assets/pets/white-cat-v2/blink.png" alt="" draggable="false">
    <img class="pet-action" alt="" draggable="false">
  </section>
  <section class="pet-controls" aria-label="桌宠控制">
    <div class="pet-status" data-message aria-live="polite">可以拖动窗口，也可以让白猫做个动作。</div>
    <div class="action-row">
      <button class="pet-button grow" type="button" data-action="eating">吃饭</button>
      <button class="pet-button grow" type="button" data-action="playWand">玩逗猫棒</button>
      <button class="pet-button grow" type="button" data-action="bellyUp">翻肚皮</button>
    </div>
    <div class="window-row">
      <button class="pet-button primary grow" type="button" data-open-main>打开主窗口</button>
      <button class="pet-button" type="button" data-hide>隐藏</button>
    </div>
  </section>
`
root.replaceChildren(app)

const stage = app.querySelector<HTMLElement>('.pet-stage')
const actionImage = app.querySelector<HTMLImageElement>('.pet-action')
const statusLabel = app.querySelector<HTMLElement>('[data-status]')
const message = app.querySelector<HTMLElement>('[data-message]')
if (!stage || !actionImage || !statusLabel || !message) throw new Error('Incomplete pet UI')

const petStage = stage
const petActionImage = actionImage
const petStatusLabel = statusLabel
const petMessage = message

let actionTimer: number | null = null
let blinkTimer: number | null = null
let blinkEndTimer: number | null = null
let activeActionLabel: string | null = null
let activeAction: { action: PetAction; startedAt: number; durationMs: number } | null = null
let pausedActions: Array<{ action: PetAction; remainingMs: number }> = []
let activity: PetActivity = { status: 'idle', sessionId: null, runId: null, updatedAt: 0 }
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const activityLabels: Record<PetActivity['status'], string> = {
  idle: '正在休息',
  running: '正在工作',
  cancelling: '正在停止',
  waiting: '等待你的输入',
  completed: '刚刚完成',
  cancelled: '已停止',
  failed: '执行失败',
}

function renderActivity(): void {
  if (activeActionLabel) return
  petStatusLabel.textContent = activityLabels[activity.status]
  if (activity.status === 'idle') {
    petMessage.textContent = '可以拖动窗口，也可以让白猫做个动作。'
  } else if (activity.status === 'running' || activity.status === 'cancelling') {
    petMessage.textContent = '正在处理任务，桌宠不会代替主窗口显示内容。'
  } else if (activity.status === 'waiting') {
    petMessage.textContent = '主窗口有一项任务需要你的输入。'
  } else if (activity.status === 'completed') {
    petMessage.textContent = '任务已完成，可以打开主窗口查看结果。'
  } else if (activity.status === 'cancelled') {
    petMessage.textContent = '任务已停止。'
  } else {
    petMessage.textContent = '任务执行失败，请打开主窗口查看原因。'
  }
}

function clearTimer(timer: number | null): null {
  if (timer !== null) window.clearTimeout(timer)
  return null
}

function scheduleBlink(): void {
  blinkTimer = clearTimer(blinkTimer)
  blinkTimer = window.setTimeout(() => {
    if (!petStage.classList.contains('is-action')) {
      petStage.classList.add('is-blinking')
      blinkEndTimer = clearTimer(blinkEndTimer)
      blinkEndTimer = window.setTimeout(() => {
        petStage.classList.remove('is-blinking')
        scheduleBlink()
      }, 130)
    } else {
      scheduleBlink()
    }
  }, 2200 + Math.random() * 3600)
}

function clearActionVisuals(): void {
  actionTimer = clearTimer(actionTimer)
  activeAction = null
  activeActionLabel = null
  petStage.classList.remove('is-action')
  petActionImage.removeAttribute('src')
  renderActivity()
}

function finishAction(): void {
  actionTimer = clearTimer(actionTimer)
  activeAction = null
  activeActionLabel = null
  petStage.classList.remove('is-action')
  petActionImage.removeAttribute('src')

  const resume = pausedActions.pop()
  if (resume) {
    startAction(resume.action, resume.remainingMs)
    return
  }

  renderActivity()
  petMessage.textContent = '动作完成，可以继续选择一个动作。'
  scheduleBlink()
}

function startAction(action: PetAction, durationMs = action.durationMs): void {
  actionTimer = clearTimer(actionTimer)
  activeAction = { action, startedAt: performance.now(), durationMs }
  activeActionLabel = action.label
  petActionImage.src = action.path
  petStage.classList.add('is-action')
  petStatusLabel.textContent = action.label
  petMessage.textContent = `${action.label}动作播放中，结束后会回到待机。`
  actionTimer = window.setTimeout(finishAction, durationMs)
}

function requestAction(action: PetAction): void {
  if (reduceMotion) {
    clearActionVisuals()
    petStatusLabel.textContent = action.label
    petMessage.textContent = `已选择${action.label}；系统已关闭连续动画。`
    return
  }

  if (activeAction) {
    if (action.priority < activeAction.action.priority) {
      petMessage.textContent = `${activeAction.action.label}正在播放，暂不打断。`
      return
    }
    if (action.priority > activeAction.action.priority && activeAction.action.resumable) {
      const elapsedMs = performance.now() - activeAction.startedAt
      pausedActions.push({
        action: activeAction.action,
        remainingMs: Math.max(240, activeAction.durationMs - elapsedMs),
      })
    } else {
      pausedActions = []
    }
  }

  startAction(action)
}

for (const button of Array.from(app.querySelectorAll<HTMLButtonElement>('[data-action]'))) {
  button.addEventListener('click', () => {
    const action = actions[button.dataset.action ?? '']
    if (action) {
      petStage.classList.remove('is-blinking')
      requestAction(action)
    }
  })
}

app.querySelector<HTMLButtonElement>('[data-open-main]')?.addEventListener('click', () => {
  void window.pet?.openMain()
})

app.querySelector<HTMLButtonElement>('[data-hide]')?.addEventListener('click', () => {
  void window.pet?.hide()
})

window.pet?.onVisibilityChange(({ visible }) => {
  app.dataset.visible = String(visible)
})

const petBridge = window.pet
if (petBridge) {
  void petBridge.getActivity().then((next) => {
    activity = next
    renderActivity()
  })
  petBridge.onActivityChange((next) => {
    activity = next
    renderActivity()
  })
}

window.addEventListener('beforeunload', () => {
  actionTimer = clearTimer(actionTimer)
  blinkTimer = clearTimer(blinkTimer)
  blinkEndTimer = clearTimer(blinkEndTimer)
})

scheduleBlink()
