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
  seamMeets,
  tieElevAt,
  type BandConstruct,
  type RunBand,
  type RunColumn,
  type RunTie,
} from './constructs'
import { FILL_ORDER, massKey, type Mass } from './emitKernel'
import { fillGapProbe, type ProbeFace } from './fillGapProbe'
import { mergeFaces, type LabelledFace } from './mergeFaces'
import { nearestFamilyColumns } from './nearestFamilyColumns'
import { pickRemainder } from './remainderLadder'
import { nadClassRank, seamHalfBand, stackedSeamOf, type StackedSeam } from './stackedSeamHalf'
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
  /**
   * Where each band's CLOSURES stand, run-wide (layer id → the apex x of
   * every gap it closed a loop in — lens or onlap alike). A closed loop
   * pinches in its own gap and its statement ends there — it never answers
   * remainder ground on the far side of one of its bars, in ANY gap (owner
   * 2026-08-21 night: "the dense sand onlaps so the MD should fill"; owner
   * code-hunt finding B1b, 2026-08-22: a lens closes exactly as absolutely
   * as an onlap does, and the bar must say so).
   */
  closureBars: ReadonlyMap<string, readonly number[]>
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
 * Fill one family's cover in one gap.
 *
 * @param input See {@link GapFillInput}.
 * @returns The classed regions, the unclassed cover, and the counters.
 */
