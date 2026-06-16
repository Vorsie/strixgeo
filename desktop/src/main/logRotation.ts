/**
 * Size-based log rotation helper for the backend log file.
 *
 * Keeps ``backend.log`` bounded to ``maxBytes`` by rotating to
 * ``backend.log.1`` → ``backend.log.2`` → ... up to ``maxFiles``
 * generations, dropping the oldest when the roster is full.
 *
 * Pure filesystem operations — no Electron, no streams. Accepts
 * injectable fs operations so the rotation logic is unit-testable
 * without touching the real filesystem.
 *
 * Parameters
 * ----------
 * logPath : string
 *     Absolute path to the primary log file (``backend.log``).
 * maxBytes : number
 *     Maximum size in bytes before a rotation is triggered.
 * maxFiles : number
 *     Number of rotated backups to keep (e.g. 3 → ``.1`` ``.2`` ``.3``).
 *
 * Returns
 * -------
 * void
 */

export interface FsOps {
  /** Return the size of ``path`` in bytes, or 0 if the file does not exist. */
  size: (path: string) => number
  /** Return true if ``path`` exists. */
  exists: (path: string) => boolean
  /** Rename (move) ``src`` to ``dest``, overwriting ``dest`` if present. */
  rename: (src: string, dest: string) => void
  /** Delete ``path`` silently if it exists. */
  unlink: (path: string) => void
}

/**
 * Decide whether the primary log file needs rotation.
 *
 * Parameters
 * ----------
 * currentSize : number
 *     Current size of the log file in bytes.
 * maxBytes : number
 *     Rotation threshold in bytes.
 *
 * Returns
 * -------
 * boolean
 *     True when rotation should be performed.
 */
export function shouldRotate(currentSize: number, maxBytes: number): boolean {
  return currentSize >= maxBytes
}

/**
 * Rotate log files if the primary log exceeds ``maxBytes``.
 *
 * Rotation order (3-file example):
 *   backend.log.2 → deleted (oldest)
 *   backend.log.1 → backend.log.2
 *   backend.log   → backend.log.1
 *   backend.log   → created fresh (by the caller, not here)
 *
 * This function performs only the rename/unlink operations — the caller
 * is responsible for closing the current write stream and opening a new
 * one after rotation.
 *
 * Parameters
 * ----------
 * logPath : string
 *     Absolute path to the primary log file.
 * maxBytes : number
 *     Rotation threshold in bytes.
 * maxFiles : number
 *     Number of backup generations to keep.
 * fs : FsOps
 *     Injected filesystem operations (real or test stub).
 *
 * Returns
 * -------
 * boolean
 *     True when rotation was performed (caller must reopen the stream).
 */
export function rotateIfNeeded(
  logPath: string,
  maxBytes: number,
  maxFiles: number,
  fs: FsOps,
): boolean {
  const current = fs.size(logPath)
  if (!shouldRotate(current, maxBytes)) return false

  // Drop the oldest backup (maxFiles-th generation).
  const oldest = `${logPath}.${maxFiles}`
  if (fs.exists(oldest)) {
    fs.unlink(oldest)
  }

  // Shift existing backups up one generation: .N-1 → .N … .1 → .2
  for (let i = maxFiles - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`
    const dest = `${logPath}.${i + 1}`
    if (fs.exists(src)) {
      fs.rename(src, dest)
    }
  }

  // Rotate the primary log to .1
  if (fs.exists(logPath)) {
    fs.rename(logPath, `${logPath}.1`)
  }

  return true
}

/**
 * Real filesystem implementation of FsOps using Node's ``fs`` module.
 *
 * Imported lazily so this module remains importable in a test environment
 * without bundling Node built-ins.
 *
 * Returns
 * -------
 * FsOps
 *     Real fs operations suitable for use in the main process.
 */
export function realFsOps(): FsOps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodefs = require('fs') as typeof import('fs')
  return {
    size: (p) => {
      try {
        return nodefs.statSync(p).size
      } catch {
        return 0
      }
    },
    exists: (p) => nodefs.existsSync(p),
    rename: (src, dest) => nodefs.renameSync(src, dest),
    unlink: (p) => {
      try {
        nodefs.unlinkSync(p)
      } catch {
        // Silently ignore — file may not exist
      }
    },
  }
}
