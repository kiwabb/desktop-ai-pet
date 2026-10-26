import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  children: ReactNode
  labelledBy: string
  onRequestClose: () => void
  restoreFocusTo: HTMLElement | null
}

/** Native modal semantics keep focus inside and restore the initiating control. */
export function Modal({ children, labelledBy, onRequestClose, restoreFocusTo }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    return () => {
      dialog.close()
      if (restoreFocusTo?.isConnected) restoreFocusTo.focus({ preventScroll: true })
    }
  }, [restoreFocusTo])

  return <dialog ref={ref} className="modal" aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); onRequestClose() }}>
    {children}
  </dialog>
}
