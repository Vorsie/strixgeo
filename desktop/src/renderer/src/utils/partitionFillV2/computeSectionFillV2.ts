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
import { emitCurves, type TieConflict } from './emitCurves'
import { expandOverrideAliasesFromBase } from './expandOverrideAliases'
import { labelFaces } from './labelFaces'
import { mergeTouchingBodies } from './mergeTouchingBodies'
import { buildSectionInput } from './sectionGeom'
import { sliceFaces } from './slice'
import { twoSidedTerminationsEnabled } from './tileFlags'
import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from '../partitionFill'

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
): { regions: SectionRegion[]; conflicts: TieConflict[] } {
  const outcome = classifyOverrideOutcome(columns, edges, lensApexOverrides, alongM)
  return { regions: outcome.regions, conflicts: outcome.conflicts }
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
 *   - ``unsupported``    — no override was present (or the section was degenerate); ``regions``
 *                          are the plain no-override fill.
 */
export type OverrideOutcome =
  | { status: 'applied'; source: 'aliased' | 'direct'; regions: SectionRegion[]; conflicts: TieConflict[]; baseDefect: number; candidateDefect: number }
  | { status: 'rejected-unsafe'; regions: SectionRegion[]; conflicts: TieConflict[]; baseDefect: number; candidateDefect: number }
  | { status: 'unsupported'; reason: string; regions: SectionRegion[]; conflicts: TieConflict[] }

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
export function classifyOverrideOutcome(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): OverrideOutcome {
  // ONE fill pass for a given override map: normalise → emit → arrange → label → slice → merge.
  const runFill = (
    ov: ReadonlyMap<string, LensApexOverride> | undefined,
  ): { sliced: SectionRegion[]; merged: SectionRegion[]; conflicts: TieConflict[] } => {
    const section = buildSectionInput(columns, edges, ov, alongM)
    if (section.columns.length < 2) return { sliced: [], merged: [], conflicts: [] }
    const { curves, conflicts, lensLabels } = emitCurves(section)
    const arrangement = buildArrangement(curves)
    // Pass the whole ARRANGEMENT so the flag-ON seed path (labelFaces, SEED_FILL_MANDATE) can
    // measure each face's non-zero column-edge seeds from the half-edge provenance. Flag-OFF
    // ignores it and takes the original vote path (byte-identical).
    const labelled = labelFaces(arrangement.faces, section.columns, lensLabels, arrangement)
    const sliced = sliceFaces(labelled, section.columns)
    // RULING 8j "MERGE AFTER FILL" (2026-07-17): after the fill, same-litho regions that TOUCH merge
    // into one body — a body-only relabel (never moves a vertex, so holes/overlaps/conformance are
    // invariant). Gated on the hoist flag so flag-OFF stays the frozen v1-seam baseline byte-identical.
    const merged = twoSidedTerminationsEnabled() ? mergeTouchingBodies(sliced, section.columns) : sliced
    return { sliced, merged, conflicts }
  }

  // No override → the byte-identical single-pass fill, reported as ``unsupported`` (nothing to apply).
  if (!lensApexOverrides || lensApexOverrides.size === 0) {
    const { merged, conflicts } = runFill(lensApexOverrides)
    return { status: 'unsupported', reason: 'no override present', regions: merged, conflicts }
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
  const base = runFill(undefined)
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
      return { status: 'applied', source, regions: fill.merged, conflicts: fill.conflicts, baseDefect, candidateDefect }
    }
  }
  // Every override variant opened a hole vs the no-override base → the drag is not gap-safe at this
  // position; keep the base (un-reshaped) fill so the partition invariant holds. The status is
  // EXPLICIT so the caller never mistakes the fallback for a successful reshape.
  return {
    status: 'rejected-unsafe',
    regions: base.merged,
    conflicts: base.conflicts,
    baseDefect,
    candidateDefect: bestCandidateDefect,
  }
}

/** Hole-area tolerance (m²) — a variant must not exceed the no-override base hole area by more. */
const HOLE_AREA_EPS = 1e-3

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
