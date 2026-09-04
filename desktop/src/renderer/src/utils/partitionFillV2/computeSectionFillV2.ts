/**
 * partitionFillV2/computeSectionFillV2.ts — the v2 whole-section entry point.
 *
 * Same signature and output contract as v1 ``computeSectionFill`` (design §5):
 *
 *   computeSectionFillV2(columns, edges, lensApexOverrides?, alongM?) ->
 *     SectionRegion[]
 *
 * Pipeline (design §3):
 *   1. normalise input        (sectionGeom.buildSectionInput)
 *   2. emit the four curve     (emitCurves.emitCurves)
 *      families + detect
 *      crossing-tie conflicts
 *   3. build planar arrangement (arrangement.buildArrangement) -> trace faces
 *   4. label faces             (labelFaces.labelFaces)
 *   5. slice at column          (slice.sliceFaces) -> per-gap SectionRegion[]
 *      verticals
 *
 * Deep-to-deep substrate bridges are DEFERRED to increment 3 — sub-TD strips with
 * no tie anchor stay unfilled (design §4 / owner §8 Q3).
 *
 * The detected crossing-tie conflicts are exposed via
 * ``computeSectionFillV2WithConflicts`` for the (later) UI warning surface; the
 * plain ``computeSectionFillV2`` returns only the regions (drop-in for v1).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { buildArrangement } from './arrangement'
import { detectFloodedUnits } from './detectFloodedUnits'
import { emitCurves, type TieConflict } from './emitCurves'
import { expandOverrideAliasesFromBase } from './expandOverrideAliases'
import { clearForceLensUnits, parseForceLensKey, type ReviewFlag, setForceLensUnits } from './forceLensUnits'
import { computeFillIdentity, type FillIdentity } from './fillIdentity'
import { labelFaces } from './labelFaces'
import { mergeTouchingBodies } from './mergeTouchingBodies'
import { buildSectionInput, type ColumnGeom, type RawLayerContact } from './sectionGeom'
import { sliceFaces } from './slice'
import { twoSidedTerminationsEnabled } from './tileFlags'
import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from '../sectionPartition'

/**
 * Compute the v2 partition fill for a whole section.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     Litho columns (units sorted shallow->deep). Empty columns are dropped.
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (layer-id pairs, side-aware).
 * lensApexOverrides : optional per-(body, gap) apex / freedraw overrides.
 * alongM : optional real along-section metres, 1:1 with ``columns`` (load-bearing;
 *     uniform spacing diverges). When absent, columns are treated as unit-spaced.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     Per-gap regions in fraction×elevation space (design §5).
 */
export function computeSectionFillV2(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): SectionRegion[] {
  return computeSectionFillV2WithConflicts(columns, edges, lensApexOverrides, alongM).regions
}

/**
 * Same as ``computeSectionFillV2`` but also returns the detected crossing-tie
 * conflicts (owner §8 Q4). The conflicts are the pairs of approved ties that
 * geometrically cross in a gap; both were suspended for banding and their units
 * fell back to pinch/lens closing curves. The UI warning surface consumes these
 * (built later — this increment only surfaces the data).
 */
export function computeSectionFillV2WithConflicts(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): { regions: SectionRegion[]; conflicts: TieConflict[]; reviewFlags: ReviewFlag[] } {
  const outcome = classifyOverrideOutcome(columns, edges, lensApexOverrides, alongM)
  return { regions: outcome.regions, conflicts: outcome.conflicts, reviewFlags: outcome.reviewFlags }
}

/** Parse the repair pass' forced-lens keys into structured review flags (drop any malformed key). */
function toReviewFlags(keys: readonly string[]): ReviewFlag[] {
  return keys.map(parseForceLensKey).filter((f): f is ReviewFlag => f !== null)
}

