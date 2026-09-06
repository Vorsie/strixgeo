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

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Elements that can hold keyboard focus inside the dialog. Excludes
// disabled controls and explicit ``tabindex="-1"`` (programmatic-only)
// nodes. Used to cycle Tab/Shift+Tab within the card (WCAG 2.4.3).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  // Optional data-testid on the inner card element, for e2e harnesses.
  testid?: string
  children: React.ReactNode
}

export default function Modal({
  open,
  onCancel,
  labelledBy,
  busy = false,
  cardClassName = 'w-96',
  testid,
  children,
}: Props) {
  // Ref to the inner card so the focus trap knows the dialog boundary.
  const cardRef = useRef<HTMLDivElement>(null)

  // Esc-to-cancel + the Tab/Shift+Tab focus trap (WCAG 2.4.3): while the
  // dialog is open, Tab cycles within the card instead of escaping to the
  // obscured app behind the scrim.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (busy) return
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const focusables = Array.from(
        card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      // No focusable children — keep focus on the card itself.
      if (focusables.length === 0) {
        e.preventDefault()
        card.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !card.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !card.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onCancel])

  // Focus management: remember what was focused before the dialog opened,
  // pull focus into the card on open (only if the caller hasn't already
  // focused its own preferred element — e.g. ConfirmDialog focuses Cancel),
  // and restore focus to the trigger when the dialog closes. Depends only
  // on ``open`` so a ``busy`` toggle mid-dialog doesn't yank focus around.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const card = cardRef.current
    if (card && !card.contains(document.activeElement)) {
      const firstFocusable = card.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(firstFocusable ?? card).focus()
    }
    return () => {
      // Restore only if the trigger is still in the document and focusable.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [open])

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
    // Near-max z-index — NOT z-[1100]. `#root` is position:static / z-index:
    // auto, so it does NOT form a stacking context: every z-index in the
    // app lives in ONE flat root stacking context, shared with this
    // body-portaled overlay. z-[1100] therefore competes directly with
    // app-wide values, and some exceed it (e.g. BoreholeLog's z-[1200]),
    // so Inspector-subtree content painted OVER the scrim — the reported
    // "map dimmed, right panel crisp". 2147483646 (one below int32 max) sits
    // above anything any component can reasonably set, in the flat context.
    //
    // Why one BELOW int32 max: the guided-tutorial overlay claims the true
    // max (z-[2147483647], TutorialOverlay.tsx) so its coach card + spotlight
    // ring paint above an open dialog (owner ruling 2, 2026-09-06). The
    // tutorial is pointer-events-none, so the dialog stays fully interactive
    // beneath it.
    //
    // Scrim strength: bg-black/30 was invisible over the dark basemap +
    // dark theme; bg-black/70 + backdrop-blur-sm is the unambiguous
    // "UI is blocked" signal on any theme.
    <div
      className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        ref={cardRef}
        // tabIndex=-1 lets the card itself hold focus as a last resort (a
        // dialog with no focusable children) so Tab still can't escape.
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        // Semantic surface tokens (var-driven, .dark-aware) — NOT
        // bg-white/dark:. Tailwind ``dark:`` keys off OS
        // prefers-color-scheme, but the app theme is a ``.dark`` class
        // flipping CSS vars, so ``dark:`` is dead on a light-OS host and
        // every dialog rendered white. ``surface-overlay`` is the modal
        // surface in both themes.
        data-testid={testid}
        className={`bg-surface-overlay border border-border-default text-text-primary rounded-lg shadow-lg ${cardClassName}`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