export function fillGap(input: GapFillInput): GapFillResult {
  const {
    gapIndex,
    xa,
    xb,
    cover,
    gapPaint,
    run,
    ties,
    coverTies,
    columns,
    stacks,
    massOf,
    closureBars,
  } = input
  // ONE mass identity for the whole gap — the emit decisions, the remainder
  // split, the weld and the layer-id attribution all compare THIS, so two
  // formation rows of one class can never disagree about being one mass.
  const massKeyOf = (band: RunBand): string => massKey(massOf(band))
  /** A band's NAD class — what *"least dense"* is read from in a seam half. */
  const densityRankOf = (band: RunBand): number | null => nadClassRank(massOf(band).packing)
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
  // *"this is only the rule for vertical seems with a stacked sequence on both
  // side"* (owner, 2026-08-25) — see ``stackedSeamHalf.ts``. Decided from the
  // constructs, before a single line is drawn, because the seam below and the
  // ownership of every face in this gap both hang on it.
  //
  // ...AND ONLY WHERE THE SEAM IS ACTUALLY IN THIS GAP. His rule is *"vertical
  // seems"* — a line in the middle with a half on either side of it. A run
  // whose two tests bridge an excluded column has its middle OUTSIDE the gap
  // it is filling, so there is no seam, no two halves, and every face would
  // fall to whichever stack happens to lie on the middle's side. That is not
  // the case he ruled on, and it keeps the ladder. ``vertical`` below applies
  // the same test to the line it draws.
  const middleX = run === null ? Number.NaN : (run.left.x + run.right.x) / 2
  const seamFraction = toFraction(middleX)
  const stackedSeam: StackedSeam | null =
    run === null || !(seamFraction > 0 && seamFraction < 1)
      ? null
      : stackedSeamOf(constructs, run)
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

  /** The correlation lines actually drawn across this gap — the fill's walls. */
  const drawnTies: RunTie[] = []
  if (run !== null) {
    const lo = Math.min(run.left.ci, run.right.ci)
    const hi = Math.max(run.left.ci, run.right.ci)
    // Every tie line that crosses this ground: the correlations themselves.
    for (const tie of ties) {
      if (Math.min(tie.leftCi, tie.rightCi) > lo || Math.max(tie.leftCi, tie.rightCi) < hi) continue
      drawnTies.push(tie)
      lines.push([
        { fraction: -EXTEND, elevation: tieElevAt(tie, atFraction(-EXTEND)) },
        { fraction: 1 + EXTEND, elevation: tieElevAt(tie, atFraction(1 + EXTEND)) },
      ])
    }
    // *"if it is different then vertical line in the middle"* — see
    // ``seamMeets`` for the rule (two statements MEETING from opposite
    // tests): a lone onlap or a lone open mass has nobody on the facing side
    // to meet, so no seam is drawn and the ground fills through instead.
    // ...and a STACKED SEAM always draws it: the ruling IS that the two stacks
    // stop at a vertical line, whether or not the constructs on the two sides
    // happen to be the matching pair ``seamMeets`` looks for (two lenses facing
    // two onlaps close just as completely, and left no seam before this).
    if (stackedSeam !== null || seamMeets(constructs, run.left.ci, run.right.ci)) {
      vertical(seamFraction)
    }
    // THE ONLAP FLANK — the free contact closing onto its tie at the
    // termination. Without this line the arrangement has no edge along the
    // wedge's underside: one face spans the wedge AND the ground beyond it, the
    // face's own sample lands outside the wedge, and the onlap loses its own
    // column edge to whatever fills there (his gap-0 MD sand, painted D at
    // f=0.98 beside its own test). The lens flanks below have always been
    // inserted for exactly this reason; a pinching onlap needs it just as much.
    //
    // A band whose own home column is bridged in from beyond this gap (its
    // run's own flanks are not this gap's own — the real CS1 S10 bottom MD
    // sand, onlapping toward S11 across excluded S8) has ``band.x`` OUTSIDE
    // this gap's own [0, 1] fraction range entirely: the flank's own free
    // endpoint would sit past the gap's own edge, closing nothing WITHIN it,
    // and this gap's own portion of the wedge is left with no upper edge —
    // an unrelated construct riding the same tie (a 2-tied "emits nothing"
    // span has no termination clause of its own) then claims the ground
    // instead. Clamp the free endpoint to this gap's own edge, read through
    // the construct's own boundary function (not the flat home-column value,
    // which is only correct exactly AT ``band.x``).
    //
    // ONLY the bridged case gets the multi-point refinement below. ``freeAt``
    // is quadratic in x, so a single straight segment always cuts inside the
    // true curve somewhat — but a straight 2-point flank is the law's own
    // long-standing approximation everywhere else, and re-litigating its
    // precision model-wide moved an owner-pinned real-data regression
    // (S13b, KLEI-22 vs KLEI-23: the winner's own ``claims()`` was always
    // exact regardless of this flank — a face just used to land its sample
    // inside the loser's cruder-flanked face at that exact point). Scoped
    // here to where it actually matters: a bridged home column stretches the
    // flank over a domain the straight-line approximation was never measured
    // against, and that domain is exactly where the unconditional "emits
    // nothing" span (no termination clause of its own) is left free to claim
    // whatever the flank fails to cut.
    const FLANK_STEPS = 8
    for (const construct of constructs) {
      if (construct.emit !== 'onlap' || construct.apexX === undefined) continue
      const freeAt = construct.topTied ? construct.baseAt : construct.topAt
      const rawHomeFraction = toFraction(construct.band.x)
      const bridged = rawHomeFraction < 0 || rawHomeFraction > 1
      const homeFraction = Math.min(1, Math.max(0, rawHomeFraction))
      const apexFraction = toFraction(construct.apexX)
      if (!bridged) {
        const free = construct.topTied ? construct.band.base : construct.band.top
        const apex = freeAt(construct.apexX)
        lines.push([
          { fraction: homeFraction, elevation: free },
          { fraction: apexFraction, elevation: apex },
        ])
        continue
      }
      // ``overlayFaces`` treats every entry in ``lines`` as a CLOSED ring
      // with wrap-around — a 2-point entry is a harmless no-op duplicate
      // segment, but pushing every sample as ONE array would wrap the last
      // point back to the first and close a spurious loop. Push consecutive
      // PAIRS.
      let prev = { fraction: homeFraction, elevation: freeAt(atFraction(homeFraction)) }
      for (let i = 1; i <= FLANK_STEPS; i++) {
        const fraction = homeFraction + ((apexFraction - homeFraction) * i) / FLANK_STEPS
        const next = { fraction, elevation: freeAt(atFraction(fraction)) }
        lines.push([prev, next])
        prev = next
      }
    }
    // The lens flanks. An EXTENDED lens (facing sub-TD, continues full
    // thickness — see ``extendsToFar``) has no pinch, so no flank: its own
    // level horizontals below bound its window across the whole gap.
    for (const construct of constructs) {
      if (construct.emit !== 'lens' || construct.apexX === undefined) continue
      if (construct.extendsToFar === true) continue
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
  // A gap no run brackets is answered by the nearest carrying test on each
  // side — never by every column the family has anywhere in the section (see
  // ``nearestFamilyColumns``; owner dogfeed 2026-08-22, the greener silt quad
  // left of B3). Used for BOTH jobs a column does here: stating its own
  // levels as lines, and offering candidates to the dominant-mass step.
  const oneSided = run === null ? nearestFamilyColumns(columns, gapIndex) : null
  const levelColumns =
    oneSided ?? columns.filter((c) => c.ci === run!.left.ci || c.ci === run!.right.ci)
  const stated = new Set<string>()
  const held = new Set<string>()
  const contactKeyOf = (ci: number, elevation: number): string =>
    `${ci}@${Math.round(elevation * 1000)}`
  for (const construct of constructs) {
    for (const [rides, elevation] of [
      [construct.topTied, construct.band.top],
      [construct.baseTied, construct.band.base],
    ] as const) {
      ;(rides ? stated : held).add(contactKeyOf(construct.band.ci, elevation))
    }
  }
  // A BRIDGED ONLAP'S OWN FREE CONTACT ALREADY HAS ITS LINE — the flank drawn
  // above (owner code-hunt finding, 2026-08-22, the real CS1 S10 bottom MD
  // sand: an onlap's untied side pinches DIAGONALLY from its own level
  // toward the tie it rides — that is exactly what the flank line states.
  // Falling through to this generic "held contact gets a flat line" pass
  // drew a SECOND, UNCONDITIONAL, whole-gap-width horizontal at the band's
  // own flat level — which disagrees with the flank everywhere past the
  // point the diagonal has already pinched below it, splitting the true
  // wedge into the flank's correct sliver near the apex and a spurious
  // flat-topped remainder nearer the facing column. That remainder's own
  // sample point then falls OUTSIDE the onlap's ``claims()`` window (already
  // pinched past it), so an unrelated welded-contact construct riding the
  // SAME tie line from the other side — with no termination clause of its
  // own (2-tie ``emit==='nothing'`` spans are unbounded, by design) — claims
  // it instead: the S10 bottom MD sand's own territory near S8 painted as
  // S11's VD sand.
  //
  // Scoped to the BRIDGED case only (home column outside this gap's own
  // [0, 1] — see the flank loop below): an ordinary onlap's own flat level
  // sits exactly AT its own column edge, where the diagonal flank and the
  // flat horizontal coincide by construction (t(x)=0 there) — suppressing it
  // model-wide dropped a real boundary an owner-pinned real-data scene
  // relies on (S13b/S14).
  const onlapFlank = new Set<string>()
  for (const construct of constructs) {
    if (construct.emit !== 'onlap' || construct.apexX === undefined) continue
    const homeFraction = toFraction(construct.band.x)
    if (homeFraction >= 0 && homeFraction <= 1) continue
    const free = construct.topTied ? construct.band.base : construct.band.top
    onlapFlank.add(contactKeyOf(construct.band.ci, free))
  }
  // A CONTACT IS SHARED, and the two bands meeting at it can disagree about
  // whose line it is: one rides the tie, the other holds its own level because
  // the mass over there closed its loop. Then the flat line is a real boundary
  // and has to be drawn — suppressing it because the OTHER band rides let one
  // face span both sides of it, and the face's own sample decided for the
  // whole: S6's thin silt lost its own log to the big silt above it at f=0.98.
  for (const key of held) stated.delete(key)
  for (const column of levelColumns) {
    for (const band of column.bands) {
      const topKey = `${band.ci}@${Math.round(band.top * 1000)}`
      const baseKey = `${band.ci}@${Math.round(band.base * 1000)}`
      if (!stated.has(topKey) && !onlapFlank.has(topKey)) horizontal(band.top)
      if (!stated.has(baseKey) && !onlapFlank.has(baseKey)) horizontal(band.base)
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
  // A band that emits NOTHING owns the ground between the lines it follows. Two
  // of them reaching into each other share those lines, so the nearer test wins
  // each half and the seam falls in the middle by itself — his vertical.
  const spanning = constructs.filter((c) => c.emit === 'nothing')
  const framePaint = painterOrder(gapPaint)
  // *"Silt SF fills that whole gap because all the rest is closed"* (owner,
  // 2026-08-21). The rest of the ground belongs to the mass this cover IS, and a
  // mass that emitted an onlap is still that mass: its onlap is where it meets
  // the facing test, not a renunciation of its own ground. Excluding every
  // shaped band from the remainder was an invention of mine, and it is what
  // painted the facing test's thin closed interbeds across half his silt cover —
  // the spiked comb he circled. Only a LENS drops out, and only at the levels it
  // closed on (see the remainder rungs below).
  const answering = oneSided ?? [run!.left, run!.right]
  const allBands = answering.flatMap((c) => c.bands)
  // *"the remainder of each closed loop goes to the OPEN mass"* — a band that
  // emitted a lens or an onlap has CLOSED its loop and takes no remainder
  // ground (owner, 2026-08-21: *"the MD sand onlaps, that means it is a closed
  // loop in that gap and cannot fill the gap"*). A band that emitted nothing —
  // welded, or welded at one end and holding its own level at the other — is
  // the open mass, and his gap-0 loop is the D sand's for exactly that reason.
  const closedAtMiddle = new Set<string>()
  for (const construct of constructs) {
    if (construct.emit === 'nothing') continue
    closedAtMiddle.add(construct.band.layerId)
  }
  // A band's own shaped construct, by layer — the remainder consults it so a
  // closed shape is never re-inflated by the ground above its own pinch (see
  // pickDominant). Nearest-apex wins if a layer somehow shapes twice.
  const shapedByLayer = new Map<string, BandConstruct>()
  for (const construct of constructs) {
    if (construct.emit !== 'onlap' || construct.apexX === undefined) continue
    const prev = shapedByLayer.get(construct.band.layerId)
    if (prev === undefined) shapedByLayer.set(construct.band.layerId, construct)
  }
  /**
   * *"emit lenses first, then emit onlaps"* — the construct that claims a
   * sample, in the law's own order.
   *
   * Nearest test first where two of a kind cover the same point — and on ONE
   * test, the band that owns this very level answers before its neighbours.
   * Two spanning constructs of the same column both claim the ground between
   * their lines where those lines cross a neighbour's window, and without this
   * the stack order decided it: S6's own thin silt lost its own log to the big
   * silt above it (S16c, at f=0.9 beside S6).
   */
  const constructOwner = (x: number, y: number): RunBand | null => {
    for (const tier of FILL_ORDER.map((step) =>
      step === 'lens' ? lenses : step === 'onlap' ? onlaps : spanning,
    )) {
      let best: [number, number] | null = null
      let band: RunBand | null = null
      for (const construct of tier) {
        if (!claims(construct, x, y)) continue
        const rank: [number, number] = [
          y <= construct.band.top && y >= construct.band.base ? 1 : 0,
          -Math.abs(construct.band.x - x),
        ]
        if (best === null || rank[0] > best[0] || (rank[0] === best[0] && rank[1] > best[1])) {
          best = rank
          band = construct.band
        }
      }
      if (band !== null) return band
    }
    return null
  }

  const labelled: LabelledFace<RunBand>[] = []
  const preMerge: (SectionRegion & { role: 'construct' | 'fill' })[] = []
  const residual: SectionRegion[] = []
  let remainderAreaM2 = 0
  let splitRemainders = 0
  const probeFaces: ProbeFace[] = []
  for (const face of faces) {
    const frame = coverAt(framePaint, face.sample.fraction, face.sample.elevation)
    // Outside this family's litho cover, or inside a face another family owns.
    if (frame === null || !own.has(frame)) continue
    const x = atFraction(face.sample.fraction)
    const y = face.sample.elevation
    // A STACKED SEAM HALF ANSWERS FOR ITSELF — *"keep mtaw lvl"*. Neither the
    // constructs nor the ladder are consulted there: both draw shapes that
    // slope, and the ruling is that they do not. The half is its own test's
    // stack, flat, and its holes take the least dense neighbour.
    const seamSide = stackedSeam === null ? null : x < middleX ? stackedSeam.left : stackedSeam.right
    let band: RunBand | null =
      seamSide === null ? constructOwner(x, y) : seamHalfBand(seamSide, y, densityRankOf)
    // A seam half is a FILL, not a construct: no line the law drew bounds it,
    // so the pre-merge audit must not measure it as a construct envelope.
    const answeredByConstruct = seamSide === null && band !== null
    if (seamSide !== null) {
      if (band !== null) remainderAreaM2 += areaM2(face.ring, width)
    } else if (band === null) {
      // "then fill in the rest with the dominant lithology"
      // The loop's own extent AT THIS POINT'S vertical, not over its whole
      // width: a loop between two dipping tie lines is one band's ground at one
      // end and the facing band's at the other, and measuring the dominance
      // across the whole loop hands a thin band's own ground to whichever mass
      // is thicker over there. Beside its own test, a band's own levels are the
      // ones that count (owner, 2026-08-20 — a test owns the ground beside it).
      const { lo, hi } = ringSpanAt(face.ring, face.sample.fraction)
      // WHO OWNS THE REST — the widening circles, the closed-loop rule and the
      // 2026-08-24 seam all live in ``remainderLadder.ts``. The own-shape guard
      // it applies holds on EVERY rung, the last one included: dropping it
      // there (as the walls do) reopens the defect outright — in his gap 19
      // every band in the run is closed, so the ground in the onlap own shadow
      // falls all the way through and the onlap takes it back.
      const dominant = pickRemainder({
        flankBands: allBands,
        familyBands: columns.flatMap((c) => c.bands),
        closedAtMiddle,
        middle: middleX,
        lo,
        hi,
        x,
        y,
        massKeyOf,
        drawnTies,
        closureBars,
        shapedByLayer,
      })
      band = dominant.band
      if (band !== null) {
        remainderAreaM2 += areaM2(face.ring, width)
        if (dominant.split) splitRemainders += 1
      }
    }
    if (fillGapProbe.enabled) {
      probeFaces.push({
        owner: band === null ? null : band.layerId,
        role: band === null ? 'residual' : answeredByConstruct ? 'construct' : 'fill',
        sample: [face.sample.fraction, face.sample.elevation],
        ring: face.ring.map((p) => [p.fraction, p.elevation]),
      })
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
    labelled.push({ key: massKeyOf(band), label: band, ring: face.ring })
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
        // Same MASS, not same row — a region welded across a geological
        // boundary covers bands of both duplicate formation rows.
        if (massKeyOf(band) !== massKeyOf(label)) continue
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
  if (fillGapProbe.enabled) {
    fillGapProbe.entries.push({
      gapIndex,
      coverLayers: cover.flatMap((r) => r.layerIds ?? []),
      ties: ties.map((t) => ({
        key: t.key,
        leftCi: t.leftCi,
        leftY: t.leftY,
        rightCi: t.rightCi,
        rightY: t.rightY,
      })),
      constructs: constructs.map((c) => ({
        layer: c.band.layerId,
        ci: c.band.ci,
        top: c.band.top,
        base: c.band.base,
        emit: c.emit,
        topTied: c.topTied,
        baseTied: c.baseTied,
        extendsToFar: c.extendsToFar,
      })),
      lines: lines.map((line) => line.map((p) => [p.fraction, p.elevation])),
      faces: probeFaces,
    })
  }
  return { covered, residual, remainderAreaM2, splitRemainders, preMerge }
}