/**
 * A STRUCTURED result for a free-draw override pass (owner free-draw repair, Fact C).
 *
 * The engine keeps the "never a gap or overlap" invariant BY CONSTRUCTION: an unsafe drag
 * degrades to the un-reshaped base fill. Before this repair that degradation was SILENT —
 * the handle moved while the body was unchanged and nothing recorded why. This tri-state
 * makes every override pass traceable:
 *
 *   - ``applied``        — a variant (aliased or direct) reshaped gap/overlap-safe; ``regions``
 *                          carry the reshaped fill.
 *   - ``rejected-unsafe``— every variant exceeded the no-override base defect area; ``regions``
 *                          fall back to the un-reshaped base and the defect areas are reported
 *                          so the caller can prove the rejection (never a silent success).
 *   - ``rejected-collapse``— a variant was gap/overlap-SAFE (it would have been ``applied``), but it
 *                          COLLAPSED the edited tip: the drag OVER-REACHED a column edge (raw apex
 *                          fraction outside [0,1]) AND the edited tip's own body flooded to a
 *                          full-width band (its grab handle would be destroyed). Owner-locked
 *                          2026-07-23 ("only over-reach snaps back"): this is INVALID even though a
 *                          full band is a hole-free partition. ``regions`` fall back to the base
 *                          (last-safe) fill so the overlay snaps the handle back — ALIVE, not
 *                          suppressed. A tip that VANISHES within the gap (raw still in [0,1],
 *                          neighbour litho fills its place) is a VALID reshape and stays ``applied``.
 *   - ``unsupported``    — no override was present (or the section was degenerate); ``regions``
 *                          are the plain no-override fill.
 */
export type OverrideOutcome =
  | { status: 'applied'; source: 'aliased' | 'direct'; regions: SectionRegion[]; conflicts: TieConflict[]; reviewFlags: ReviewFlag[]; baseDefect: number; candidateDefect: number; identity?: FillIdentity }
  | { status: 'rejected-unsafe'; regions: SectionRegion[]; conflicts: TieConflict[]; reviewFlags: ReviewFlag[]; baseDefect: number; candidateDefect: number; identity?: FillIdentity }
  | { status: 'rejected-collapse'; regions: SectionRegion[]; conflicts: TieConflict[]; reviewFlags: ReviewFlag[]; baseDefect: number; candidateDefect: number; identity?: FillIdentity }
  | { status: 'unsupported'; reason: string; regions: SectionRegion[]; conflicts: TieConflict[]; reviewFlags: ReviewFlag[]; identity?: FillIdentity }

// The identity view (``FillIdentity``) lives in ``fillIdentity.ts`` — re-exported here so
// consumers of the outcome type resolve it from the same module.
export { type FillIdentity } from './fillIdentity'

/**
 * Compute the v2 fill AND report a structured outcome for the override pass.
 *
 * The no-override path is BYTE-IDENTICAL to the pre-repair engine: a single ``runFill`` with
 * the (undefined/empty) override map, returned as an ``unsupported`` outcome (nothing to apply).
 * The with-override path aliases the override across the merge component, self-validates each
 * variant against the no-override base defect area, and returns ``applied`` / ``rejected-unsafe``
 * with the measured defect areas — never a silent base fallback.
 *
 * Parameters mirror ``computeSectionFillV2``.
 */
type FillPass = {
  sliced: SectionRegion[]
  merged: SectionRegion[]
  conflicts: TieConflict[]
  repaired: string[]
  /** The normalised section columns of this pass — the merge tolerances' input, kept so the
   *  identity merge (``FillIdentity``) runs with the SAME per-gap snap tolerance the display
   *  merge used rather than the columns-unknown fallback. */
  sectionColumns: readonly ColumnGeom[]
  /** The pass's RAW picked-unit contacts (pre-enclosed-lens-merge), feeding the identity
   *  path's geometric column-edge attribution (``fillIdentity.ts``) — the normalised stack
   *  cannot answer "what was drilled here" once the merge spliced a unit out. */
  rawLayerContacts?: ReadonlyMap<string, RawLayerContact>
}

/**
 * One-entry memo of the NO-OVERRIDE base pass.
 *
 * The ghost-handle probe calls ``classifyOverrideOutcome`` once per grab handle — 70
 * times on the owner's CS1 — each with a different single override but the SAME
 * columns, edges and alongM. Every one of those calls recomputed the identical base
 * pass, exactly doubling the probe's cost (70 x 18 ms = 1.26 s on CS1, 34 x 47.5 ms =
 * 1.62 s on CS2).
 *
 * Keyed on the IDENTITY of the inputs plus the engine flag, because the probe calls
 * back-to-back with the very same references so identity hits every time, and a caller
 * that rebuilds its arrays simply misses and recomputes — slow, never wrong. The cached
 * value is handed out by reference; it is already used twice within a single call
 * today, so any consumer that mutated it would be a bug already.
 */
let baseFillCache: {
  columns: readonly PartitionColumn[]
  edges: readonly CorrelationEdge[]
  alongM: readonly number[] | undefined
  flag: boolean
  value: FillPass
} | null = null

