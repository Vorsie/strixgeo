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
 * How many appended bytes to accumulate before checking the log size (M8/L1).
 *
 * The launch-time rotation (see ``rotateIfNeeded`` in ``openMainLog``) bounded
 * the file only once, so a long verbose session appended past the cap until the
 * next restart. A ``statSync`` on every append would be needless UI-thread I/O,
 * so the size is re-checked once per this many bytes — negligible I/O, and the
 * active log never runs more than ~this-much plus one line past the cap.
 */
export const DEFAULT_CHECK_EVERY_BYTES = 64 * 1024

/** Filesystem operations a rotating appender needs — read-side plus ``append``. */
export interface AppendFsOps {
  fs: FsOps
  /** Append ``text`` to ``path`` (creating it if absent). */
  append: (path: string, text: string) => void
}

/**
 * Build an appender that keeps the active log bounded DURING a session.
 *
 * Each call appends the line (with a trailing newline) and, once
 * ``checkEveryBytes`` have accumulated since the last check, re-checks the file
 * size and rotates via {@link rotateIfNeeded} when it has crossed ``maxBytes``.
 * The rotated content lands in ``.1`` and the next append recreates a fresh
 * primary, so nothing is lost and the primary stays bounded.
 *
 * Pure but for the injected fs — the same shape the rotation tests already use,
 * so the whole thing is exercisable without touching a real disk.
 *
 * Parameters
 * ----------
 * logPath : string
 *     Absolute path to the primary log file.
 * maxBytes : number
 *     Rotation threshold in bytes.
 * maxFiles : number
 *     Number of backup generations to keep.
 * deps : AppendFsOps
 *     The injected filesystem read-ops plus the append primitive.
 * checkEveryBytes : number
 *     Bytes to accumulate between size checks. Defaults to
 *     {@link DEFAULT_CHECK_EVERY_BYTES}.
 *
 * Returns
 * -------
 * (line: string) => void
 *     Appends ``line`` + ``"\n"``, rotating when the file has grown past the cap.
 */
export function createRotatingAppender(
  logPath: string,
  maxBytes: number,
  maxFiles: number,
  deps: AppendFsOps,
  checkEveryBytes: number = DEFAULT_CHECK_EVERY_BYTES,
): (line: string) => void {
  let bytesSinceCheck = 0
  return (line: string): void => {
    const text = `${line}\n`
    deps.append(logPath, text)
    bytesSinceCheck += text.length
    if (bytesSinceCheck >= checkEveryBytes) {
      bytesSinceCheck = 0
      rotateIfNeeded(logPath, maxBytes, maxFiles, deps.fs)
    }
  }
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
