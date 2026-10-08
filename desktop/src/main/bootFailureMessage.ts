/**
 * Turn a recognised packaged-boot failure into a message that names the CAUSE,
 * not just the stage (M8).
 *
 * ``bootEmbeddedDatabase`` otherwise shows the generic per-stage sentence from
 * {@link ./embedded/bootSequence.describeStage} plus the raw technical message.
 * For the one failure a user can actually act on — an older build opening a
 * database a NEWER StrixGeo wrote — that generic wording ("StrixGeo could not
 * prepare the database for use") reads like corruption. It is not: their data is
 * intact, and the fix is to install the current version.
 *
 * The signal comes from the ``run-migrations`` stage: alembic fails with "Can't
 * locate revision identified by '<rev>'" when the cluster is stamped at a
 * revision that this build's migration scripts do not contain. That is a
 * heuristic on the migrator's own text — a robust machine-readable signal would
 * be a dedicated exit code from the backend migrator (audit H2, a separate
 * change); until then, this is the cheapest honest mapping and it is kept here,
 * pure and testable, rather than inline in ``index.ts``.
 *
 * @module main/bootFailureMessage
 */

/** A title + detail pair for ``dialog.showErrorBox``. */
export interface BootFailureDialogCopy {
  title: string
  detail: string
}

/**
 * Alembic's "revision not found" text, in the apostrophe/case variants seen in
 * the wild. Present only when the stamped revision is unknown to this build —
 * i.e. the database was written by a newer StrixGeo.
 */
export const NEWER_DATABASE_SIGNAL = /can'?t locate revision/i

/**
 * Map a boot failure to a tailored dialog copy, or ``null`` to use the generic
 * stage message.
 *
 * Parameters
 * ----------
 * failure : { stage: string; message: string }
 *     The stage that failed and its underlying technical message.
 *
 * Returns
 * -------
 * BootFailureDialogCopy | null
 *     A named copy for a recognised cause; ``null`` otherwise.
 */
export function tailoredBootFailureCopy(failure: {
  stage: string
  message: string
}): BootFailureDialogCopy | null {
  if (failure.stage === 'run-migrations' && NEWER_DATABASE_SIGNAL.test(failure.message)) {
    return {
      title: 'StrixGeo — this database is from a newer version',
      detail:
        'This database was written by a newer StrixGeo than the one you are ' +
        'running. Install the current version and open your project again — ' +
        'your data is intact; nothing has been changed.',
    }
  }
  return null
}