/**
 * The no-override base pass for these inputs, computed once per (inputs, flag).
 *
 * Parameters
 * ----------
 * columns, edges, alongM : the section inputs, compared by identity.
 * runFill : the caller's own fill closure, invoked only on a miss.
 */
function cachedBaseFill(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[] | undefined,
  runFill: (ov: ReadonlyMap<string, LensApexOverride> | undefined) => FillPass,
): FillPass {
  const flag = twoSidedTerminationsEnabled()
  const hit =
    baseFillCache !== null &&
    baseFillCache.columns === columns &&
    baseFillCache.edges === edges &&
    baseFillCache.alongM === alongM &&
    baseFillCache.flag === flag
  if (hit && baseFillCache !== null) return baseFillCache.value
  const value = runFill(undefined)
  baseFillCache = { columns, edges, alongM, flag, value }
  return value
}

export function classifyOverrideOutcome(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
  opts?: {
    /** Also compute the ``FillIdentity`` (excludeFallback merge + groups) of the returned pass.
     *  Off by default — the render path must not pay an extra merge per frame. */
    withIdentity?: boolean
  },
): OverrideOutcome {
  // ONE fill pass for a given override map: normalise → emit → arrange → label → slice → merge.
  // With the hoist flag ON, a SAFE-DEFAULT REPAIR loop follows (owner 2026-07-26, RE-RULED 2026-09-04
  // "zero ties = lens"): the first pass may leave a drilled unit flooded by a foreign litho (TS7-g0
  // clay → silt). ``detectFloodedUnits`` finds them; the fill re-runs with those units FORCED TO A LENS
  // (``forceLensUnits`` — effective corr demoted to 0 so the sweep draws each one's own-elevation
  // pinch-out, never a forced onlap). Clean cases flood nothing → byte-identical to the pre-repair engine.
  const runFill = (
    ov: ReadonlyMap<string, LensApexOverride> | undefined,
  ): FillPass => {
    const section = buildSectionInput(columns, edges, ov, alongM)
    if (section.columns.length < 2)
      return {
        sliced: [],
        merged: [],
        conflicts: [],
        repaired: [],
        sectionColumns: section.columns,
        rawLayerContacts: section.rawLayerContacts,
      }
    const onePass = (): { sliced: SectionRegion[]; merged: SectionRegion[]; conflicts: TieConflict[]; sectionColumns: readonly ColumnGeom[] } => {
      const { curves, conflicts, lensLabels, bracketStrips } = emitCurves(section)
      const arrangement = buildArrangement(curves)
      // Pass the whole ARRANGEMENT so the flag-ON seed path (labelFaces, SEED_FILL_MANDATE) can
      // measure each face's non-zero column-edge seeds from the half-edge provenance. Flag-OFF
      // ignores it and takes the original vote path (byte-identical).
      const labelled = labelFaces(arrangement.faces, section.columns, lensLabels, arrangement, bracketStrips)
      const sliced = sliceFaces(labelled, section.columns)
      // RULING 8j "MERGE AFTER FILL" (2026-07-17): after the fill, same-litho regions that TOUCH merge
      // into one body — a body-only relabel (never moves a vertex, so holes/overlaps/conformance are
      // invariant). Gated on the hoist flag so flag-OFF stays the frozen v1-seam baseline byte-identical.
      const merged = twoSidedTerminationsEnabled() ? mergeTouchingBodies(sliced, section.columns) : sliced
      return { sliced, merged, conflicts, sectionColumns: section.columns }
    }
    let result = onePass()
    // Flag-OFF (frozen v1 seam) never enters the repair — it has no HOIST onlap to force.
    if (!twoSidedTerminationsEnabled())
      return { ...result, repaired: [], rawLayerContacts: section.rawLayerContacts }
    // Accumulate the forced-onlap set across up to REPAIR_ITERS re-runs: each pass may reveal a
    // fresh flooded unit; stop as soon as a pass adds nothing new (fixed point) or the cap is hit.
    const forced = new Set<string>()
    for (let iter = 0; iter < REPAIR_ITERS; iter++) {
      const flooded = detectFloodedUnits(result.sliced, section.columns)
      let added = false
      for (const k of flooded) if (!forced.has(k)) { forced.add(k); added = true }
      if (!added) break
      setForceLensUnits(forced)
      try {
        result = onePass()
      } finally {
        clearForceLensUnits()
      }
    }
    // ``repaired`` (the forced-lens keys) is kept on the result as REVIEW-FLAG DATA — the drilled
    // units the repair rescued to a lens. The engine fixed the data loss; the litho overlay no longer
    // draws a marker for these (owner 2026-09-04), but the data survives for any other consumer.
    return { ...result, repaired: [...forced], rawLayerContacts: section.rawLayerContacts }
  }

  // The identity view of the pass a return hands out (see ``fillIdentity.ts``). Computed only
  // on request, and only at the ONE return that wins — never per repair iteration.
  const identityOf = (pass: FillPass): FillIdentity | undefined =>
    opts?.withIdentity === true
      ? computeFillIdentity(pass.sliced, pass.sectionColumns, pass.rawLayerContacts)
      : undefined

  // No override → the byte-identical single-pass fill, reported as ``unsupported`` (nothing to apply).
  if (!lensApexOverrides || lensApexOverrides.size === 0) {
    const pass = runFill(lensApexOverrides)
    const { merged, conflicts, repaired } = pass
    return { status: 'unsupported', reason: 'no override present', regions: merged, conflicts, reviewFlags: toReviewFlags(repaired), identity: identityOf(pass) }
  }

  // FREE-DRAW OVERRIDE ALIASING (owner 2026-07-22, THIRD engine grant "make every handle reshape").
  // The app keys an override on the RENDERED (post-``mergeTouchingBodies``) bodyId; the engine emits
  // per RAW unit and consumes the raw bodyId. In a single-lithology section the merge unions many raw
  // bodies under one representative id, so the app's key never matches the emitting raw body → the
  // handle is DEAD (S67 wall, measured on real CS1). We resolve it with a no-override BASE PASS that
  // reveals the exact render→raw equivalence (the merge only relabels, so the base pass's raw↔merged
  // polygon match is authoritative), then ALIAS each incoming override to every raw body in its
  // component so the emitting unit finds it.
  //
  // A live drag: alias the override across the merge component, then SELF-VALIDATE against the
  // no-override BASE. The aliasing makes many more handles reshape (S67 wall), and the direct
  // override drives the additive consumers; but routing an override to a body whose emit path does
  // not re-close cleanly under an AGGRESSIVE reach can open a hole/overlap. So we compute the
  // no-override BASE defect area and pick the FIRST variant — aliased (most handles live), else
  // direct — whose defect area does NOT exceed the base. "Never a gap or overlap" stays a HARD
  // invariant BY CONSTRUCTION; an unsafe drag degrades to the un-reshaped base fill — but now the
  // degradation is EXPLICIT (``rejected-unsafe`` with the measured defect areas), never silent.
  const base = cachedBaseFill(columns, edges, alongM, runFill)
  const baseDefect = sectionDefectArea(base.merged)
  const aliased = expandOverrideAliasesFromBase(lensApexOverrides, () => ({ sliced: base.sliced, merged: base.merged }))
  // Track the BEST (smallest) candidate defect so a rejection reports the closest attempt —
  // still > base + EPS, which is exactly why it was rejected.
  let bestCandidateDefect = Infinity
  for (const [ov, source] of [
    [aliased, 'aliased'],
    [lensApexOverrides, 'direct'],
  ] as const) {
    const fill = runFill(ov)
    const candidateDefect = sectionDefectArea(fill.merged)
    if (candidateDefect < bestCandidateDefect) bestCandidateDefect = candidateDefect
    if (candidateDefect <= baseDefect + HOLE_AREA_EPS) {
      // COLLAPSE → INVALID (owner-locked 2026-07-23, "only over-reach snaps back"). This variant is
      // gap/overlap-SAFE (a full-width band is a hole-free partition), so the defect guard above would
      // pass it as ``applied``. But if the drag OVER-REACHED a column edge (raw apex fraction outside
      // [0,1]) AND that reach flooded the edited tip's OWN body to a full-width band, the tip destroyed
      // its own grab handle — INVALID. Snap back to the base (last-safe) fill, handle ALIVE. BOTH
      // conditions are required: a moderate in-gap reshape (raw in [0,1]) never trips this even if the
      // tip vanishes (a VALID neighbour-fill reshape), and a full-width flood with no over-reach is a
      // legitimate band. The region OUTPUT the reshapeMap / allSectionsReshape gates read comes from
      // ``computeSectionFillV2`` (not this classifier), so those stay byte-identical — only the STATUS
      // returned here changes, and on collapse we return the BASE regions (the snapback shape).
      if (ov && isCollapseOverReach(fill.merged, ov)) {
        return { status: 'rejected-collapse', regions: base.merged, conflicts: base.conflicts, reviewFlags: toReviewFlags(base.repaired), baseDefect, candidateDefect, identity: identityOf(base) }
      }
      return { status: 'applied', source, regions: fill.merged, conflicts: fill.conflicts, reviewFlags: toReviewFlags(fill.repaired), baseDefect, candidateDefect, identity: identityOf(fill) }
    }
  }
  // Every override variant opened a hole vs the no-override base → the drag is not gap-safe at this
  // position; keep the base (un-reshaped) fill so the partition invariant holds. The status is
  // EXPLICIT so the caller never mistakes the fallback for a successful reshape.
  return {
    status: 'rejected-unsafe',
    regions: base.merged,
    conflicts: base.conflicts,
    reviewFlags: toReviewFlags(base.repaired),
    baseDefect,
    candidateDefect: bestCandidateDefect,
    identity: identityOf(base),
  }
}

