/**
 * Move an existing Roaming ``pgdata`` cluster to Local on the first launch of
 * the machine-local layout (audit M1).
 *
 * The layout change (large stores → ``%LOCALAPPDATA%\StrixGeo``) would otherwise
 * strand a cluster an already-installed profile created under Roaming: Postgres
 * would start against an empty Local dir and the user's data would appear gone
 * (it is not — it is in the old Roaming ``pgdata``). So before Postgres starts,
 * if a Roaming cluster exists and no Local one does, relocate it.
 *
 * A same-volume ``rename`` is atomic and instant — the normal case, since
 * Roaming and Local usually share the ``C:`` volume. A cross-volume move
 * (redirected Roaming on another drive) falls back to copy → verify → delete,
 * and NEVER deletes the original until the copy is verified, so a failure leaves
 * the cluster exactly where it was.
 *
 * The fs is injected so the decision and every branch are unit-testable; a
 * real-fs implementation ({@link realPgdataFsOps}) drives production.
 *
 * @module main/pgdataMigration
 */

import { join } from 'path'

/** Whether a cluster needs relocating. */
export type PgdataMigrationDecision = 'move' | 'skip'

/** The outcome of a relocation attempt. */
export type PgdataMigrationResult = 'moved' | 'skipped' | 'failed'

/** The filesystem operations a relocation needs — injected for testability. */
export interface PgdataFsOps {
  exists: (path: string) => boolean
  /** Move a directory; throws (e.g. ``EXDEV``) when the move crosses volumes. */
  rename: (src: string, dest: string) => void
  /** Recursively copy a directory tree. */
  copyDir: (src: string, dest: string) => void
  /** Recursively delete a directory tree. */
  removeDir: (path: string) => void
  /** Whether a rename error means the move crossed volumes (``EXDEV``). */
  isCrossVolume: (err: unknown) => boolean
}

/**
 * Decide whether the Roaming cluster should be relocated.
 *
 * @param sourceExists - Whether the Roaming ``pgdata`` exists.
 * @param destExists - Whether the Local ``pgdata`` already exists.
 * @returns ``'move'`` only when there is a source and no dest yet.
 */
export function decidePgdataMigration(
  sourceExists: boolean,
  destExists: boolean,
): PgdataMigrationDecision {
  return sourceExists && !destExists ? 'move' : 'skip'
}

/**
 * The stamp file every valid PostgreSQL data directory carries — used to verify
 * a cross-volume copy before the original is deleted.
 */
const CLUSTER_VERSION_STAMP = 'PG_VERSION'

/**
 * Relocate the cluster from ``source`` to ``dest`` if needed.
 *
 * @param source - The Roaming ``pgdata`` path.
 * @param dest - The Local ``pgdata`` path.
 * @param fs - Injected filesystem operations.
 * @param log - Log sink (backend log in production).
 * @returns ``'moved'`` on success, ``'skipped'`` when nothing was to be done,
 *   ``'failed'`` when the move could not complete (the original is kept intact).
 */
export function migratePgdata(
  source: string,
  dest: string,
  fs: PgdataFsOps,
  log: (line: string) => void,
): PgdataMigrationResult {
  if (decidePgdataMigration(fs.exists(source), fs.exists(dest)) === 'skip') {
    return 'skipped'
  }
  try {
    fs.rename(source, dest)
    log(`[pgdata] moved the database cluster to ${dest} (rename)`)
    return 'moved'
  } catch (err) {
    if (!fs.isCrossVolume(err)) {
      log(`[pgdata] could not move the cluster to ${dest}: ${String(err)} — keeping it in place`)
      return 'failed'
    }
    // Cross-volume: copy, verify the copy carries the version stamp, then and
    // only then remove the original.
    try {
      fs.copyDir(source, dest)
      if (!fs.exists(join(dest, CLUSTER_VERSION_STAMP))) {
        fs.removeDir(dest)
        log('[pgdata] cross-volume copy failed verification (no PG_VERSION) — kept the original')
        return 'failed'
      }
      fs.removeDir(source)
      log(`[pgdata] copied the cluster to ${dest} across volumes and removed the original`)
      return 'moved'
    } catch (copyErr) {
      log(`[pgdata] cross-volume migration failed: ${String(copyErr)} — keeping the original`)
      return 'failed'
    }
  }
}

/**
 * Real-filesystem implementation of {@link PgdataFsOps} using Node's ``fs``.
 *
 * Imported lazily so this module stays importable in a jsdom test environment.
 *
 * @returns Filesystem operations backed by ``node:fs``.
 */
export function realPgdataFsOps(): PgdataFsOps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodefs = require('fs') as typeof import('fs')
  return {
    exists: (p) => nodefs.existsSync(p),
    rename: (src, dest) => nodefs.renameSync(src, dest),
    copyDir: (src, dest) => nodefs.cpSync(src, dest, { recursive: true }),
    removeDir: (p) => nodefs.rmSync(p, { recursive: true, force: true }),
    isCrossVolume: (err) => (err as NodeJS.ErrnoException)?.code === 'EXDEV',
  }
}
