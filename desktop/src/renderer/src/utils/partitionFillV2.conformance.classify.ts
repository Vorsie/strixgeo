/**
 * partitionFillV2.conformance.classify.ts — pure classifier helpers for the full 2/1/0
 * conformance gate (``partitionFillV2.conformance.diag.test.ts``). Design:
 * docs/design/partition-engine-v2.md §8 rulings 8 / 8a / 8b.
 *
 * Extracted from the diag to keep that file under the 500-line budget (debt #201),
 * mirroring the ``partitionFillV2.shapeaudit.zerocorr.ts`` extraction. Two concerns live
 * here:
 *   1. RENDERED-SHAPE classification of a SectionRegion set (band / onlap / lens / absent).
 *   2. EFFECTIVE TIE derivation mirroring the engine (``tiedContacts`` direct + derived
 *      base-tie, the ruling-8a shared-contact derived onlap, and matched-pair band
 *      membership via ``collectGapBands``).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type PartitionPoint, type SectionRegion } from './sectionPartition'
import { inPolygon } from './partitionFillV2.parityCoverage'

// The 8e / 8g(b) merge predicates now live in the ENGINE package as the SINGLE source of
// truth (``partitionFillV2/terminationRules.ts``, THE HOIST): the termination sweep SUPPRESSES
// exactly the terminations these name, and the gate ACCEPTS exactly a band render for them, so
// the engine and the gate cannot drift. Re-export so the gate keeps its import surface.
export { sameFormationBaseTiedPair, sameFormationEnclosedByTiedBand } from './partitionFillV2/terminationRules'

// Corr-arithmetic (tiedFlags / derivedBandTies / isBandMember / topBandTies /
// unitHasDirectTie / effectiveCorrForUnit) now lives in the ENGINE package as the SINGLE
// source of truth (``partitionFillV2/effectiveCorr.ts``, ruling 8c). Re-export it here so
// the gate keeps its import surface AND cannot drift from the engine — the engine emits the
// termination the arithmetic names; the gate checks the render against the SAME arithmetic.
export {
  derivedBandTies,
  effectiveCorrForUnit,
  isBandMember,
  tiedFlags,
  topBandTies,
  unitHasDirectTie,
  type EffectiveCorr,
} from './partitionFillV2/effectiveCorr'

/** Within this fraction of a column edge counts as "reaches" it. */
export const FULL_EPS = 0.02

/** Rendered termination shape of a formation over a unit's elevation band in a gap. */
export type RenderShape = 'absent' | 'band' | 'onlap' | 'lens'

// ---------------------------------------------------------------------------
// Connected-component rendered-shape classifier (2026-07-16 gate hardening).
//
// DEFECT the old aggregate classifier had: it took lo = min(all lows), hi = max(all highs)
// across EVERY same-formation region overlapping the unit's elevation band. Two DISCONNECTED
// same-formation lenses — one hugging the left column, one hugging the right — therefore read
// as a full-width ``band`` (false GREEN of a real defect), and a FACING same-formation onlap
// overlapping the audited unit's elevations promoted the audited unit's own proper lens to
// ``band`` (the Tie-10 gap0 SILT[L] false POSITIVE). Both are fixed by classifying per
// CONNECTED COMPONENT and preferring the component INCIDENT to the audited unit's own column
// edge — a facing unit's shape can no longer stand in for the audited unit's shape.
//
// ADJACENCY / TOLERANCE. The regions are simple polygons on a 1 mm-snapped fraction/elevation
// grid (`SNAP` in the engine arrangement). Components are built at the REGION level: a
// same-formation region is a NODE when it elevation-overlaps the audited band, and two nodes
// are joined when their band-window footprints TOUCH. We test that footprint touch by
// rasterizing each region's coverage WITHIN the band window onto a shared (fraction ×
// band-elevation) grid, then union-find over 4-neighbour cells across regions — a robust,
// order-independent proxy for "share a boundary within tolerance": two pieces meeting along a
// shared seam (e.g. the three SILT quads that tile one full-width band in CS1 gap18) light up
// adjacent cells → one component; two side lenses separated by a vacant mid-gap strip
// (Tie-10 gap0 SILT left-lens f[0..0.01] vs the facing right SILT lens f[0.5..1]) never share
// or neighbour a covered cell → two components.
//
// REACH is measured from each component's member regions' FULL (unclipped) polygon fraction
// extent — IDENTICAL to the old aggregate classifier's ``fracExtent``, so a dipping full-width
// band (whose horizontal band-window intersection covers only part of the fraction axis but
// whose region polygon still spans 0..1) is correctly scored ``band``. The ONLY behavioural
// change from the aggregate is the per-component SPLIT: min/max is taken within a connected
// component, never across disconnected pieces. FULL_EPS 0.02 edge-reach tolerance unchanged.
//
// Grid GX=200 × GY=64: fraction cell 1/200 = 0.005 (≈ 4× the 1 mm snap, so two regions meeting
// at a snapped seam land in the same or a neighbouring cell) and elevation cell band-height/64
// (a sub-metre unit still gets several rows). The raster is used ONLY for adjacency, not reach.
// ---------------------------------------------------------------------------

