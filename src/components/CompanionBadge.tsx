import { useState } from 'react'
import { useCustomization } from '../lib/useCustomization'
import { ReferencePawBadge } from './ReferenceIllustrations'

export function BadgeMark({ src, className }: { src?: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  return src && failed !== src
    ? <img className={className} src={src} alt="" aria-hidden="true" draggable={false} onError={() => setFailed(src)} />
    : <ReferencePawBadge className={className} />
}
export function CompanionBadge() {
  const { active } = useCustomization()
  return <BadgeMark src={active?.badge} className="companion-brand-mark" />
}
