// Undo / redo stack for the geological-model editor (debt #45).
//
// Command-pattern implementation. Each mutation handler in App.tsx
// builds an ``UndoCommand`` after the action succeeds and pushes it
// to this hook. Ctrl+Z pops from the undo stack and calls
// ``revert()``; Ctrl+Y / Ctrl+Shift+Z pops from the redo stack and
// calls ``reapply()``.
//
// Critical invariants:
//
// * **Mutations push AFTER success.** Failed mutations don't enter
//   the stack — undoing a never-applied action would be a no-op
//   that confuses the redo path.
// * **A new push clears the redo stack.** Redo only makes sense
//   linearly; once the user does something new, prior undone work
//   becomes unreachable.
// * **Serial queue.** Rapid Ctrl+Z / Ctrl+Y presses (or holding
//   the key with browser auto-repeat) chain onto a single
//   per-hook promise so the reverts run one-at-a-time, never in
//   parallel. Each press peels one entry from history; the user
//   can walk the entire stack by holding the key.
// * **Diverged-state safety net.** If a revert / reapply throws,
//   the entire history is cleared and an error toast surfaces.
//   The local state is now ahead of (or behind) the server in an
//   unknown way, so the safe move is to abandon all pending undo
//   commands rather than risk corrupting more state. A command that
//   refuses itself with ``UndoConflictError`` (the state moved on, so
//   the step would duplicate a row) clears the history the same way,
//   but at WARN with a warning toast: an expected conflict, not a bug.
// * **Stack cap.** Bounded at 100 entries by default — the oldest
//   action drops off the bottom. Geotechnical sessions are bursty
//   (~tens of picks per workflow chunk); 100 is enough headroom
//   without unbounded memory growth across a long session.

import { useCallback, useRef, useState } from 'react'

import { log } from '../utils/log'
import { t } from '../i18n/translate'
import { UndoConflictError } from './undoConflictError'
import type { MessageKey } from '../i18n/locales/en'
import type { MessageParams } from '../i18n/translate'

/** One undoable mutation.
 *
 * ``descriptionKey`` is an i18n KEY, not rendered text (ruling 11): every
 * reader resolves it through ``t()`` at display time, so the interface language
 * can flip mid-session and the "history cleared" toast re-renders in the new
 * language. Log lines keep the raw key. */
export interface UndoCommand {
  /** i18n key naming the action (e.g. ``'undo.moveContact'``). Typed against
   * the EN catalogue so a typo is a ``tsc`` error at the push site. */
  descriptionKey: MessageKey
  /** Optional values for the key's ``{placeholder}`` slots. */
  descriptionParams?: MessageParams
  /** Reverse the action. Must restore both the server state AND
   * the caller's local state to what it was before ``apply`` /
   * ``reapply`` ran. */
  revert: () => Promise<void>
  /** Replay the action (after a previous ``revert``). Most commands
   * mutate their own captured ids inside this call so the next
   * ``revert`` targets the freshly-created server rows. */
  reapply: () => Promise<void>
}

export interface UseUndoStackOptions {
  /** Maximum stack depth per direction. Older entries drop off the
   * bottom of the undo stack when this is exceeded. Default 100. */
  capacity?: number
  /** Optional toast hook so the safety-net "history cleared" message
   * surfaces in the same UX as other action toasts. When omitted,
   * the failure is logged but no toast fires. */
  onError?: (message: string) => void
  /** Optional toast hook for an EXPECTED conflict: a step that threw
   * {@link UndoConflictError} because the state moved on (walker finding
   * 2026-10-12). History is still cleared; only the level differs. */
  onWarning?: (message: string) => void
}

export interface UseUndoStackResult {
  /** Push a command after a successful mutation. Resets the redo
   * stack. */
  push: (cmd: UndoCommand) => void
  /** Pop the most recent command and revert it. */
  undo: () => Promise<void>
  /** Pop the most recently undone command and re-apply it. */
  redo: () => Promise<void>
  /** Empty both stacks — typically called on project switch /
   * close so undo can't reach across project boundaries. */
  clear: () => void
  /** True when the most recent undo/redo operation is in flight.
   * Drives the keyboard handler's re-entry guard + a future UI
   * disabled state on Edit-menu items. */
  busy: boolean
  /** True when there's at least one undoable action available. */
  canUndo: boolean
  /** True when there's at least one redoable action available. */
  canRedo: boolean
}

const DEFAULT_CAPACITY = 100