/** Grid resolution for the raster adjacency pass (see block comment). */
const GX = 200
const GY = 64

/** Union-find root with path compression. */
function ufFind(parent: number[], i: number): number {
  let root = i
  while (parent[root] !== root) root = parent[root]
  while (parent[i] !== root) {
    const next = parent[i]
    parent[i] = root
    i = next
  }
  return root
}

/** One connected component's unclipped fraction reach + edge incidence. */
interface Component {
  fracLo: number
  fracHi: number
  reachesLeft: boolean
  reachesRight: boolean
}

/** Fraction extent [min,max] of a polygon ring (unclipped — matches the old classifier). */
function fracExtent(poly: readonly PartitionPoint[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of poly) {
    if (p.fraction < lo) lo = p.fraction
    if (p.fraction > hi) hi = p.fraction
  }
  return [lo, hi]
}

/** True when the polygon's elevation extent overlaps the target band. */
function elevOverlaps(poly: readonly PartitionPoint[], bandLo: number, bandHi: number): boolean {
  let plo = Infinity
  let phi = -Infinity
  for (const p of poly) {
    if (p.elevation < plo) plo = p.elevation
    if (p.elevation > phi) phi = p.elevation
  }
  return Math.min(phi, bandHi) - Math.max(plo, bandLo) > 1e-9
}

/**
 * Group the same-formation regions that elevation-overlap the band into CONNECTED COMPONENTS
 * (region-level union-find via band-window footprint touch) and return each component's
 * unclipped fraction reach + which column edges it reaches. See the block comment for the
 * adjacency model and why reach is unclipped.
 */
function bandComponents(
  regs: readonly SectionRegion[],
  formationId: string,
  bandLo: number,
  bandHi: number,
): Component[] {
  if (bandHi - bandLo < 1e-6) return []
  const nodes = regs.filter((r) => r.formationId === formationId && elevOverlaps(r.polygon, bandLo, bandHi))
  if (nodes.length === 0) return []

  // Rasterize each region's band-window coverage into its own cell set (for adjacency only).
  // cellOwner[cell] = index of the FIRST node covering that cell; a later node hitting the same
  // or a 4-neighbour cell unions with the recorded owner.
  const cellOwner = new Int32Array(GX * GY).fill(-1) as unknown as number[]
  const parent = Array.from({ length: nodes.length }, (_, i) => i)
  const union = (a: number, b: number): void => {
    const ra = ufFind(parent, a)
    const rb = ufFind(parent, b)
    if (ra !== rb) parent[rb] = ra
  }
  for (let ni = 0; ni < nodes.length; ni++) {
    const poly = nodes[ni].polygon
    for (let iy = 0; iy < GY; iy++) {
      const py = bandHi - ((iy + 0.5) / GY) * (bandHi - bandLo)
      for (let ix = 0; ix < GX; ix++) {
        const px = (ix + 0.5) / GX
        if (!inPolygon(px, py, poly)) continue
        // Union with any already-owned cell in the 4-neighbourhood (incl. self) — a shared or
        // touching seam joins two regions into one component. Horizontal neighbours are guarded
        // against row wrap (ix-1 < 0 / ix+1 >= GX would alias the previous/next row's edge cell).
        const neigh: number[] = [ix + iy * GX]
        if (ix - 1 >= 0) neigh.push(ix - 1 + iy * GX)
        if (ix + 1 < GX) neigh.push(ix + 1 + iy * GX)
        if (iy - 1 >= 0) neigh.push(ix + (iy - 1) * GX)
        if (iy + 1 < GY) neigh.push(ix + (iy + 1) * GX)
        for (const cell of neigh) {
          const owner = cellOwner[cell]
          if (owner >= 0 && owner !== ni) union(ni, owner)
        }
        if (cellOwner[ix + iy * GX] < 0) cellOwner[ix + iy * GX] = ni
      }
    }
  }

  // Fold each node's unclipped reach into its component.
  const byRoot = new Map<number, Component>()
  for (let ni = 0; ni < nodes.length; ni++) {
    const root = ufFind(parent, ni)
    const [flo, fhi] = fracExtent(nodes[ni].polygon)
    let c = byRoot.get(root)
    if (!c) {
      c = { fracLo: flo, fracHi: fhi, reachesLeft: false, reachesRight: false }
      byRoot.set(root, c)
    } else {
      if (flo < c.fracLo) c.fracLo = flo
      if (fhi > c.fracHi) c.fracHi = fhi
    }
  }
  for (const c of byRoot.values()) {
    c.reachesLeft = c.fracLo <= FULL_EPS
    c.reachesRight = c.fracHi >= 1 - FULL_EPS
  }
  return [...byRoot.values()]
}

