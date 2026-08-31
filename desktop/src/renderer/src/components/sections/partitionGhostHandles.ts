/**
 * Ghost-contact handle detection for ``PartitionFillOverlay`` (SESSION 77).
 *
 * The owner ruling (2026-07-22): "hide them, if they were merged into one body
 * and deleted afterwards then they are GHOST CONTACTS, modelling artefacts with
 * no real meaning." The residual DEAD apex handles measured across all 14 real
 * sections (S76: CONSUMED 143 / DEAD 24) are interior convergence tips of a
 * CONTINUOUS same-litho band — ghost contacts from a merge-then-delete. Every
 * handle the tool renders MUST reshape; a tip whose override the engine does not
 * consume (byte-static footprint) gets NO grab affordance.
 *
 * ── WHY §77's ``unroutableBodies`` did not catch these ──────────────────────
 * ``unroutableBodies`` iterates ``apexOverrides.keys()`` — bodies with a STORED
 * node at rest. A fresh first-grab has no stored node → the detection never runs
 * → all handles render, the dead ones among them. The CORRECT detection is a
 * PER-TOPOLOGY PROBE: for EVERY apex-shapeable region (the exact set the overlay
 * renders a handle for), feed a small test override the way ``setShape`` does and
 * re-partition; if the region's footprint does not move, the tip is a ghost.
 *
 * This mirrors the S76 ``allSectionsReshape`` gate's measurement logic (feed a
 * single-body ``LensApexOverride``, compare the body's rendered polygon signature
 * before vs after) but returns the DEAD set for the app to suppress, rather than
 * only tallying it. It is engine-agnostic: the compute function is injected
 * (``computeSectionFillV2`` in tests, ``computeSectionFillActive`` in the overlay),
 * so it never routes through the v1 path (the caller gates on v2).
 *
 * No React, no I/O — a pure function over the partition + a compute callback.
 */
import {
  type CorrelationEdge,
  type LensApexOverride,
  lensApexOverrideKey,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { isApexShapeable } from './partitionFillOverlayHelpers'

/** Compute-partition signature — either engine (the active selector or raw v2). */
export type ComputePartition = (
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  lensApexOverrides: ReadonlyMap<string, LensApexOverride> | undefined,
  alongM: readonly number[] | undefined,
) => SectionRegion[]

/**
 * Signature of a body's rendered footprint in a gap (vertex-order-independent).
 *
 * Two computes produce the SAME string iff the body's polygon(s) for that
 * (body, gap) are geometrically identical — the byte-static test for "the
 * override moved nothing" (a ghost tip). Fraction/elevation are rounded to 1e-4
 * so a legality re-clamp that returns the exact same shape reads as unchanged.
 *
 * @param regs   A partition result.
 * @param bodyId The body whose footprint to snapshot.
 * @param gap    The gap index the tip lives in.
 * @returns      A stable signature string of that body's polygon(s) in that gap.
 */
export function bodyFootprintSig(regs: readonly SectionRegion[], bodyId: string, gap: number): string {
  return regs
    .filter((r) => r.bodyId === bodyId && r.gapIndex === gap)
    .map(
      (r) =>
        `${r.kind}|${r.polygon
          .map((p: PartitionPoint) => `${p.fraction.toFixed(4)},${p.elevation.toFixed(4)}`)
          .join(';')}`,
    )
    .sort()
    .join('#')
}

/** The interior apex fraction the app renders a handle at (the widest-inset tip). */
function interiorApexFraction(region: SectionRegion): number {
  let best = 0.5
  let bestDist = -1
  for (const p of region.polygon) {
    const d = Math.min(p.fraction, 1 - p.fraction)
    if (d > bestDist) {
      bestDist = d
      best = p.fraction
    }
  }
  return best
}

/**
 * Detect the GHOST/DEAD apex handles in a partition: apex-shapeable regions whose
 * single-body override the engine does NOT consume (footprint byte-static). Runs
 * ONE probe per shapeable region and returns a ``Set`` of ``gapIndex:bodyId`` keys
 * (the same key shape ``screenLenses`` / ``unroutableBodies`` use).
 *
 * The probe feeds a MODERATE apex nudge exactly as ``PartitionFillOverlay.setShape``
 * would (a single ``LensApexOverride`` at the body+gap key, moved 0.15 off the tip
 * toward mid-gap, at the region's mid-elevation) and compares the body's footprint
 * signature before vs after. A ghost tip (a merge-welded interior seam of one
 * continuous same-litho band, engine-suppressed by ruling 8m) does not move → DEAD.
 * A live enclosed lens / bracketed onlap reshapes → NOT dead → keeps its handle.
 *
 * Cost: one ``compute`` call per shapeable region on top of the base. This is why
 * the caller MEMOISES the result per topology (``[orderedColumns, edges, alongM]``)
 * — never per drag frame. Shapeable regions are a small fraction of the partition
 * (S76: ~167 shapeable across all 14 real sections), so a single batched pass per
 * topology change is acceptable; it does NOT re-run on hover/drag.
 *
 * @param base    The no-override partition (the regions the overlay already built).
 *                The BEFORE footprint signature is ALWAYS read from this full
 *                partition — never from ``regionsToProbe`` — so a body with several
 *                regions in one gap is compared whole. Passing a subset as ``base``
 *                (rather than as ``regionsToProbe``) would false-flag such a body.
 * @param columns The ordered partition columns.
 * @param edges   The approved correlation edges.
 * @param alongM  True along-section metres per column (1:1 with ``columns``).
 * @param compute The active partition engine (injected; v2 in the overlay/tests).
 * @param regionsToProbe Optional subset to probe (default: the shapeable regions of
 *                ``base``). Use to re-probe a single rendered handle while still
 *                comparing against the FULL partition footprint.
 * @returns       ``gapIndex:bodyId`` keys of every DEAD (ghost) apex handle.
 */
export function detectDeadHandleBodies(
  base: readonly SectionRegion[],
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[] | undefined,
  compute: ComputePartition,
  regionsToProbe: readonly SectionRegion[] = base,
): Set<string> {
  const dead = new Set<string>()
  for (const r of regionsToProbe) {
    const bodyId = r.bodyId
    if (!bodyId || !isApexShapeable(r)) continue
    const gap = r.gapIndex
    const apex = interiorApexFraction(r)
    // Nudge the apex toward mid-gap (matches the S76 gate's moderate drag): a live
    // tip moves under this; a ghost tip stays byte-static.
    const targetFrac = apex < 0.5 ? Math.min(0.7, apex + 0.15) : Math.max(0.3, apex - 0.15)
    const elevs = r.polygon.map((p) => p.elevation)
    const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
    const single = new Map<string, LensApexOverride>([
      [lensApexOverrideKey(bodyId, gap), { fraction: targetFrac, elevation: midElev }],
    ])
    const before = bodyFootprintSig(base, bodyId, gap)
    const after = bodyFootprintSig(compute(columns, edges, single, alongM), bodyId, gap)
    if (before === after) dead.add(`${gap}:${bodyId}`)
  }
  return dead
}
