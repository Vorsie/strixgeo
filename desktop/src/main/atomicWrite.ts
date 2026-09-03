/**
 * Shared atomic file-write helper for the Electron main process.
 *
 * Extracted from ``index.ts`` when the recovery-file store became a second
 * caller — one copy, one set of tests. The module deliberately imports only
 * Node built-ins (no ``electron``) so it stays unit-testable in vitest
 * alongside the other pure main-process helpers.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'

/** Sibling temp path this process writes to before renaming into place. */
function tmpPathFor(filePath: string): string {
  return `${filePath}.tmp.${process.pid}`
}

/**
 * Write ``contents`` to ``tmpPath`` and flush it to disk (open + write + fsync
 * + close), the durable half shared by both public writers below.
 *
 * The fsync-before-rename reasoning is documented on {@link writeFileAtomic};
 * this helper exists so the generation-keeping writer reuses the exact same
 * durable write rather than a second copy that could drift.
 *
 * @param tmpPath - Sibling temp file to create.
 * @param contents - UTF-8 text, or raw bytes for binary callers.
 * @throws The underlying open / write / fsync error (the caller cleans up).
 */
function writeTempFileSync(tmpPath: string, contents: string | Uint8Array): void {
  const fd = openSync(tmpPath, 'w')
  try {
    // The encoding argument is passed ONLY for text. Node ignores it for a
    // TypedArray today, but naming an encoding for bytes invites a future
    // reader (or a future Node) to treat the payload as text — and a .strix
    // container that survives a UTF-8 round-trip is not a property we rely on.
    if (typeof contents === 'string') writeFileSync(fd, contents, 'utf-8')
    else writeFileSync(fd, contents)
    fsyncSync(fd)
  } finally {
    // Swallow a close failure: if write/fsync already threw, a throwing
    // closeSync here would REPLACE the in-flight error (finally semantics).
    try {
      closeSync(fd)
    } catch {
      /* swallow */
    }
  }
}

/**
 * Write ``contents`` to ``filePath`` atomically — via a sibling temp file
 * that is renamed into place.
 *
 * Rationale: a save that gets interrupted (process kill, power loss between
 * two saves, second save racing the first) MUST NOT leave the target file
 * half-overwritten. The dogfeed bug on 2026-05-20 was exactly this — a
 * ``\x08`` (backspace) byte mid-array with a partially-duplicated value,
 * traced to two writes overlapping. It matters even more for the crash
 * recovery file, whose entire reason to exist is being readable after an
 * abrupt process death.
 *
 * ``renameSync`` on the same filesystem is atomic at the directory metadata
 * level on both NTFS (Windows) and ext4/APFS — either the old file or the
 * new file is visible to readers, never a half-written blend. The temp lives
 * in the same directory as the target so no cross-filesystem rename
 * fall-back to copy+delete occurs.
 *
 * Crash mid-write leaves a ``<basename>.tmp.<pid>`` orphan that the user can
 * safely delete (no automatic cleanup — that path would risk deleting a tmp
 * from a concurrent save that hasn't renamed yet). Consumers that enumerate
 * a directory must therefore ignore unknown suffixes rather than assume
 * every file present is a finished one.
 *
 * @param filePath - Absolute path of the file to write.
 * @param contents - UTF-8 text, or raw bytes for binary callers (the DXF /
 *   Plaxis export IPC hands over an ``ArrayBuffer``).
 * @throws The underlying write or rename error when the file cannot be put
 *   into place (the temp is best-effort cleaned up first).
 */
export function writeFileAtomic(filePath: string, contents: string | Uint8Array): void {
  const tmpPath = tmpPathFor(filePath)
  try {
    // The write is INSIDE the try alongside the rename: a disk-full or
    // permission failure mid-write leaves a partial temp behind just as surely
    // as a failed rename does, and the recovery directory is enumerated at
    // every launch — orphans there accumulate one per failed autosave.
    //
    // fsync before the rename (autosave review Q8): rename-into-place is
    // atomic against a PROCESS death, but without a flush the renamed file's
    // bytes can still sit in the OS page cache — a power loss or bluescreen
    // right after the rename can leave the CURRENT file empty or truncated,
    // which for the recovery snapshot defeats its entire reason to exist.
    // Directory-entry fsync (the belt to this suspender) is not reachable
    // from Node on Windows (a directory cannot be opened for sync), so the
    // file-data flush is where durability hardening stops on this platform.
    // Cost is a few ms per call — fine for every caller (2s/15s recovery
    // cadence, one-shot .strix saves and exports).
    writeTempFileSync(tmpPath, contents)
    renameSync(tmpPath, filePath)
  } catch (writeErr) {
    // Best-effort tmp cleanup so we don't leak. Swallow unlink errors (the tmp
    // may never have been created, may already be gone, or perms changed) and
    // re-throw the original failure as the user-visible one.
    try {
      unlinkSync(tmpPath)
    } catch {
      /* swallow */
    }
    throw writeErr
  }
}

