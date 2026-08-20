/**
 * ONE GAP, ONE FAMILY — lines, then loops, then fill, then merge.
 *
 * Owner, 2026-08-19: *"we said first draw all lines, lenses, onlaps, vertical
 * lines, this makes closed loops, then we fill everything and merge it"*, and
 * the fill itself: *"Fill = emit lenses first, then emit onlaps, then fill in
 * the rest with the dominant lithology (should be the same if all onlaps and
 * lenses are emitted). Fill sweep if a lens is touching a body with same litho
 * and packing then lens disappears and it becomes one body"*.
 *
 * Executed exactly in that order:
 *
 *  1. **LINES** — every line the law calls for (``constructs.ts``) plus the
 *     family's litho cover, into ONE planar arrangement. No line is drawn
 *     "after" another, so no emission order exists to depend on.
 *  2. **LOOPS** — the arrangement hands back the closed loops those lines make.
 *  3. **FILL** — each loop is asked once, at a point strictly inside it:
 *     a lens first, then an onlap, then the dominant mass of the ground.
 *  4. **MERGE** — faces of the same mass that touch weld into one region, which
 *     IS the fill sweep: a lens touching a body of the same litho and packing
 *     disappears into it, one body, no seam.
 *
 * @module utils/geotechHierarchicalFill/constructive/fillGap
 */

import {
  buildGapConstructs,
  claims,
  tieElevAt,
  type BandConstruct,
  type RunBand,
  type RunColumn,
  type RunTie,
} from './constructs'
import { FILL_ORDER, massKey, type Mass } from './emitKernel'
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
  /** EVERY litho region in this gap, in the render's own z-order. */
  gapPaint: readonly SectionRegion[]
  /** The two banded tests this gap's ground runs between, or null. */
  run: { left: RunColumn; right: RunColumn } | null
  /** The family's surviving packing ties of the run. */
  ties: readonly RunTie[]
  /** The LITHO lines of the run — the cover's own boundaries. */
  coverTies: readonly RunTie[]
  /** Every banded column of the family, for the dominant read. */
  columns: readonly RunColumn[]
  /** EVERY packing band per column index, for the far-end read. */
  stacks: ReadonlyMap<number, readonly RunBand[]>
  /** The mass (litho + packing) of a band. */
  massOf: (band: RunBand) => Mass
}