/** Max safe-default repair re-runs before accepting the best-so-far fill (bounded fixed-point). */
const REPAIR_ITERS = 3

/** Hole-area tolerance (m²) — a variant must not exceed the no-override base hole area by more. */
const HOLE_AREA_EPS = 1e-3

/**
 * Fraction epsilon for the tip-vs-band shapeability test. Mirrors
 * ``partitionFillOverlayHelpers.isApexShapeable``'s ``TIP_FRACTION_EPS`` (kept in
 * sync — a vertex within this of a column edge counts as touching that column).
 * Duplicated here (not imported) because the classifier lives in the ``utils``
 * layer and MUST NOT import from the ``components`` layer (one-way dependency).
 */
const COLLAPSE_TIP_FRACTION_EPS = 0.02

/**
 * Is a region an APEX-SHAPEABLE termination (an interior tip the grab handle can reshape),
 * as opposed to a full-width band that spans column-to-column with no free tip?
 *
 * A ``lens`` is always shapeable. A ``pinch`` / ``quad`` is shapeable iff it has a vertex
 * strictly inside the gap AND does not already span the full [0,1] width. This is the
 * ``utils``-layer copy of ``partitionFillOverlayHelpers.isApexShapeable`` (see
 * ``COLLAPSE_TIP_FRACTION_EPS`` for why it is duplicated, not imported).
 */
