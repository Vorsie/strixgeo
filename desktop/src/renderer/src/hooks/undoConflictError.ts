// An undo / redo step refused because the state moved on (walker finding
// 2026-10-12): the expected-conflict twin of a genuine failure.

import type { MessageKey } from '../i18n/locales/en'

/**
 * Thrown by an ``UndoCommand``'s ``revert`` / ``reapply`` when the step cannot
 * run because the model state moved on since the command was recorded (for
 * example: the contact a redo would re-create already exists on that test).
 *
 * The undo engine treats it as an EXPECTED conflict: it still clears the
 * history (the state no longer matches the recorded command), but it logs at
 * WARN and shows a warning toast with ``messageKey`` instead of the
 * "Redo failed" error toast. Any other thrown error keeps the error path.
 *
 * The command must throw it BEFORE it sends any request, so nothing is
 * half-applied and the backend never answers the refusal itself.
 */
export class UndoConflictError extends Error {
  /** i18n key of the warning toast the engine shows. */
  readonly messageKey: MessageKey

  /**
   * @param messageKey - i18n key of the warning toast (resolved at display time).
   * @param detail - Optional log detail (ids), never shown to the user.
   */
  constructor(messageKey: MessageKey, detail?: string) {
    super(detail ?? messageKey)
    this.name = 'UndoConflictError'
    this.messageKey = messageKey
  }
}
