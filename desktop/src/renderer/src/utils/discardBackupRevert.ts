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
 * The twin of the pre-discard revert is the post-discard RELOAD
 * (``reloadProjectAfterDiscard``): the reverted database has to become what
 * the engineer looks at, and that reload must be a real close-and-open.
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

export interface ReloadProjectAfterDiscardDeps {
  /** The open project's file path at the moment of the discard; ``null`` = nothing to reload. */
  path: string | null
  /** ``closeProject`` — nulls the live project so every project-keyed loader clears. */
  close: () => void
  /** ``openProjectFile`` — adopts the file's project again. */
  open: (path: string) => Promise<unknown>
}

/**
 * Reload the project from its file after a crash backup was deleted.
 *
 * WHY close first: every project-keyed loader (sections, CPTs, boreholes, the
 * models) refetches on a project-id CHANGE. The revert replays the file over
 * the database, but reopening the same file keeps the same id, so a plain
 * reopen refetched nothing — the section list stayed as it was before the
 * revert and the next body recompute was refused ("the payload must cover
 * every section of the project exactly", the "Body identity could not be
 * saved" toast; owner 2026-09-23). Closing first makes the reopen a real
 * transition for every list, exactly as if the engineer had closed and
 * reopened the project by hand. The path is captured BEFORE the close, which
 * nulls it.
 */
export async function reloadProjectAfterDiscard(deps: ReloadProjectAfterDiscardDeps): Promise<void> {
  const path = deps.path
  if (path === null) return
  deps.close()
  await deps.open(path)
}
