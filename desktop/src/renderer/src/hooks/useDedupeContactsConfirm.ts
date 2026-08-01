// The confirm-then-run state machine behind the Dedupe verb.
//
// Dedupe is offered in two places — the Geology toolbar and the Sections
// inspector's Model-actions row — and both had the same three lines of
// in-flight state with the same guard. Now that a confirmation dialog sits in
// front of the call, both need the same four: is the dialog open, is the
// cleanup in flight, what does the button do, what does the dialog do. Two
// copies of a state machine is where it gets extracted, before a third caller
// gets a subtly different one that forgets the gate.
//
// The gate itself is the point: the cleanup DB-deletes formation contacts and
// nothing restores them, so the handler must not be reachable from a single
// click (docs/ux.md, "Reversible vs irreversible").

import { useCallback, useState } from 'react'

/** Wiring for a Dedupe button plus its confirmation dialog. */
export interface DedupeContactsConfirmController {
  /** Whether the confirmation dialog should render. */
  confirmOpen: boolean
  /** Whether the cleanup is in flight — disables the button and the dialog. */
  deduping: boolean
  /** The Dedupe button's click handler. Opens the dialog; deletes nothing. */
  requestDedupe: () => void
  /** Dismiss without running. */
  cancelDedupe: () => void
  /** Run the cleanup, then close the dialog. */
  confirmDedupe: () => void
}

/**
 * Gate the contact-dedupe cleanup behind a confirmation.
 *
 * Parameters
 * ----------
 * onDedupe : () => Promise<unknown>
 *     The cleanup itself (``handleDedupeContacts`` off the shell bus). Called
 *     exactly once per confirmed run, and never before the user confirms.
 * enabled : boolean
 *     False when there is no model to clean — the request is then a no-op, so
 *     a stale click cannot open a dialog whose confirm would do nothing.
 *
 * Returns
 * -------
 * DedupeContactsConfirmController
 *     Dialog-open + in-flight flags and the three handlers.
 */
export function useDedupeContactsConfirm(
  onDedupe: () => Promise<unknown>,
  enabled: boolean,
): DedupeContactsConfirmController {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deduping, setDeduping] = useState(false)

  const requestDedupe = useCallback(() => {
    if (!enabled || deduping) return
    setConfirmOpen(true)
  }, [enabled, deduping])

  const cancelDedupe = useCallback(() => {
    // Never close mid-run: the dialog is the only thing showing that a
    // destructive action is still in flight.
    if (deduping) return
    setConfirmOpen(false)
  }, [deduping])

  const confirmDedupe = useCallback(() => {
    if (!enabled || deduping) return
    setDeduping(true)
    void (async () => {
      try {
        await onDedupe()
      } finally {
        setDeduping(false)
        setConfirmOpen(false)
      }
    })()
  }, [enabled, deduping, onDedupe])

  return { confirmOpen, deduping, requestDedupe, cancelDedupe, confirmDedupe }
}