export function useUndoStack(
  options: UseUndoStackOptions = {},
): UseUndoStackResult {
  const capacity = options.capacity ?? DEFAULT_CAPACITY
  // The stacks are refs first, useState second. Reads inside the
  // callbacks below need to be SYNCHRONOUS — React's setState
  // updater fn runs in the commit phase, which is too late for
  // the "did anything actually happen?" early-return checks here.
  // The useState pair drives re-renders for canUndo / canRedo.
  const undoStackRef = useRef<UndoCommand[]>([])
  const redoStackRef = useRef<UndoCommand[]>([])
  const [undoStack, setUndoStack] = useState<UndoCommand[]>([])
  const [redoStack, setRedoStack] = useState<UndoCommand[]>([])
  const [busy, setBusy] = useState(false)
  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError
  const onWarningRef = useRef(options.onWarning)
  onWarningRef.current = options.onWarning
  // Serial queue — rapid Ctrl+Z presses (or holding the key with
  // browser auto-repeat) chain onto this promise so reverts run
  // one at a time. Each call returns its own slot's promise.
  // ``.catch(() => {})`` keeps the chain healthy even when a
  // queued op rejects (the catch inside each op already routes
  // failures into the clear-stacks safety net).
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  // Reference-counted in-flight tracker — drives the ``busy``
  // flag. Goes to 0 when the entire queue has drained.
  const inFlightRef = useRef(0)

  // Helper — write both the ref and the React state in one shot so
  // they never diverge. Forgotten ref writes are the most common
  // way this kind of pattern goes wrong.
  function commitUndo(next: UndoCommand[]): void {
    undoStackRef.current = next
    setUndoStack(next)
  }
  function commitRedo(next: UndoCommand[]): void {
    redoStackRef.current = next
    setRedoStack(next)
  }

  // Helper: an EXPECTED conflict (the command refused itself because the
  // state moved on, before sending anything). The history is cleared like a
  // genuine failure, because the recorded command no longer matches the
  // model, but it is not a bug: WARN + a warning toast, never ERROR
  // (walker finding 2026-10-12: a refused redo counted as a console error).
  function abandonOnConflict(
    direction: 'revert' | 'reapply',
    cmd: UndoCommand,
    err: UndoConflictError,
  ): void {
    log.warn('undo', `${direction} skipped (state moved on): ${cmd.descriptionKey}`, err.message)
    commitUndo([])
    commitRedo([])
    onWarningRef.current?.(t(err.messageKey))
  }

  const push = useCallback(
    (cmd: UndoCommand) => {
      const next = [...undoStackRef.current, cmd]
      // Drop the oldest entries when over capacity. The user loses
      // the ability to undo all the way back, but bounded memory
      // is the more important property here.
      const capped =
        next.length > capacity
          ? next.slice(next.length - capacity)
          : next
      commitUndo(capped)
      // New action invalidates any redo branch.
      commitRedo([])
      log.debug('undo', `pushed: ${cmd.descriptionKey}`)
    },
    [capacity],
  )

  const clear = useCallback(() => {
    commitUndo([])
    commitRedo([])
    log.debug('undo', 'stacks cleared')
  }, [])

  // Helper — enqueue ``work`` onto the serial queue. Tracks the
  // in-flight count so ``busy`` reflects "is the queue draining?".
  // The ``.catch(() => {})`` on the chain stub keeps subsequent
  // enqueued ops alive when one rejects (each op already handles
  // its own failure via the clear-stacks safety net).
  function enqueue(work: () => Promise<void>): Promise<void> {
    inFlightRef.current += 1
    setBusy(true)
    const slot = queueRef.current.then(work)
    queueRef.current = slot.catch(() => {})
    return slot.finally(() => {
      inFlightRef.current -= 1
      if (inFlightRef.current === 0) setBusy(false)
    })
  }

  const undo = useCallback((): Promise<void> => {
    return enqueue(async () => {
      const stack = undoStackRef.current
      if (stack.length === 0) return
      const cmd = stack[stack.length - 1]
      commitUndo(stack.slice(0, -1))
      try {
        await cmd.revert()
        commitRedo([...redoStackRef.current, cmd])
        log.debug('undo', `reverted: ${cmd.descriptionKey}`)
      } catch (err) {
        if (err instanceof UndoConflictError) {
          abandonOnConflict('revert', cmd, err)
          return
        }
        log.error('undo', `revert failed: ${cmd.descriptionKey}`, err)
        // State is now in an unknown relation to the server.
        // Abandon history rather than risk further corruption.
        commitUndo([])
        commitRedo([])
        // Name the failed action in the toast so the user can see WHICH undo
        // blew up — dogfeed 2026-05-31: a Ctrl-Z intended for a manual
        // correlate actually targeted a much heavier "Delete formation" revert
        // and the opaque toast hid the mismatch. Resolved at display time so a
        // Dutch session reads it in Dutch (ruling 11).
        onErrorRef.current?.(
          t('undo.undoFailed', { action: t(cmd.descriptionKey, cmd.descriptionParams) }),
        )
      }
    })
  }, [])

  const redo = useCallback((): Promise<void> => {
    return enqueue(async () => {
      const stack = redoStackRef.current
      if (stack.length === 0) return
      const cmd = stack[stack.length - 1]
      commitRedo(stack.slice(0, -1))
      try {
        await cmd.reapply()
        const next = [...undoStackRef.current, cmd]
        const capped =
          next.length > capacity
            ? next.slice(next.length - capacity)
            : next
        commitUndo(capped)
        log.debug('undo', `reapplied: ${cmd.descriptionKey}`)
      } catch (err) {
        if (err instanceof UndoConflictError) {
          abandonOnConflict('reapply', cmd, err)
          return
        }
        log.error('undo', `reapply failed: ${cmd.descriptionKey}`, err)
        commitUndo([])
        commitRedo([])
        onErrorRef.current?.(
          t('undo.redoFailed', { action: t(cmd.descriptionKey, cmd.descriptionParams) }),
        )
      }
    })
  }, [capacity])

  return {
    push,
    undo,
    redo,
    clear,
    busy,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  }
}
