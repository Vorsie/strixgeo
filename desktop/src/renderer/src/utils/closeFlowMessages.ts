// User-facing copy for the close-flow outcomes that keep the project open.
//
// Audit 2026-08-02: a failed save and a refused revert both ended in a
// ``log.error`` and nothing else. The dialog stayed up with no explanation and
// Ctrl+S looked like a no-op, so "the app ate my afternoon" reports had no
// on-screen evidence at all. These builders keep the wording in one place so
// the toast and the dialog body cannot say different things about the same
// event.
//
// ``refusedRevertMessage`` now feeds the force-revert CONFIRMATION dialog
// (owner ruling, installer #26 2026-09-08) rather than a dead-end toast, so it
// is translated (EN + NL) — the owner dogfeeds in Dutch and this is a prominent
// destructive prompt. The remaining two stay pure English toasts (unchanged).

import { t } from '../i18n/translate'

/** Last path segment of a Windows or POSIX path (the file's display name). */
function baseName(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}

/**
 * Copy for a save that did not reach its ``.strix`` file.
 *
 * Names the file, states the consequence in the engineer's terms (the work is
 * still unsaved), and gives the two causes that actually occur on this
 * platform — the file open in another program, and a sync client holding a
 * lock.
 *
 * Parameters
 * ----------
 * filePath : string | null
 *     The project's file path, or null for a never-saved project.
 *
 * Returns
 * -------
 * string
 *     One sentence pair, safe to show in a toast and in the dialog body.
 */
export function failedSaveMessage(filePath: string | null): string {
  const target = filePath === null ? 'the project file' : baseName(filePath)
  return (
    `Could not save to ${target} — the project is still unsaved. ` +
    `Close the file in Explorer or your sync client (OneDrive, Dropbox) and try again.`
  )
}

/**
 * Body for the force-revert confirmation dialog (owner ruling, installer #26).
 *
 * The .strix on disk is not this project's latest save, so replaying it would
 * delete work it never contained. Rather than dead-ending (the old behaviour,
 * which trapped the user into Task Manager), the close flow now names the file
 * and spells out the loss, then offers the destructive revert or Save. This is
 * that named-loss copy — translated (EN + NL) via the ``{file}`` placeholder,
 * because it is a prominent destructive prompt the owner reads in Dutch.
 *
 * Parameters
 * ----------
 * filePath : string | null
 *     The project's file path, or null when it is somehow absent.
 *
 * Returns
 * -------
 * string
 *     The dialog body, naming the file and the loss, in the active language.
 */
export function refusedRevertMessage(filePath: string | null): string {
  // A refused revert only happens for a SAVED project, so filePath is non-null
  // in practice; the fallback is defensive (this value is never shown when the
  // prompt stays closed).
  const file = filePath === null ? 'the project file' : baseName(filePath)
  return t('project.closeForceRevertBody', { file })
}

/**
 * Body of the force-revert question asked by "Delete backup" in the
 * crash-recovery prompt (owner 2026-09-10): the same refusal as
 * :func:`refusedRevertMessage`, but the loss named here is the crashed session
 * plus the backup, and Cancel keeps the backup.
 *
 * Parameters
 * ----------
 * filePath : string | null
 *     The project's file path, or null when it is somehow absent.
 *
 * Returns
 * -------
 * string
 *     The dialog body in the active language.
 */
export function discardBackupRevertMessage(filePath: string | null): string {
  const file = filePath === null ? 'the project file' : baseName(filePath)
  return t('project.discardBackupForceRevertBody', { file })
}

/**
 * Copy for a Discard whose revert threw.
 *
 * Deliberately distinct from :func:`refusedRevertMessage`: a refusal is a
 * decision, a failure is a fault, and only the second is worth retrying.
 *
 * Parameters
 * ----------
 * filePath : string | null
 *     The project's file path, or null when it is absent.
 *
 * Returns
 * -------
 * string
 *     One sentence pair naming the file and confirming nothing was deleted.
 */
export function failedRevertMessage(filePath: string | null): string {
  const target = filePath === null ? 'the project file' : baseName(filePath)
  return (
    `Could not restore this project from ${target}, so the close was cancelled. ` +
    `Nothing was deleted — your session's work is still here. Check the file is ` +
    `readable and try again.`
  )
}
