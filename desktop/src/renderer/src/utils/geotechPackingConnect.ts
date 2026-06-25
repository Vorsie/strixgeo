/**
 * Pure guard for the manual "Correlate packing" gesture (spec §5 / §8).
 *
 * Evaluates whether two geotech sub-bands may be connected by a packing
 * correlation edge. The check is stateless and side-effect-free so it can
 * be called in a useCallback without touching DOM or state.
 *
 * Rules (precedence top-to-bottom):
 *   1. Either band has a null NAD class → null-class (unclassifiable anchor,
 *      e.g. a borehole carry-through).
 *   2. The caller passed the same band as both A and B → same-band (no self-loop).
 *      Note: the gesture handler (handleCreateGeotechPackingCorrelation) already
 *      short-circuits on ``contactAId === contactBId`` before calling this helper,
 *      so this rule is a defensive backstop — the helper still tests it so direct
 *      callers (e.g. unit tests) are covered.
 *   3. The bands belong to different parent litho bodies (or either is null)
 *      → different-litho-body (only connect within one continuous litho unit).
 *   4. The NAD classes differ → different-class (only same-class bands connect).
 *   5. All checks pass → ok.
 *
 * The "different-litho-body before different-class" ordering is intentional:
 * a cross-body same-class match (e.g. two dense-sand bodies on either side of
 * a clay lens) is geotechnically plausible but structurally wrong — the litho
 * body boundary is the hard constraint; class agreement alone is not enough.
 */

/** Minimal descriptor for a geotech packing sub-band. */
export interface PackingBandDescriptor {
  /** NAD packing class (1–31), or ``null`` for borehole carry-through. */
  nadClass: number | null
  /**
   * Parent litho body id (``body_id`` on the litho layer whose depth range
   * contains this sub-band's midpoint). ``null`` when the sub-band's parent
   * litho layer is not yet resolved to a body (resolver has not run yet).
   */
  lithoBodyId: string | null
}

/** Result of a packing-connect guard evaluation. */
export interface PackingConnectVerdict {
  /** True iff the connection is permitted. */
  ok: boolean
  /**
   * Machine-readable reason code.
   *
   * - ``'ok'``: connection is permitted.
   * - ``'null-class'``: at least one band has no NAD class (unclassifiable).
   * - ``'same-band'``: both descriptors point to the same physical band
   *   (bandId match or identical descriptor reference — would create a self-loop).
   * - ``'different-litho-body'``: the bands belong to different litho bodies
   *   (or at least one body id is null), so the connection crosses a structural
   *   boundary.
   * - ``'different-class'``: NAD packing classes differ — no same-class match.
   */
  reason: 'ok' | 'null-class' | 'same-band' | 'different-litho-body' | 'different-class'
}

/**
 * Evaluate whether two packing sub-bands may be connected.
 *
 * Parameters
 * ----------
 * a
 *     Descriptor for the first (armed-source) band.
 * b
 *     Descriptor for the second (target) band.
 *
 * Returns
 * -------
 * PackingConnectVerdict
 *     Verdict with ``ok`` flag and ``reason`` code.
 */
export function canConnectPacking(
  a: PackingBandDescriptor,
  b: PackingBandDescriptor,
): PackingConnectVerdict {
  // Rule 1: unclassifiable band (no NAD class) — reject before anything else.
  if (a.nadClass === null || b.nadClass === null) {
    return { ok: false, reason: 'null-class' }
  }

  // Rule 2: self-loop guard — same object reference or identical descriptor.
  // The gesture handler already short-circuits on contactAId === contactBId
  // before reaching this helper, so this is a defensive backstop (still tested
  // here so direct callers are covered); it also catches the edge case where
  // the same layer id appears on both sides.
  if (a === b) {
    return { ok: false, reason: 'same-band' }
  }

  // Rule 3: litho body boundary is a hard structural constraint — only connect
  // within a single continuous litho body. A null body id means the resolver
  // has not assigned one yet; treat as unconnectable.
  if (a.lithoBodyId === null || b.lithoBodyId === null || a.lithoBodyId !== b.lithoBodyId) {
    return { ok: false, reason: 'different-litho-body' }
  }

  // Rule 4: NAD packing class must match across the correlation.
  if (a.nadClass !== b.nadClass) {
    return { ok: false, reason: 'different-class' }
  }

  return { ok: true, reason: 'ok' }
}
