import { useEffect, useRef, type ReactNode } from 'react'

// Modal dialog based on the native <dialog> element (focus handling and Escape built in).
export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dialog-title">
      <h2 id="dialog-title">{title}</h2>
      <div className="dialog__body">{children}</div>
      {actions ? <div className="dialog__actions">{actions}</div> : <form method="dialog" className="dialog__actions">
        <button type="submit" autoFocus>
          Close
        </button>
      </form>}
    </dialog>
  )
}
