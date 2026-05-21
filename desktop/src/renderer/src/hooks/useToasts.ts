// Toast notification state.
//
// Extremely thin — a ref-tracked incrementing id, a state array, and
// the ``toast`` action that appends + auto-dismisses after 4 s. Extracted
// from App.tsx so ``toast`` can be imported by the other hooks (which
// receive it as a dep-injection parameter) without pulling in all of
// App's machinery.

import { useRef, useState } from 'react'

/** A single in-flight notification. */
export interface Toast {
  id: number
  type: 'success' | 'error' | 'warning'
  message: string
}

export interface UseToastsResult {
  /** Current live toasts — render these as the stack. */
  toasts: Toast[]
  /** Append a toast and schedule its auto-dismissal after 4 s. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}

/**
 * React hook that manages the in-app toast notification stack.
 *
 * Each call to ``toast`` generates a unique id, pushes the notification
 * onto the list, and schedules removal via ``setTimeout`` after 4 000 ms.
 * The hook holds no external dependencies — it is safe to call early in
 * the App body (before any project or API state is available).
 *
 * Returns
 * -------
 * toasts
 *     The live notification array.  Render with a ``key={t.id}`` stack.
 * toast
 *     Action: append a notification.  Stable across renders (does not
 *     belong in dep arrays of other hooks).
 */
export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<Toast[]>([])
  // Incrementing counter — a ref so mutation never triggers a re-render.
  const toastId = useRef(0)

  // Declared as a plain function (not useCallback) intentionally —
  // ``toast`` reads from the ref, not from any React state, so it
  // never goes stale. Keeping it out of useCallback prevents it from
  // appearing in dep arrays of other hooks (which would cause false
  // re-subscription cycles).
  function toast(type: 'success' | 'error' | 'warning', message: string): void {
    const id = ++toastId.current
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  return { toasts, toast }
}