/** Classify one component's shape from its edge reach. */
function shapeOfComponent(c: Component): RenderShape {
  if (c.reachesLeft && c.reachesRight) return 'band'
  if (c.reachesLeft || c.reachesRight) return 'onlap'
  return 'lens'
}

/**
 * The rendered shape of a formation over a target elevation band in a gap, classified per
 * CONNECTED COMPONENT (not per aggregate min/max fraction extent — see the block comment
 * above). The component whose shape is reported is the one INCIDENT to the audited unit's own
 * column edge (``side``): a facing same-formation onlap/lens on the OTHER column can no longer
 * masquerade as the audited unit's own render. When no component touches the audited edge (the
 * unit's own termination is genuinely missing), the WIDEST-reaching component in the band is
 * reported instead (so an all-facing render still classifies as band/onlap, never spuriously
 * absent — the caller decides whether that is a violation).
 *
 * Classes: ``absent`` (no same-formation coverage in the band), ``band`` (one connected
 * component spans ~0..1), ``onlap`` (reaches exactly one edge), ``lens`` (reaches neither).
 *
 * Parameters
 * ----------
 * regs : readonly SectionRegion[]
 *     The gap's regions (v2 output).
 * formationId : string
 *     The unit's formation.
 * bandLo, bandHi : number
 *     The unit's own elevation band (mTAW). Only same-formation pieces that vertically
 *     overlap this band are rasterized (a same-formation region three units away contributes
 *     no covered cells in this window and is naturally excluded).
 * side : 'left' | 'right'
 *     Which column the audited unit lives on (left ⇒ fraction 0, right ⇒ fraction 1). The
 *     incident component is the one covering that edge.
 *
 * Returns
 * -------
 * object
 *     ``shape`` + fraction extent + apex reach + which edges the reported component reaches +
 *     ``incident`` (whether the reported component actually touches the audited unit's edge).
 */
export function renderedShape(
  regs: readonly SectionRegion[],
  formationId: string,
  bandLo: number,
  bandHi: number,
  side: 'left' | 'right' = 'left',
): {
  shape: RenderShape
  fracLo: number
  fracHi: number
  apex: number
  reachesLeft: boolean
  reachesRight: boolean
  incident: boolean
} {
  const comps = bandComponents(regs, formationId, bandLo, bandHi)
  if (comps.length === 0) {
    return { shape: 'absent', fracLo: 0, fracHi: 0, apex: 0, reachesLeft: false, reachesRight: false, incident: false }
  }
  // Prefer the component INCIDENT to the audited unit's own column edge — the one that reaches
  // fraction 0 (left side) or fraction 1 (right side). A facing-only component (reaching just the
  // other edge) can no longer stand in for the audited unit's own render.
  const incidentComps = comps.filter((c) => (side === 'left' ? c.reachesLeft : c.reachesRight))
  let chosen: Component
  let incident: boolean
  if (incidentComps.length > 0) {
    // The audited unit HAS its own render on its edge — score its widest incident component.
    chosen = incidentComps.reduce((a, b) => (b.fracHi - b.fracLo > a.fracHi - a.fracLo ? b : a))
    incident = true
  } else {
    // Nothing on the audited unit's own edge — report the widest component (all-facing render).
    chosen = comps.reduce((a, b) => (b.fracHi - b.fracLo > a.fracHi - a.fracLo ? b : a))
    incident = false
  }
  const shape = shapeOfComponent(chosen)
  const apex = chosen.reachesLeft ? chosen.fracHi : chosen.reachesRight ? 1 - chosen.fracLo : chosen.fracHi - chosen.fracLo
  return {
    shape,
    fracLo: chosen.fracLo,
    fracHi: chosen.fracHi,
    apex,
    reachesLeft: chosen.reachesLeft,
    reachesRight: chosen.reachesRight,
    incident,
  }
}

/**
 * Shallow TD of a gap (mTAW): the HIGHER of the two facing columns' deepest base elevations.
 * Below this elevation only ONE column has data, so a full-width fill there is the deep-to-deep
 * substrate (owner §8 Q3), NOT a same-formation termination band — the 2/1/0 rule does not apply
 * to it. Mirrors ``partitionFillV2.shapeaudit.zerocorr.ts`` ``shallowTDForGap``.
 */
export function shallowTDForGap(
  left: { units: { baseElev: number }[] },
  right: { units: { baseElev: number }[] },
): number {
  const tdOf = (c: { units: { baseElev: number }[] }): number =>
    Math.min(...c.units.map((u) => u.baseElev))
  return Math.max(tdOf(left), tdOf(right))
}