function isApexShapeableRegion(region: SectionRegion): boolean {
  if (region.kind === 'lens') return true
  let fMin = Infinity
  let fMax = -Infinity
  let hasInteriorVertex = false
  for (const p of region.polygon) {
    if (p.fraction < fMin) fMin = p.fraction
    if (p.fraction > fMax) fMax = p.fraction
    if (p.fraction > COLLAPSE_TIP_FRACTION_EPS && p.fraction < 1 - COLLAPSE_TIP_FRACTION_EPS) hasInteriorVertex = true
  }
  const spansFullWidth = fMin <= COLLAPSE_TIP_FRACTION_EPS && fMax >= 1 - COLLAPSE_TIP_FRACTION_EPS
  return hasInteriorVertex && !spansFullWidth
}

/**
 * The "collapse → invalid" discriminator (owner-locked 2026-07-23, "only over-reach snaps back").
 *
 * Returns ``true`` iff SOME override in the pass is a collapse: the drag OVER-REACHED a column edge
 * (its ``rawApexFraction`` is outside [0,1] — dragged past the far column or before the anchor) AND
 * the edited tip's OWN body flooded to a full-width band in the candidate fill (every region carrying
 * that body in that gap is non-shapeable, and at least one such region exists). BOTH conditions are
 * required, which is exactly why a pure ``!isApexShapeable`` test alone (S95) over-rejected the valid
 * cases:
 *
 *   - A tip that VANISHES within the gap (raw fraction still in [0,1], a neighbour litho fills its
 *     apex — CS1 ``029c52@4/@5`` 0.50→0.35/0.65) has NO over-reach → NOT a collapse → stays ``applied``.
 *   - A tip that floods to a band WITHOUT over-reaching (raw in [0,1]) is a legitimate band → NOT a
 *     collapse.
 *   - Only the aggressive reach that BOTH over-reaches a column AND floods the own body (CS1
 *     ``6bb744`` gap-7 aggressive, raw ≈ 1.6) is ``rejected-collapse``.
 *
 * ``rawApexFraction`` is ABSENT on the non-drag / persisted-render path, so that path never trips this
 * (no live cursor → no over-reach to test) — additive and backward-compatible.
 *
 * Parameters
 * ----------
 * candidate : readonly SectionRegion[]
 *     The gap/overlap-safe candidate fill this override pass produced (its regions carry bodyId + gap).
 * overrides : ReadonlyMap<string, LensApexOverride>
 *     The override map that produced ``candidate`` (aliased or direct). Each entry may carry a raw
 *     apex reach; only the over-reaching ones are collapse candidates.
 *
 * Returns
 * -------
 * bool
 *     ``true`` when at least one over-reaching override flooded its own body to a full-width band.
 */
