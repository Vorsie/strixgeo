// The lumping map is the only DOUBLE-WRITTEN at-risk item, so it is the only
// one that needs reconciling when a recovery file is restored.
//
// Items 2–6 of docs/design/autosave-recovery.md §2 have no database home —
// the recovery file is their only copy, so restoring them is a straight
// assignment. Item 1 (the stratigraphy lumping map) lives in
// ``project.stratigraphy_lumping_staged`` AND in the recovery file, which
// means two writers and therefore one rule.
//
// That rule is REVISION, never the clock (§3). Wall-clock comparison was
// rejected on three counts: ``project.updated_at`` moves for unrelated
// reasons so it cannot date the map; the recovery file legitimately lags by
// up to 15 s so "older" does not mean "stale"; and a clock shift (DST, NTP,
// a resumed VM) would silently invert the comparison.
//
// Pure: no React, no API, no logging. The caller decides what to log and
// which side effect to fire.

import type { StratigraphyLumping } from './projectFile'
import { lumpingsEqual } from './stratigraphyLumping'

/** One copy of the lumping map plus the counter that dates it. */
export interface LumpingSide {
  /** The map itself; ``null`` means "this project has no lumping map". */
  lumping: StratigraphyLumping | null
  /**
   * Monotonic stage counter. ``null`` means no revision-aware client has
   * ever staged this project — which must lose to any real revision, and
   * must tie with another ``null``.
   */
  revision: number | null
}

/** What the restore should do about the lumping map. */
export type LumpingReconciliation =
  /** The two copies agree. The design's common case: do nothing at all. */
  | { action: 'skip'; reason: string }
  /** The staged PUT never landed. Replay the file's map at its own revision. */
  | {
      action: 'replay-file'
      /** The revision to stage under — the file's, not a fresh bump. */
      revision: number
      lumping: StratigraphyLumping | null
      reason: string
    }
  /** The database is authoritative. Leave everything alone. */
  | {
      action: 'prefer-database'
      reason: string
      /**
       * ``true`` for the "equal revision, different content" row — a BUG,
       * not a conflict. The caller logs that one at error level; an ordinary
       * "the DB is simply newer" outcome is unremarkable.
       */
      conflict: boolean
    }

/**
 * Order two revisions where ``null`` means "never staged".
 *
 * ``-Infinity`` rather than ``-1`` or ``0``: a never-staged side has to lose
 * to every real revision including a hypothetical ``0``, and two nulls have
 * to compare equal so the tie falls through to the content check instead of
 * reaching for a clock.
 */
function rank(revision: number | null): number {
  return revision ?? Number.NEGATIVE_INFINITY
}

/**
 * Decide what a restore does with the recovery file's lumping map.
 *
 * @param file - The copy carried in the recovery snapshot.
 * @param active - The copy the app is holding after the open resolved the
 *   database's staged slot against the ``.gmproj`` (see
 *   ``resolveOpenLumping``) — i.e. what the rest of the app currently reads.
 * @returns The action to take, with a human-readable reason for the log.
 */
export function reconcileLumping(
  file: LumpingSide,
  active: LumpingSide,
): LumpingReconciliation {
  const fileRank = rank(file.revision)
  const activeRank = rank(active.revision)

  if (fileRank > activeRank) {
    return {
      action: 'replay-file',
      // Non-null by construction: it out-ranks -Infinity, so it is a number.
      revision: file.revision as number,
      lumping: file.lumping,
      reason: `file revision ${String(file.revision)} > stored ${String(active.revision)}`,
    }
  }

  if (fileRank < activeRank) {
    return {
      action: 'prefer-database',
      reason: `stored revision ${String(active.revision)} > file ${String(file.revision)}`,
      conflict: false,
    }
  }

  if (lumpingsEqual(file.lumping, active.lumping)) {
    return { action: 'skip', reason: `revision ${String(file.revision)} matches on both sides` }
  }

  return {
    action: 'prefer-database',
    reason: `equal revision ${String(file.revision)} but different content`,
    conflict: true,
  }
}
