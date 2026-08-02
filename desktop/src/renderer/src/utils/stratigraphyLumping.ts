// Reading the lumping map back out of its database home.
//
// The lumping map lives in three columns on ``project``
// (docs/design/autosave-recovery.md §3): ``stratigraphy_lumping_staged``,
// ``stratigraphy_lumping_saved`` and a monotonic
// ``stratigraphy_lumping_revision``. The server's READ path is deliberately
// PASS-THROUGH — it never validates those JSONB blobs, because a single
// project with a malformed blob would otherwise 500 the whole project list
// and take down the start screen. Validation therefore lands here, on the
// renderer's read.
//
// Everything in this module is pure: no API calls, no React, no logging.
// The caller decides what to log and what to do with a rejection.

import type { StratigraphyLumping } from './projectFile'

/** Outcome of narrowing one opaque JSONB blob into a lumping snapshot. */
export type LumpingParseResult =
  | { ok: true; lumping: StratigraphyLumping | null }
  | { ok: false; reason: string }

/**
 * Narrow an opaque JSONB value into a ``StratigraphyLumping``.
 *
 * ``null`` / ``undefined`` are a legitimate value, not a failure: they mean
 * "this project has no lumping map", which is distinct from a snapshot whose
 * ``map`` is empty (the user ran Fill and grouped nothing).
 *
 * @param value - The raw column value straight off ``ProjectResponse``.
 * @returns ``{ ok: true }`` with the narrowed snapshot (or ``null``), or
 *   ``{ ok: false }`` with a human-readable reason the caller can log.
 */
export function parseStratigraphyLumping(value: unknown): LumpingParseResult {
  if (value === null || value === undefined) return { ok: true, lumping: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'not a JSON object' }
  }
  const raw = value as Record<string, unknown>
  if (raw.schema_version !== 1) {
    return { ok: false, reason: `unsupported schema_version ${String(raw.schema_version)}` }
  }
  if (typeof raw.applied_at !== 'string') {
    return { ok: false, reason: 'applied_at is not a string' }
  }
  const map = raw.map
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    return { ok: false, reason: 'map is not a JSON object' }
  }
  for (const [key, target] of Object.entries(map)) {
    if (typeof target !== 'string') {
      return { ok: false, reason: `map entry "${key}" is not a string` }
    }
  }
  return {
    ok: true,
    lumping: {
      schema_version: 1,
      applied_at: raw.applied_at,
      map: map as Record<string, string>,
    },
  }
}

/**
 * Structural equality for two lumping snapshots.
 *
 * Two nulls are equal; a null vs a non-null are not. When both are
 * non-null the maps are compared key-by-key, not by reference — every
 * Apply produces a fresh object.
 *
 * ``schema_version`` and ``applied_at`` are deliberately excluded:
 * ``applied_at`` changes on every Apply even when the alias map does not,
 * and ``schema_version`` is structural metadata. The engineering decision
 * IS the map contents — an identical map means the user made no new
 * decision, so the project must not go dirty.
 *
 * Lives here rather than in ``useProject`` because it is the shared
 * definition of "the lumping map is dirty": the dirty flag, the recovery
 * scheduler's at-risk predicate, and any future reconciliation must all
 * agree on it.
 *
 * @param a - First snapshot, or ``null``.
 * @param b - Second snapshot, or ``null``.
 * @returns ``true`` when the two snapshots carry the same map.
 */
export function lumpingsEqual(
  a: StratigraphyLumping | null,
  b: StratigraphyLumping | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  const keysA = Object.keys(a.map)
  const keysB = Object.keys(b.map)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (a.map[k] !== b.map[k]) return false
  }
  return true
}

/** The three lumping columns as they arrive on a project read. */
export interface LumpingColumns {
  stratigraphy_lumping_staged?: Record<string, unknown> | null
  stratigraphy_lumping_saved?: Record<string, unknown> | null
  stratigraphy_lumping_revision?: number | null
}

