import type { ReactNode } from 'react'
import type { PetLiveStatus as LiveStatus } from '../lib/pet-live-status'
import './PetLiveStatus.css'

interface PetLiveStatusProps {
  status: LiveStatus
  children: ReactNode
}

export function PetLiveStatus({ status, children }: PetLiveStatusProps) {
  return (
    <>
      {children}
      {/* Opaque interior paint hides the baked glyphs without cutting a hole
          whose separately rasterized edge could expose the desktop. */}
      <div className={`pet-live-status is-${status.tone}`} role="status" aria-live="polite" aria-atomic="true" aria-label={status.accessibleLabel} title={status.accessibleLabel}>
        <span className="pet-live-status-dot" aria-hidden="true" />
        <span className="pet-live-status-copy" aria-hidden="true">
          <strong>{status.title}</strong>
          <small>{status.detail}</small>
        </span>
      </div>
    </>
  )
}