/**
 * Default sink for a rotation-failure line when a caller passes no logger.
 *
 * The main process pipes ``console.warn`` into ``backend.log``, so the line is
 * captured there; a caller with its own structured logger passes it as the
 * fourth argument. A rotation failure is a lost recovery convenience, never a
 * failed save — hence a warning, not a throw.
 */
function defaultRotationLog(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(message)
}

/**
 * Rotate the ``keep`` on-disk generations of ``filePath`` up by one so the
 * about-to-be-overwritten current file is preserved as ``<filePath>.1``.
 *
 * The chain is ``<filePath>`` → ``.1`` → ``.2`` → … → ``.keep``, oldest first
 * to fall off the end: the oldest kept (``.keep``) is removed, then each
 * ``.i`` shifts to ``.i+1``, then the current file becomes ``.1``.
 *
 * BEST-EFFORT BY CONTRACT. A rotation is a recovery convenience, not the save
 * itself — a save must never fail because an old generation could not be moved
 * (a stale read-only backup, a directory sitting where a generation belongs,
 * an antivirus lock). Any failure is logged and swallowed; the caller then
 * renames the new content into ``filePath`` regardless, which at worst loses
 * one generation, never the save.
 *
 * @param filePath - The file whose generations rotate.
 * @param keep - How many previous generations to keep (``.1`` … ``.keep``).
 * @param log - Sink for a single rotation-failure line.
 */
function rotateGenerations(filePath: string, keep: number, log: (message: string) => void): void {
  const gen = (n: number): string => `${filePath}.${n}`
  try {
    // Drop the one that would fall off the end so the shift below has a free
    // slot. unlink refuses a directory, which is one shape a "cannot rotate"
    // failure takes — caught below, the save still proceeds.
    if (existsSync(gen(keep))) unlinkSync(gen(keep))
    for (let i = keep - 1; i >= 1; i--) {
      if (existsSync(gen(i))) renameSync(gen(i), gen(i + 1))
    }
    // First save: nothing to preserve. Guarded so a fresh file never conjures
    // an empty <filePath>.1.
    if (existsSync(filePath)) renameSync(filePath, gen(1))
  } catch (rotationErr) {
    log(
      `writeFileAtomicKeepingGenerations: could not rotate generations of ${filePath} ` +
        `(the save proceeds; one recovery copy may be missing): ` +
        `${rotationErr instanceof Error ? rotationErr.message : String(rotationErr)}`,
    )
  }
}

/**
 * Atomically write ``contents`` to ``filePath``, first rotating the previous
 * ``keep`` saves aside as ``<filePath>.1`` … ``<filePath>.keep``.
 *
 * The recovery-point rule (production-readiness audit H2a): File → Save keeps
 * the previous three generations beside the file, rotated, so a mistaken save
 * can be undone by hand. The new content is written and fsynced to a temp file
 * FIRST, then the existing file is rotated to ``.1`` (best-effort — see
 * {@link rotateGenerations}), then the temp is renamed into place. Ordering the
 * durable temp write before the rotation means a crash mid-rotation leaves the
 * previous save recoverable and the new content still on its temp; the rename
 * is the single near-instant step that flips the visible file.
 *
 * @param filePath - Absolute path of the file to write (e.g. the ``.strix``).
 * @param contents - UTF-8 text, or raw bytes for the binary ``.strix`` codec.
 * @param keep - Number of previous generations to keep. Defaults to 3.
 * @param log - Sink for a rotation-failure line. Defaults to ``console.warn``,
 *   which the main process captures into ``backend.log``.
 * @throws The underlying write or rename error when the new content cannot be
 *   put into place (the temp is best-effort cleaned up first). A rotation
 *   failure alone never throws.
 */
export function writeFileAtomicKeepingGenerations(
  filePath: string,
  contents: string | Uint8Array,
  keep = 3,
  log: (message: string) => void = defaultRotationLog,
): void {
  const tmpPath = tmpPathFor(filePath)
  try {
    // Durable new content first, then rotate the old file aside, then flip.
    writeTempFileSync(tmpPath, contents)
    rotateGenerations(filePath, keep, log)
    renameSync(tmpPath, filePath)
  } catch (writeErr) {
    try {
      unlinkSync(tmpPath)
    } catch {
      /* swallow */
    }
    throw writeErr
  }
}
