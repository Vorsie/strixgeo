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
import { createPortal } from 'react-dom'

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

  // Early-return BEFORE the portal so a closed modal renders nothing
  // anywhere (keeps the closed-state `container.querySelector` test
  // assertions valid and avoids an empty body node).
  if (!open) return null

  // Portal to document.body. Without this the overlay is a descendant of
  // whatever stage canvas opened it; the map/section canvas sits in its
  // own stacking + containing-block context (a positioned/`transform`ed
  // ancestor), so `fixed inset-0` was clipped to the canvas region — the
  // backdrop dimmed only the map while the left rail / top bar / basemap
  // panel stayed fully lit, so a "modal" read as a floating card over a
  // live UI (reported on the DOV-import progress box). As a direct child
  // of <body> the scrim covers the entire window above all chrome and the
  // UI is genuinely cleared.
  return createPortal(
    // Max z-index — NOT z-[1100]. `#root` is position:static / z-index:
    // auto, so it does NOT form a stacking context: every z-index in the
    // app lives in ONE flat root stacking context, shared with this
    // body-portaled overlay. z-[1100] therefore competes directly with
    // app-wide values, and some exceed it (e.g. BoreholeLog's z-[1200]),
    // so Inspector-subtree content painted OVER the scrim — the reported
    // "map dimmed, right panel crisp". 2147483647 (int32 max) sits above
    // anything any component can reasonably set, in the flat context.
    //
    // Scrim strength: bg-black/30 was invisible over the dark basemap +
    // dark theme; bg-black/70 + backdrop-blur-sm is the unambiguous
    // "UI is blocked" signal on any theme.
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        // Semantic surface tokens (var-driven, .dark-aware) — NOT
        // bg-white/dark:. Tailwind ``dark:`` keys off OS
        // prefers-color-scheme, but the app theme is a ``.dark`` class
        // flipping CSS vars, so ``dark:`` is dead on a light-OS host and
        // every dialog rendered white. ``surface-overlay`` is the modal
        // surface in both themes.
        className={`bg-surface-overlay border border-border-default text-text-primary rounded-lg shadow-lg ${cardClassName}`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
