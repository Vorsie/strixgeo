// Toast notification state.
//
// Extremely thin — a ref-tracked incrementing id, a state array, the ``toast``
// action that appends, and ``dismissToast`` for the manual close. Extracted
// from App.tsx so ``toast`` can be imported by the other hooks (which receive
// it as a dep-injection parameter) without pulling in all of App's machinery.
//
// ERRORS DO NOT AUTO-DISMISS (audit 2026-08-02). Every toast used to vanish
// after 4 s regardless of severity, so an action-required message — "3
// accepted packing ties could not be kept and have to be redrawn" — was gone
// before an engineer looking at the section noticed it, with no in-app history
// to recover it from. Successes and warnings still expire: they report, they
// do not ask. An error asks, so it waits to be dismissed.

import { useRef, useState } from 'react'

/** How long a non-error toast stays on screen, in milliseconds. */
export const TOAST_TIMEOUT_MS = 4000

/** A single in-flight notification. */
export interface Toast {
  id: number
  type: 'success' | 'error' | 'warning'
  message: string
  /**
   * True when the toast waits for a click instead of expiring.
   *
   * Derived from the type (errors are sticky), not chosen per call site — a
   * per-call flag would let the next caller re-introduce a self-dismissing
   * error, which is the bug this closes.
   */
  sticky: boolean
}

export interface UseToastsResult {
  /** Current live toasts — render these as the stack. */
  toasts: Toast[]
  /** Append a toast; auto-dismisses after 4 s unless it is an error. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  /** Remove one toast by id — what the close button on a sticky toast calls. */
  dismissToast: (id: number) => void
}

/**
 * React hook that manages the in-app toast notification stack.
 *
 * Each call to ``toast`` generates a unique id and pushes the notification
 * onto the list. Success and warning toasts schedule their own removal after
 * ``TOAST_TIMEOUT_MS``; error toasts stay until ``dismissToast`` is called.
 * The hook holds no external dependencies — it is safe to call early in the
 * App body (before any project or API state is available).
 *
 * Returns
 * -------
 * toasts
 *     The live notification array.
 * toast
 *     Action: append a notification.  Stable across renders (does not
 *     belong in dep arrays of other hooks).
 * dismissToast
 *     Action: remove a notification by id.  Stable for the same reason.
 */
export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<Toast[]>([])
  // Incrementing counter — a ref so mutation never triggers a re-render.
  const toastId = useRef(0)

  // Declared as plain functions (not useCallback) intentionally — they read
  // from the ref, not from any React state, so they never go stale. Keeping
  // them out of useCallback prevents them from appearing in dep arrays of
  // other hooks (which would cause false re-subscription cycles).
  function dismissToast(id: number): void {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  function toast(type: 'success' | 'error' | 'warning', message: string): void {
    const id = ++toastId.current
    const sticky = type === 'error'
    setToasts(prev => [...prev, { id, type, message, sticky }])
    if (!sticky) setTimeout(() => dismissToast(id), TOAST_TIMEOUT_MS)
  }

  return { toasts, toast, dismissToast }
}
