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
//
// A RECURRING TOAST REPLACES ITSELF (owner dogfeed 2026-08-15): "when i
// repeatedly press l the toast just kind of stack on the right, if it is a
// recurring toast for example by pressing same hotkey multiple times, you can
// just immediately replace it and don't need to flood the screen". A caller
// that can fire the same announcement over and over passes a replace key; the
// live toast carrying that key is swapped in place — same slot, new message,
// fresh window. Callers that pass no key keep stacking, which is right for
// results (three accepts are three facts, not one restated).

import { useRef, useState } from 'react'

/** How long a non-error toast stays on screen, in milliseconds. */
export const TOAST_TIMEOUT_MS = 4000

/**
 * The longer window for a summary of several outcomes, in milliseconds.
 *
 * Owner finding 2026-10-04 ("import report disappears automatically, a bit
 * too fast"): a toast that counts what happened to several items takes longer
 * to read than a one-fact toast. Still not sticky: it reports, it does not ask.
 */
export const TOAST_LONG_TIMEOUT_MS = 10000

/** Per-call options of {@link UseToastsResult.toast}. */
export interface ToastOptions {
  /**
   * How long a non-error toast stays, in milliseconds (default
   * ``TOAST_TIMEOUT_MS``). Ignored for an error, which always waits.
   */
  durationMs?: number
}

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
  /**
   * Identifies a RECURRING announcement, so the next one of its kind takes
   * this toast's place instead of stacking beside it.
   *
   * Absent on the ordinary result toast: two accepts are two facts and both
   * deserve saying. Present on the announcements a key can repeat — a display
   * toggle, for one — where the second press restates the first.
   */
  replaceKey?: string
}

export interface UseToastsResult {
  /** Current live toasts — render these as the stack. */
  toasts: Toast[]
  /**
   * Show a toast; auto-dismisses after 4 s unless it is an error.
   *
   * With a ``replaceKey``, a live toast already carrying that key is REPLACED
   * where it stands — same position in the stack, new message and type, fresh
   * 4 s window — so hammering a hotkey shows one toast that updates rather
   * than a column of identical ones. Without one, the toast is appended.
   */
  toast: (
    type: 'success' | 'error' | 'warning',
    message: string,
    replaceKey?: string,
    options?: ToastOptions,
  ) => void
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
    // Returning the SAME array when the id is already gone keeps a replaced
    // toast's orphaned timer from re-rendering the stack when it fires.
    setToasts(prev => (prev.some(t => t.id === id) ? prev.filter(t => t.id !== id) : prev))
  }

  function toast(
    type: 'success' | 'error' | 'warning',
    message: string,
    replaceKey?: string,
    options?: ToastOptions,
  ): void {
    const id = ++toastId.current
    const sticky = type === 'error'
    const next: Toast = { id, type, message, sticky, replaceKey }
    setToasts(prev => {
      const at = replaceKey === undefined ? -1 : prev.findIndex(t => t.replaceKey === replaceKey)
      if (at === -1) return [...prev, next]
      // In place, not re-appended: the toast the engineer is already reading
      // must not jump to the bottom of the stack under his eyes.
      const kept = prev.slice()
      kept[at] = next
      return kept
    })
    // The replaced toast's own timer is left to expire harmlessly — it names an
    // id that is no longer in the stack, so it removes nothing. This entry gets
    // a full window of its own, which is what "restart the timer" means; and a
    // report replaced by an ERROR schedules nothing at all, so the sticky rule
    // survives the swap in both directions.
    if (!sticky) setTimeout(() => dismissToast(id), options?.durationMs ?? TOAST_TIMEOUT_MS)
  }

  return { toasts, toast, dismissToast }
}