/** What the two in-memory lumping slots should hold right after an open. */
export interface ResolvedOpenLumping {
  /** Seeds ``currentLumping`` — the staged (possibly unsaved) map. */
  current: StratigraphyLumping | null
  /** Seeds ``savedLumping`` — what the last File → Save committed. */
  saved: StratigraphyLumping | null
  /** Seeds the revision counter the next stage increments from. */
  revision: number | null
  /** Which copy won, for the log line. */
  source: 'database' | 'file'
  /** Non-null when the DB copy was rejected; the caller logs it at warn. */
  warning: string | null
}

/**
 * Decide what the two lumping slots hold when a project is opened.
 *
 * WHY the database wins whenever it carries a revision: the staged slot is
 * written the instant the user hits Apply, so it survives a crash that the
 * ``.gmproj`` on disk — only rewritten on File → Save — cannot. Re-seeding
 * ``current`` from the staged slot and ``saved`` from the saved slot means a
 * project that crashed mid-edit reopens DIRTY, still carrying the map the
 * user applied. That re-seeded dirty state IS the crash-safety feature.
 *
 * A ``null`` revision means no revision-aware client has ever staged this
 * project (legacy project, or one that never ran Fill), so the file stays
 * authoritative and both slots seed from it — today's behaviour, unchanged.
 *
 * @param columns - The lumping columns off the freshly-read project.
 * @param fileLumping - The snapshot embedded in the ``.gmproj`` just parsed.
 * @returns The values for ``currentLumping`` / ``savedLumping`` / the
 *   revision counter, plus a warning when the DB copy had to be rejected.
 */
export function resolveOpenLumping(
  columns: LumpingColumns,
  fileLumping: StratigraphyLumping | null,
): ResolvedOpenLumping {
  const revision = columns.stratigraphy_lumping_revision ?? null
  if (revision === null) {
    return { current: fileLumping, saved: fileLumping, revision: null, source: 'file', warning: null }
  }

  const staged = parseStratigraphyLumping(columns.stratigraphy_lumping_staged)
  const savedSlot = parseStratigraphyLumping(columns.stratigraphy_lumping_saved)
  // Fall back to the file when either blob is unusable, but KEEP the stored
  // revision: the counter is a plain integer and is independently valid even
  // when the blob beside it is not. Dropping it would let the next Apply
  // stage a revision the server already stores, and the monotonic guard
  // would 409 it away.
  const fallback = (warning: string): ResolvedOpenLumping => ({
    current: fileLumping,
    saved: fileLumping,
    revision,
    source: 'file',
    warning,
  })
  if (!staged.ok) return fallback(`staged ${staged.reason}`)
  if (!savedSlot.ok) return fallback(`saved ${savedSlot.reason}`)

  return {
    current: staged.lumping,
    saved: savedSlot.lumping,
    revision,
    source: 'database',
    warning: null,
  }
}

/**
 * The revision the next stage should claim.
 *
 * Monotonic and never reused: the server rejects anything lower than what it
 * already stores, so a first stage on a never-staged project starts at 1.
 *
 * @param current - The revision this session last staged, or ``null``.
 * @returns ``current + 1``, or ``1`` when nothing has been staged yet.
 */
export function nextLumpingRevision(current: number | null): number {
  return (current ?? 0) + 1
}

// The server's stale-stage 409 reads
// ``Stale lumping stage: revision 3 < stored 9``. That sentence is the only
// place the stored counter is exposed on a rejection.
const STALE_STAGE_PATTERN = /<\s*stored\s+(\d+)/

/**
 * Recover the server's stored revision out of a stale-stage 409 message.
 *
 * WHY parse the message: a 409 means this session's counter has fallen
 * behind the server's, and every subsequent stage would collide the same
 * way until it catches up. The API's error channel carries only a ``detail``
 * string, so the alternatives are this match or an extra project GET per
 * rejection. A failed match simply leaves the counter alone — the stage is
 * already in memory, and the recovery file still carries it.
 *
 * @param message - The ``Error.message`` thrown by the API client.
 * @returns The stored revision, or ``null`` when the message is not a
 *   recognisable stale-stage rejection.
 */
export function storedRevisionFromStaleError(message: string): number | null {
  const match = message.match(STALE_STAGE_PATTERN)
  if (match === null) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}
