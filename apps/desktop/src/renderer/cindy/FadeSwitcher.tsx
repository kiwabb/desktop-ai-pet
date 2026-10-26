/**
 * FadeSwitcher
 * ---------------------------------------------------------------------------
 * F4 主区域切换动画容器。
 *
 * 实现要点：
 * - 父组件（MainLayout）通过 <FadeSwitcher key={location.pathname}> 控制实例身份。
 *   key 变化 → React 在父组件 commit 时销毁旧实例 + 挂载新实例 → 本组件 mount effect
 *   从 opacity 0 → 1 触发 220ms transition。
 *   key 必须挂在父组件渲染处，挂在自身根 div 不会触发实例销毁重挂（React 仍视为同一实例）。
 * - 动画进行中再次切路由 → React 直接卸载未完成的子树（不会“等动画结束”），
 *   实现“立即打断 = 重挂”语义，无需手动状态机。
 * - prefers-reduced-motion: reduce → 关闭 transition，瞬间替换。
 * - 动画结束 transitionend 事件清除 will-change，避免合成层堆积。
 *
 * 性能边界（F4）：仅 opacity 变化，禁止 width/height/top/left/margin/padding 动画。
 *
 * Source: makecindy/cindy, commit ae50e8e1afd9b95e51801085d1a2ed9dfe8b16af.
 * This file is kept as a source-import slice; it is not the full Cindy renderer.
 */

import { useEffect, useMemo, useState, type ReactNode, type TransitionEvent } from 'react'

interface FadeSwitcherProps {
  children: ReactNode
}

export function FadeSwitcher({ children }: FadeSwitcherProps) {
  const [opacity, setOpacity] = useState(0)
  const [willChange, setWillChange] = useState<'opacity' | 'auto'>('opacity')

  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  useEffect(() => {
    if (reduceMotion) {
      setOpacity(1)
      setWillChange('auto')
      return
    }
    setOpacity(0)
    setWillChange('opacity')
    const id = requestAnimationFrame(() => {
      setOpacity(1)
    })
    return () => cancelAnimationFrame(id)
  }, [reduceMotion])

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName === 'opacity') setWillChange('auto')
  }

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      className="flex flex-1 flex-col overflow-hidden"
      style={{
        opacity,
        willChange,
        transition: reduceMotion ? 'none' : 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {children}
    </div>
  )
}
