/**
 * ONE GAP, ONE FAMILY — lines, then loops, then fill, then merge.
 *
 * Owner, 2026-08-19: *"we said first draw all lines, lenses, onlaps, vertical
 * lines, this makes closed loops, then we fill everything and merge it"*.
 * This module is that sentence, executed:
 *
 *  1. **LINES.** Every line the 2/1/0 law draws for this family in this gap —
 *     the tie lines, each band's own level, the lens flanks, the vertical
 *     termination between the two tests — plus the family's litho cover, which
 *     is the frame nothing may leave. They go into ONE planar arrangement, so
 *     no line can be drawn "after" another and no emission order exists to
 *     depend on.
 *  2. **LOOPS.** The arrangement hands back the closed loops those lines make.
 *  3. **FILL.** Each loop is asked ONE question at a point strictly inside it:
 *     whose ground is this? The nearer test's construct answers first; then the
 *     facing test's; then the matrix rulings (``matrixOwner``). A loop nothing
 *     can answer stays unclassed and renders "correlate me".
 *  4. **MERGE.** Loops that carry the same band weld into one region
 *     (``mergeFaces``).
 *
 * The answer is constant inside a loop BY CONSTRUCTION: every boundary any rule
 * can produce — a tie line, a band's own level, a lens flank, the vertical
 * termination, the cover — is a line in step 1, so a loop cannot straddle two
 * answers.
 *
 * @module utils/geotechHierarchicalFill/constructive/fillGap
 */

import {
  buildGapConstructs,
  claims,
  constructWindow,
  tieElevAt,
  type BandConstruct,
  type RunBand,
  type RunColumn,
  type RunTie,
} from './constructs'
import { matrixOwner, type MatrixReader } from './matrixOwner'
import { mergeFaces, type LabelledFace } from './mergeFaces'
import { overlayFaces, pointInRing } from '../frameClipGeometry'
import type { SectionRegion } from '../../partitionFill'

/** How far construct lines are drawn past the gap so they cross it cleanly. */
const EXTEND = 0.02

/** Everything one (family, gap) needs. */
export interface GapFillInput {
  /** The frame gap index stamped on every emitted region. */
  gapIndex: number
  /** Along-section metres of the gap's two frame columns. */
  xa: number
  xb: number
  /** This family's litho regions in this gap — the frame. */
  cover: readonly SectionRegion[]
  /**
   * EVERY litho region in this gap, in the render's own z-order, so ownership
   * is resolved the way the screen resolves it: an enclosed lens is an overlay
   * over another family's matrix, and without this both families claim it.
   */
  gapPaint: readonly SectionRegion[]
  /** The two banded tests this gap's ground runs between, or null. */
  run: { left: RunColumn; right: RunColumn } | null
  /** The family's surviving packing ties of the run. */
  ties: readonly RunTie[]
  /** The LITHO lines of the run — the cover's own boundaries. */
  coverTies: readonly RunTie[]
  /** Every test of the family that can answer here. */
  readers: readonly MatrixReader[]
  /**
   * Band ``layerId`` → the id of the mass its own correlations put it in. Bands
   * a tie joins share one; an untied band is alone in its own.
   */
  tieGroupOf: ReadonlyMap<string, string>
}

/** What one gap produced. */
export interface GapFillResult {
  /** Classed regions, disjoint, welded. */
  covered: SectionRegion[]
  /** Cover nothing could answer — the "correlate me" hatch. */
  residual: SectionRegion[]
  /** Ground the matrix rulings answered rather than a construct, in m². */
  matrixAreaM2: number
}

/** Order regions the way the render stacks them: overlays (lenses) last. */
function painterOrder(regions: readonly SectionRegion[]): SectionRegion[] {
  return [...regions.filter((r) => r.kind !== 'lens'), ...regions.filter((r) => r.kind === 'lens')]
}