/** What one gap produced. */
export interface GapFillResult {
  /** Classed regions, disjoint, welded. */
  covered: SectionRegion[]
  /** Cover nothing could answer — the "correlate me" hatch. */
  residual: SectionRegion[]
  /** Ground the dominant-mass step answered rather than a construct, in m². */
  remainderAreaM2: number
  /**
   * Loops where the dominant mass was NOT unique by overlap and the vertical
   * line between the two tests decided it. His parenthetical — *"should be the
   * same if all onlaps and lenses are emitted"* — says a remainder ought to
   * have one owner; this counts where it did not.
   */
  splitRemainders: number
  /**
   * The classed loops BEFORE the merge weld, each carrying its single owning
   * band and its ROLE: ``construct`` = a shape the law drew from the ties
   * (lens / onlap / vertical side) — pure geometry, structurally inside its
   * own envelope; ``fill`` = the dominant-lithology remainder step. The audit
   * measures balloons on construct loops only, where any violation is a
   * constructor bug (owner: "we have geometrical shapes, triangles and
   * rectangular shapes, there shouldn't be pre merge ballooning anywhere...
   * not untill we do the geometrical fill").
   */
  preMerge: (SectionRegion & { role: 'construct' | 'fill' })[]
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

/**
 * The elevation span a ring occupies on the vertical at ``fraction`` — a
 * scanline through it. Falls back to the ring's whole range where the vertical
 * misses it (a degenerate face).
 */
function ringSpanAt(
  ring: readonly { fraction: number; elevation: number }[],
  fraction: number,
): { lo: number; hi: number } {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (a.fraction === b.fraction) continue
    const t = (fraction - a.fraction) / (b.fraction - a.fraction)
    if (t < 0 || t > 1) continue
    const elevation = a.elevation + t * (b.elevation - a.elevation)
    if (elevation < lo) lo = elevation
    if (elevation > hi) hi = elevation
  }
  if (lo <= hi) return { lo, hi }
  let allLo = Infinity
  let allHi = -Infinity
  for (const p of ring) {
    if (p.elevation < allLo) allLo = p.elevation
    if (p.elevation > allHi) allHi = p.elevation
  }
  return { lo: allLo, hi: allHi }
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
 * *"fill in the rest with the dominant lithology"* — of the tests that read
 * this ground, the band that occupies most of the loop's own levels owns it.
 *
 * Where two tests read the same levels and disagree, the overlap alone cannot
 * choose — and that is exactly the case his law draws a VERTICAL LINE IN THE
 * MIDDLE for, so the loop already lies on one side of it and the test on that
 * side owns it. Counted (``splitRemainders``) so the case stays visible.
 */
function dominantBand(
  candidates: readonly RunBand[],
  x: number,
  lo: number,
  hi: number,
): { band: RunBand | null; split: boolean } {
  let best: RunBand | null = null
  let bestOverlap = -Infinity
  let bestDistance = Infinity
  let split = false
  for (const band of candidates) {
    const distance = Math.abs(band.x - x)
    // How much of this loop's own levels the mass occupies. A form no mass
    // reaches at all (the ground a closed loop encircles above or below every
    // stack) scores NEGATIVE — the elevation gap to the nearest mass — so the
    // wall of that form still answers rather than leaving a hole.
    const overlap = Math.min(band.top, hi) - Math.max(band.base, lo)
    const better =
      overlap > bestOverlap + 1e-9 ||
      (overlap > bestOverlap - 1e-9 && distance < bestDistance)
    if (best !== null && Math.abs(overlap - bestOverlap) <= 1e-9 && best.formationId !== band.formationId) {
      split = true
    }
    if (better) {
      best = band
      bestOverlap = overlap
      bestDistance = distance
    }
  }
  return { band: best, split }
}

/**
 * Fill one family's cover in one gap.
 *
 * @param input See {@link GapFillInput}.
 * @returns The classed regions, the unclassed cover, and the counters.
 */
export function fillGap(input: GapFillInput): GapFillResult {
  const { gapIndex, xa, xb, cover, gapPaint, run, ties, coverTies, columns, stacks, massOf } = input
  const width = xb - xa
  if (cover.length === 0 || !Number.isFinite(width) || Math.abs(width) < 1e-9) {
    return { covered: [], residual: [...cover], remainderAreaM2: 0, splitRemainders: 0, preMerge: [] }
  }
  const own = new Set(cover)
  const foreignOverlays = gapPaint.filter((r) => r.kind === 'lens' && !own.has(r))
  const toFraction = (x: number): number => (x - xa) / width
  const atFraction = (f: number): number => xa + f * width

  // ---------------------------------------------------------------- LINES --
  const constructs: BandConstruct[] =
    run === null
      ? []
      : buildGapConstructs(run.left, run.right, ties, coverTies, stacks, massOf)
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

  if (run !== null) {
    const lo = Math.min(run.left.ci, run.right.ci)
    const hi = Math.max(run.left.ci, run.right.ci)
    // Every tie line that crosses this ground: the correlations themselves.
    for (const tie of ties) {
      if (Math.min(tie.leftCi, tie.rightCi) > lo || Math.max(tie.leftCi, tie.rightCi) < hi) continue
      lines.push([
        { fraction: -EXTEND, elevation: tieElevAt(tie, atFraction(-EXTEND)) },
        { fraction: 1 + EXTEND, elevation: tieElevAt(tie, atFraction(1 + EXTEND)) },
      ])
    }
    // "vertical line in the middle" — where the law calls for it (two ties, a
    // different mass at the other end), and where two onlaps reaching from
    // opposite tests meet, which is the same line: a construct owns its own
    // side of it (see ``claims``).
    if (constructs.some((c) => c.emit === 'vertical' || c.emit === 'onlap')) {
      vertical(toFraction((run.left.x + run.right.x) / 2))
    }
    // The lens flanks.
    for (const construct of constructs) {
      if (construct.emit !== 'lens' || construct.apexX === undefined) continue
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
  }
  // Every band's own level — but ONLY where no tie already states that contact.
  // A tied contact's line IS the tie, which is drawn above; adding a horizontal
  // through it cuts a sliver off the tie-bounded window and hands it to the
  // wrong mass (measured on his gap 3: the facing sand's flat base sliced the
  // very dense sand's own window in half).
  const levelColumns =
    run === null ? columns : columns.filter((c) => c.ci === run.left.ci || c.ci === run.right.ci)
  const stated = new Set<string>()
  for (const construct of constructs) {
    if (construct.topTied) stated.add(`${construct.band.ci}@${Math.round(construct.band.top * 1000)}`)
    if (construct.baseTied) stated.add(`${construct.band.ci}@${Math.round(construct.band.base * 1000)}`)
  }
  for (const column of levelColumns) {
    for (const band of column.bands) {
      if (!stated.has(`${band.ci}@${Math.round(band.top * 1000)}`)) horizontal(band.top)
      if (!stated.has(`${band.ci}@${Math.round(band.base * 1000)}`)) horizontal(band.base)
    }
  }

  // ---------------------------------------------------------------- LOOPS --
  const faces = overlayFaces(
    [...cover.map((r) => r.polygon), ...foreignOverlays.map((r) => r.polygon), ...lines],
    `cfill-${gapIndex}`,
  )

  // ----------------------------------------------------------------- FILL --
  const lenses = constructs.filter((c) => c.emit === 'lens')
  const onlaps = constructs.filter((c) => c.emit === 'onlap')
  // The two masses a vertical line stands between own their own side of it; a
  // band that emits NOTHING owns the ground between the lines it follows.
  const verticals = constructs.filter((c) => c.emit === 'vertical' || c.emit === 'nothing')
  const framePaint = painterOrder(gapPaint)
  // *"(should be the same if all onlaps and lenses are emitted)"* — the rest of
  // the ground belongs to the CONTINUOUS mass, so the masses that drew a shape
  // of their own (a lens, an onlap) are not candidates for it: their shape is
  // their whole statement, and letting one own the ground past its own loop is
  // what carried an interbed's level across a gap.
  const shaped = new Set(
    constructs.filter((c) => c.emit === 'lens' || c.emit === 'onlap').map((c) => c.band.layerId),
  )
  const answering = run === null ? columns : [run.left, run.right]
  const allBands = answering.flatMap((c) => c.bands)
  const continuous = allBands.filter((b) => !shaped.has(b.layerId))

  const labelled: LabelledFace<RunBand>[] = []
  const preMerge: (SectionRegion & { role: 'construct' | 'fill' })[] = []
  const residual: SectionRegion[] = []
  let remainderAreaM2 = 0
  let splitRemainders = 0
  for (const face of faces) {
    const frame = coverAt(framePaint, face.sample.fraction, face.sample.elevation)
    // Outside this family's litho cover, or inside a face another family owns.
    if (frame === null || !own.has(frame)) continue
    const x = atFraction(face.sample.fraction)
    const y = face.sample.elevation
    // "emit lenses first, then emit onlaps" — nearest test first where two of a
    // kind cover the same point.
    let band: RunBand | null = null
    // The law's own order: lenses, then onlaps, then the rest — and "the rest"
    // is the ground between two masses a vertical stands in, then the dominant
    // mass of whatever is left.
    for (const tier of FILL_ORDER.map((step) =>
      step === 'lens' ? lenses : step === 'onlap' ? onlaps : verticals,
    )) {
      let bestDistance = Infinity
      for (const construct of tier) {
        if (!claims(construct, x, y)) continue
        const distance = Math.abs(construct.band.x - x)
        if (distance < bestDistance) {
          bestDistance = distance
          band = construct.band
        }
      }
      if (band !== null) break
    }
    const answeredByConstruct = band !== null
    // "then fill in the rest with the dominant lithology"
    if (band === null) {
      // The loop's own extent AT THIS POINT'S vertical, not over its whole
      // width: a loop between two dipping tie lines is one band's ground at one
      // end and the facing band's at the other, and measuring the dominance
      // across the whole loop hands a thin band's own ground to whichever mass
      // is thicker over there. Beside its own test, a band's own levels are the
      // ones that count (owner, 2026-08-20 — a test owns the ground beside it).
      const { lo, hi } = ringSpanAt(face.ring, face.sample.fraction)
      // The continuous masses answer first; only where every mass here drew a
      // shape of its own does the nearest of THOSE answer, which is better than
      // a hole in the middle of ground the tests did read.
      const dominant = dominantBand(continuous.length > 0 ? continuous : allBands, x, lo, hi)
      band = dominant.band
      if (band !== null) {
        remainderAreaM2 += areaM2(face.ring, width)
        if (dominant.split) splitRemainders += 1
      }
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
    // THE FILL SWEEP is the merge key: same litho + same packing IS one mass,
    // so a lens touching such a body welds into it and disappears. Within a
    // family the litho is one by construction, so the key is the packing class.
    labelled.push({ key: massKey(massOf(band)), label: band, ring: face.ring })
    preMerge.push({
      gapIndex,
      formationId: band.formationId,
      bodyId: band.bodyId,
      kind: 'quad' as const,
      polygon: face.ring,
      layerIds: [band.layerId],
      role: answeredByConstruct ? 'construct' : 'fill',
    })
  }

  // ---------------------------------------------------------------- MERGE --
  const covered = mergeFaces(labelled).map(({ label, members, ring }) => {
    // WHOSE PAINT IS THIS? Every band of the same mass whose own ground the
    // region covers at that band's own test. One mass welded across a gap is one
    // region — *"it becomes one body"* — and both tests' bands are that body, so
    // both identities travel on it. Without this a band that emitted nothing
    // because its facing twin is identical would appear nowhere at all, which is
    // what the 2/1/0 audit reads as a construct that failed to exist.
    const ids = new Set(members.map((m) => m.layerId))
    let lo = Infinity
    let hi = -Infinity
    let f0 = Infinity
    let f1 = -Infinity
    for (const p of ring) {
      if (p.elevation < lo) lo = p.elevation
      if (p.elevation > hi) hi = p.elevation
      if (p.fraction < f0) f0 = p.fraction
      if (p.fraction > f1) f1 = p.fraction
    }
    for (const column of answering) {
      const own = Math.abs(column.x - xa) < Math.abs(column.x - xb) ? f0 : f1
      if (own > 0.02 && own < 0.98) continue
      for (const band of column.bands) {
        if (band.formationId !== label.formationId) continue
        if (Math.min(band.top, hi) - Math.max(band.base, lo) <= 0) continue
        ids.add(band.layerId)
      }
    }
    return {
      gapIndex,
      formationId: label.formationId,
      bodyId: label.bodyId,
      kind: 'quad' as const,
      polygon: ring,
      layerIds: [...ids].sort(),
    }
  })
  return { covered, residual, remainderAreaM2, splitRemainders, preMerge }
}
