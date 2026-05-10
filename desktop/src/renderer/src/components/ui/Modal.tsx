// Shared modal shell. Three dialogs hit the same shape — backdrop +
// Esc-to-cancel + centred card + role/aria wiring — so we factor it
// here per the codebase's "extract on third copy" rule.
//
// What this component owns:
//   * Fixed-position backdrop, dimmed, centred children
//   * Esc keystroke → calls ``onCancel`` (skipped while ``busy``)
//   * Backdrop click → calls ``onCancel`` (skipped while ``busy``)
//   * ``role="dialog"`` + ``aria-modal="true"`` + ``aria-labelledby``
//   * Stops click propagation on the inner card so a click *inside* the
//     dialog doesn't bubble up to the backdrop and dismiss it
//
// What the caller still owns:
//   * Title / body / action buttons (children)
//   * Default focus on mount (callers focus their own preferred element)
//   * Submit logic + the ``busy`` flag during async actions

import { useEffect } from 'react'

interface Props {
  open: boolean
  onCancel: () => void
  // ID of the element inside ``children`` that names the dialog. Used as
  // ``aria-labelledby`` for screen readers. Caller is responsible for
  // putting an element with this id (typically the title <h2>).
  labelledBy: string
  // While ``busy``, Esc and backdrop click are no-ops so the user can't
  // dismiss a dialog mid-save.
  busy?: boolean
  // Inner card width override. Defaults to ``w-96`` (24rem) — the same
  // width the existing single-purpose dialogs used. Caller passes a
  // different Tailwind width class for wider forms (e.g. the project
  // metadata editor's six-field grid).
  cardClassName?: string
  children: React.ReactNode
}

export default function Modal({
  open,
  onCancel,
  labelledBy,
  busy = false,
  cardClassName = 'w-96',
  children,
}: Props) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || busy) return
      e.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`bg-white border border-gray-200 rounded-lg shadow-lg ${cardClassName}`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
