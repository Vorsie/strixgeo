// User-facing copy for the two close-flow outcomes that keep the project open.
//
// Audit 2026-08-02: a failed save and a refused revert both ended in a
// ``log.error`` and nothing else. The dialog stayed up with no explanation and
// Ctrl+S looked like a no-op, so "the app ate my afternoon" reports had no
// on-screen evidence at all. These builders are pure so the wording is
// testable without rendering a dialog, and shared so the toast and the dialog
// body cannot say different things about the same event.

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
 * Copy for a Discard whose revert was refused by the save-anchor gate.
 *
 * The refusal is the SAFE outcome, so the copy has to explain why nothing
 * happened rather than read as a failure the engineer should retry: the file
 * on disk is not this project's latest save, so replaying it would delete work
 * it never contained.
 *
 * Parameters
 * ----------
 * filePath : string | null
 *     The project's file path, or null when it is somehow absent.
 *
 * Returns
 * -------
 * string
 *     One sentence pair naming the file and the two ways out.
 */
export function refusedRevertMessage(filePath: string | null): string {
  const target = filePath === null ? 'The project file' : baseName(filePath)
  return (
    `${target} is not this project's latest save, so discarding by reverting to it ` +
    `would delete work that file never contained. Nothing was changed — save the ` +
    `project, or point it at the right file, before closing.`
  )
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
