/**
 * A yes/no dialog as an awaitable question.
 *
 * ``ask()`` opens the dialog and resolves with the engineer's answer; the
 * dialog's buttons call ``answer(true | false)``. Lets an async flow (the
 * crash-backup discard, 2026-09-10) pause on a confirmation without threading
 * dialog state through every caller.
 *
 * @module hooks/usePromiseConfirm
 */
import { useCallback, useRef, useState } from 'react'

export interface PromiseConfirm {
  /** Whether the dialog is open. */
  open: boolean
  /** Open the dialog; resolves with the answer. A second ask while open answers the first with false. */
  ask: () => Promise<boolean>
  /** Close the dialog with the given answer. A no-op when nothing is pending. */
  answer: (value: boolean) => void
}

/** See module docs. */
export function usePromiseConfirm(): PromiseConfirm {
  const [open, setOpen] = useState(false)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const answer = useCallback((value: boolean): void => {
    const resolve = resolver.current
    resolver.current = null
    setOpen(false)
    if (resolve) resolve(value)
  }, [])

  const ask = useCallback((): Promise<boolean> => {
    if (resolver.current) resolver.current(false)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setOpen(true)
    })
  }, [])

  return { open, ask, answer }
}