/** The LAST region of ``paint`` containing the sample, or null. */
function coverAt(
  paint: readonly SectionRegion[],
  fraction: number,
  elevation: number,
): SectionRegion | null {
  let found: SectionRegion | null = null
  for (const region of paint) if (pointInRing(fraction, elevation, region.polygon)) found = region
  return found
}

/** Ring area in the gap's fraction space, scaled to square metres. */
function areaM2(ring: readonly { fraction: number; elevation: number }[], width: number): number {
  let twice = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    twice += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return (Math.abs(twice) / 2) * Math.abs(width)
}

/**
 * Fill one family's cover in one gap.
 *
 * @param input See {@link GapFillInput}.
 * @returns The classed regions, the unclassed cover, and the matrix area.
 */
export function fillGap(input: GapFillInput): GapFillResult {
  const { gapIndex, xa, xb, cover, gapPaint, run, ties, coverTies, readers, tieGroupOf } = input
  const width = xb - xa
  if (cover.length === 0 || !Number.isFinite(width) || Math.abs(width) < 1e-9) {
    return { covered: [], residual: [...cover], matrixAreaM2: 0 }
  }
  const own = new Set(cover)
  const foreignOverlays = gapPaint.filter((r) => r.kind === 'lens' && !own.has(r))
  const toFraction = (x: number): number => (x - xa) / width
  const atFraction = (f: number): number => xa + f * width

  // ---------------------------------------------------------------- LINES --
  const constructs: BandConstruct[] =
    run === null ? [] : buildGapConstructs(run.left, run.right, ties, coverTies)
  const lines: { fraction: number; elevation: number }[][] = []
  let eLo = Infinity
  let eHi = -Infinity
  for (const region of cover) {
    for (const p of region.polygon) {
      if (p.elevation < eLo) eLo = p.elevation
      if (p.elevation > eHi) eHi = p.elevation
    }
  }
  const horizontal = (elevation: number): void => {
    if (elevation <= eLo || elevation >= eHi) return
    lines.push([
      { fraction: -EXTEND, elevation },
      { fraction: 1 + EXTEND, elevation },
    ])
  }
  const vertical = (fraction: number): void => {
    if (fraction <= 0 || fraction >= 1) return
    lines.push([
      { fraction, elevation: eLo - EXTEND },
      { fraction, elevation: eHi + EXTEND },
    ])
  }

  // Every tie line that crosses this ground: the structural framework.
  if (run !== null) {
    const lo = Math.min(run.left.ci, run.right.ci)
    const hi = Math.max(run.left.ci, run.right.ci)
    for (const tie of ties) {
      if (Math.min(tie.leftCi, tie.rightCi) > lo || Math.max(tie.leftCi, tie.rightCi) < hi) continue
      lines.push([
        { fraction: -EXTEND, elevation: tieElevAt(tie, atFraction(-EXTEND)) },
        { fraction: 1 + EXTEND, elevation: tieElevAt(tie, atFraction(1 + EXTEND)) },
      ])
    }
  }
  // Every band's own level — the line an untied contact holds, and the level at
  // which the matrix changes its answer.
  const levelSources: readonly MatrixReader[] =
    run === null ? readers : readers.filter((r) => r.ci === run.left.ci || r.ci === run.right.ci)
  for (const reader of levelSources) {
    for (const band of reader.bands) {
      horizontal(band.top)
      horizontal(band.base)
    }
  }
  // The lens flanks.
  for (const construct of constructs) {
    if (construct.apexX === undefined) continue
    const mid = (construct.band.top + construct.band.base) / 2
    const fa = toFraction(construct.band.x)
    const fb = toFraction(construct.apexX)
    for (const y of [construct.band.top, construct.band.base]) {
      lines.push([
        { fraction: fa, elevation: y },
        { fraction: fb, elevation: mid },
      ])
    }
  }
  // The vertical termination: halfway between the two tests that meet here —
  // and, where no run governs this ground, halfway between each pair of the
  // family's own answering tests.
  if (run !== null) vertical(toFraction((run.left.x + run.right.x) / 2))
  else {
    const sorted = [...readers].sort((a, b) => a.x - b.x)
    for (let i = 0; i + 1 < sorted.length; i++) vertical(toFraction((sorted[i].x + sorted[i + 1].x) / 2))
  }

  // ---------------------------------------------------------------- LOOPS --
  const faces = overlayFaces(
    [
      ...cover.map((r) => r.polygon),
      ...foreignOverlays.map((r) => r.polygon),
      ...lines,
    ],
    `cfill-${gapIndex}`,
  )

  // ----------------------------------------------------------------- FILL --
  // What each band's own construct already claims here: the matrix never
  // repeats a band past its own loop.
  const closed = new Map<string, { lo: number; hi: number }>()
  for (const construct of constructs) {
    const raw = constructWindow(construct, xa, xb)
    // Clamped to the cover: a construct that follows the cover boundary is
    // unbounded on that side, and an infinite window would read as "this band
    // has spoken for every level anywhere", which is not what it said.
    const window = { lo: Math.max(raw.lo, eLo), hi: Math.min(raw.hi, eHi) }
    const previous = closed.get(construct.band.layerId)
    closed.set(
      construct.band.layerId,
      previous === undefined
        ? window
        : { lo: Math.min(previous.lo, window.lo), hi: Math.max(previous.hi, window.hi) },
    )
  }
  // The gap's own two tests, nearest first — the ownership rule that puts the
  // vertical termination halfway between them.
  const byColumn = new Map<number, BandConstruct[]>()
  for (const construct of constructs) {
    const list = byColumn.get(construct.band.ci)
    if (list === undefined) byColumn.set(construct.band.ci, [construct])
    else list.push(construct)
  }
  const framePaint = painterOrder(gapPaint)

  const labelled: LabelledFace<RunBand>[] = []
  const residual: SectionRegion[] = []
  let matrixAreaM2 = 0
  for (const face of faces) {
    const frame = coverAt(framePaint, face.sample.fraction, face.sample.elevation)
    // Outside this family's litho cover, or inside a face another family owns.
    if (frame === null || !own.has(frame)) continue
    const x = atFraction(face.sample.fraction)
    const y = face.sample.elevation
    let band: RunBand | null = null
    if (run !== null) {
      const near = Math.abs(x - run.left.x) <= Math.abs(x - run.right.x) ? run.left : run.right
      const far = near === run.left ? run.right : run.left
      for (const column of [near, far]) {
        for (const construct of byColumn.get(column.ci) ?? []) {
          if (!claims(construct, x, y)) continue
          band = construct.band
          break
        }
        if (band !== null) break
      }
    }
    if (band === null) {
      band = matrixOwner(x, y, readers, closed)
      if (band !== null) matrixAreaM2 += areaM2(face.ring, width)
    }
    if (band === null) {
      residual.push({
        gapIndex,
        formationId: frame.formationId,
        bodyId: frame.bodyId,
        kind: 'quad',
        polygon: face.ring,
      })
      continue
    }
    // WHAT MAY WELD: the same class, of the same body, that a CORRELATION says
    // is one mass. Two tests reading the same class either side of a vertical
    // termination weld when a tie joins them — the tie is the statement that it
    // is one mass, and the welded region then spans the gap as the 2/1/0 law
    // says a tied band must. Where no tie joins them they stay two regions
    // meeting at the termination: a deleted tie is never resurrected by the
    // merge, in the fill or in the body identity it feeds.
    labelled.push({
      key: `${band.formationId}|${band.bodyId ?? ''}|${tieGroupOf.get(band.layerId) ?? band.layerId}`,
      label: band,
      ring: face.ring,
    })
  }

  // ---------------------------------------------------------------- MERGE --
  const covered = mergeFaces(labelled).map(({ label, members, ring }) => ({
    gapIndex,
    formationId: label.formationId,
    bodyId: label.bodyId,
    kind: 'quad' as const,
    polygon: ring,
    layerIds: [...new Set(members.map((m) => m.layerId))].sort(),
  }))
  return { covered, residual, matrixAreaM2 }
}