function isCollapseOverReach(
  candidate: readonly SectionRegion[],
  overrides: ReadonlyMap<string, LensApexOverride>,
): boolean {
  for (const [key, ov] of overrides) {
    // Condition 1 — OVER-REACH: the raw (pre-clamp) apex reach is past a column edge.
    const raw = ov.rawApexFraction
    if (raw == null || (raw >= 0 && raw <= 1)) continue
    // The override key is ``<bodyId>@<gapIndex>`` (split on the LAST '@' so an '@' inside a bodyId
    // is still recovered). Only the edited body's OWN region in ITS gap is inspected.
    const at = key.lastIndexOf('@')
    if (at < 0) continue
    const bodyId = key.slice(0, at)
    const gapIndex = Number(key.slice(at + 1))
    if (!Number.isFinite(gapIndex)) continue
    // Condition 2 — FULL-WIDTH FLOOD: the edited body's own region(s) in this gap all became
    // non-shapeable bands. A VANISHED tip (no own region) is NOT a flood — it is a valid reshape.
    const own = candidate.filter((r) => r.bodyId === bodyId && r.gapIndex === gapIndex)
    if (own.length > 0 && own.every((r) => !isApexShapeableRegion(r))) return true
  }
  return false
}

/** Even-odd covered elevation intervals of one polygon at fraction ``f``. */
function coveredIntervalsAt(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction)
    const hi = Math.max(a.fraction, b.fraction)
    if (f < lo - 1e-9 || f >= hi - 1e-9) continue
    const t = (f - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

/**
 * A monotone DEFECT-area proxy (m²) of a per-gap region set: interior coverage HOLES plus
 * different-formation OVERLAPS, summed over a fraction-space scan. The override self-validation guard
 * only needs "is this variant's defect area worse than the no-override base", not an exact area — so a
 * coarse 0.05-fraction scan is sufficient and cheap.
 */
function sectionDefectArea(regions: readonly SectionRegion[]): number {
  const byGap = new Map<number, SectionRegion[]>()
  for (const r of regions) (byGap.get(r.gapIndex) ?? byGap.set(r.gapIndex, []).get(r.gapIndex)!).push(r)
  let total = 0
  for (const regs of byGap.values()) {
    for (let f = 0.05; f < 0.96; f += 0.05) {
      const ivs: [number, number][] = []
      for (const r of regs) ivs.push(...coveredIntervalsAt(r.polygon, f))
      ivs.sort((a, b) => a[0] - b[0])
      const merged: [number, number][] = []
      for (const iv of ivs) {
        const last = merged[merged.length - 1]
        if (last && iv[0] <= last[1] + 5e-4) last[1] = Math.max(last[1], iv[1])
        else merged.push([...iv])
      }
      for (let k = 0; k + 1 < merged.length; k++) {
        const hole = merged[k + 1][0] - merged[k][1]
        if (hole > 5e-4 && hole < 5) total += hole * 0.05
      }
      // Different-formation overlaps (a torn partition, not a lens-over-matrix which shares formation).
      for (let a = 0; a < regs.length; a++)
        for (let b = a + 1; b < regs.length; b++) {
          if (regs[a].formationId === regs[b].formationId) continue
          for (const [a1, a2] of coveredIntervalsAt(regs[a].polygon, f))
            for (const [b1, b2] of coveredIntervalsAt(regs[b].polygon, f)) {
              const v = Math.min(a2, b2) - Math.max(a1, b1)
              if (v > 1e-3) total += v * 0.05
            }
        }
    }
  }
  return total
}
