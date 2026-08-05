/**
 * Shared atomic file-write helper for the Electron main process.
 *
 * Extracted from ``index.ts`` when the recovery-file store became a second
 * caller — one copy, one set of tests. The module deliberately imports only
 * Node built-ins (no ``electron``) so it stays unit-testable in vitest
 * alongside the other pure main-process helpers.
 */

import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'fs'

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
  const tmpPath = `${filePath}.tmp.${process.pid}`
  try {
    // The write is INSIDE the try alongside the rename: a disk-full or
    // permission failure mid-write leaves a partial temp behind just as surely
    // as a failed rename does, and the recovery directory is enumerated at
    // every launch — orphans there accumulate one per failed autosave.
    //
    // The encoding argument is passed ONLY for text. Node ignores it for a
    // TypedArray today, but naming an encoding for bytes invites a future
    // reader (or a future Node) to treat the payload as text — and a DXF that
    // survives a UTF-8 round-trip is not a property we want to rely on.
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
    const fd = openSync(tmpPath, 'w')
    try {
      if (typeof contents === 'string') writeFileSync(fd, contents, 'utf-8')
      else writeFileSync(fd, contents)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
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
