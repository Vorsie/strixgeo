/**
 * The pre-discard revert of a crash backup, as a decision the UI can ask about.
 *
 * "Delete backup" means the crashed session never happened (owner ruling
 * 2026-08-03): before the backup dies, the database is replayed from the last
 * save. That replay is REFUSED when the file on disk is not this project's
 * latest save — a hand-made copy, or the file of a save whose write never
 * landed. Until 2026-09-10 the refusal was a toast and the backup stayed: a
 * dead end the owner met on the packaged build ("deze melding zie ik niet
 * graag, users gaan hierop vloeken"). The refusal is now a QUESTION — revert
 * to that file anyway (a named destructive choice, Cancel focused) or keep the
 * backup — exactly as the close flow already asks (installer #26).
 *
 * Pure module: the revert, the question and the toast are injected so the
 * decision is testable without React.
 *
 * @module utils/discardBackupRevert
 */
import type { RevertToLastSavedResult } from '../hooks/useProject'

export interface DiscardBackupRevertDeps {
  /** ``revertToLastSaved`` — ``force`` skips the latest-save check. */
  revert: (force?: boolean) => Promise<RevertToLastSavedResult>
  /** Opens the force-revert confirmation; resolves true on "revert anyway". */
  askForceRevert: () => Promise<boolean>
  /** The app toast. Only a FAULT reaches it now — a refusal is asked, not toasted. */
  toast: (kind: 'error', message: string) => void
  /** Active-language message lookup (``project.revertFailed``). */
  message: (key: 'project.revertFailed') => string
}

/**
 * Revert the database to the last save before a crash backup is deleted.
 *
 * @returns ``true`` when the discard may proceed (reverted, or nothing on disk
 *   to revert to); ``false`` when the backup must be kept — the engineer chose
 *   Cancel, or the revert faulted (which is toasted).
 */
export async function revertBeforeDiscardBackup(deps: DiscardBackupRevertDeps): Promise<boolean> {
  const first = await deps.revert()
  if (first === 'reverted' || first === 'no-snapshot') return true
  if (first === 'refused-not-latest-save') {
    const revertAnyway = await deps.askForceRevert()
    if (!revertAnyway) return false
    const forced = await deps.revert(true)
    if (forced === 'reverted' || forced === 'no-snapshot') return true
  }
  deps.toast('error', deps.message('project.revertFailed'))
  return false
}
