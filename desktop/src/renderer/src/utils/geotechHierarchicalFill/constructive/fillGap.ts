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
 * *"fill in the rest with the dominant lithology"* — of the tests that read
 * this ground, the band that occupies most of the loop's own levels owns it.
 *
 * Where two tests read the same levels and disagree, the overlap alone cannot
 * choose — and that is exactly the case his law draws a VERTICAL LINE IN THE
 * MIDDLE for, so the loop already lies on one side of it and the test on that
 * side owns it. Counted (``splitRemainders``) so the case stays visible.
 */
function pickDominant(
  candidates: readonly RunBand[],
  closedAtMiddle: ReadonlySet<string>,
  middle: number,
  lo: number,
  hi: number,
  x: number,
  y: number,
  massKeyOf: (band: RunBand) => string,
  drawnTies: readonly RunTie[],
  closureBars: ReadonlyMap<string, readonly number[]>,
): { band: RunBand | null; split: boolean } {
  let best: RunBand | null = null
  let bestScore: [number, number, number, number] | null = null
  let split = false
  for (const band of candidates) {
    // A CLOSURE'S STATEMENT ENDS AT ITS PINCH, RUN-WIDE. The per-gap middle
    // rule below only knows the closures THIS gap drew; a band that closed a
    // loop (lens or onlap) in another gap read as open here and its ground
    // walked past its own pinch (S8's D answering the sub-TD window two gaps
    // over). The bar list is absolute: no rung, walls on or off, hands
    // ground across one.
    const bars = closureBars.get(band.layerId)
    if (bars !== undefined && bars.some((barX) => (x - barX) * (band.x - barX) < 0)) continue
    // A CLASS MAY NEVER CROSS A CORRELATION (the standing absolute, and the
    // owner's 2026-08-21 spills: the deep VD answering ground ABOVE its own
    // top tie line — over the D|MD correlation, and below S10 whose base is
    // tied both ways). A candidate separated from this ground by any drawn
    // correlation line answers nothing here; level lines are not walls (the
    // sub-TD reach below a band's own untied base stays legal).
    const bandMid = (band.top + band.base) / 2
    const separated = drawnTies.some((tie) => {
      const atSample = y - tieElevAt(tie, x)
      const atBand = bandMid - tieElevAt(tie, band.x)
      return atSample !== 0 && atBand !== 0 && atSample > 0 !== atBand > 0
    })
    if (separated) continue
    // NO PER-SLIVER "IS THIS BAND'S OWN RANGE CLOSED" CHECK HERE (owner
    // code-hunt finding C2, 2026-08-22, "two agreeing tests must not have
    // their stack inverted mid-gap"): there used to be one, comparing a
    // band's ORIGINAL [base,top] window against the CURRENT LOOP's span —
    // but near a lens's own apex the loop has already narrowed past the
    // band's nominal window, so that check excluded the band from a sliver
    // that was still, geometrically, its own ground, while an UNRELATED
    // band (whose own closed range simply didn't happen to overlap that
    // narrow sliver) slipped through as "open" and won by default — a full
    // stack swap between two identical, uncorrelated logs. The callers
    // (below) already exclude every genuinely-closed band from the OPEN
    // rungs by full-band identity (``closedAtMiddle``, whole-band, not
    // sliver-overlap); once a rung falls through to candidates that MAY be
    // closed, the ordinary scoring (own-level, covers, nearest, thickest)
    // decides — the enclosing-mass case it used to protect resolves the
    // same way via thickness, without a separate exclusion to get wrong.
    // A CLOSED STATEMENT ENDS AT THE MIDDLE. *"if it is different then vertical
    // line in the middle"* — the line is where the two masses stop, so a band
    // that drew a lens, an onlap or a vertical may not be handed remainder
    // ground on the FAR side of it either. Without this the very dense sand's
    // vertical construct stopped at the middle exactly as the law says, and
    // then the fill walked it across anyway and painted the facing test's own
    // half (his S12 scene, ZAND-8 where ZAND-6 stands).
    if (closedAtMiddle.has(band.layerId) && (x - middle) * (band.x - middle) < 0) continue
    const covers = Math.min(band.top, hi) - Math.max(band.base, lo)
    const gapToLevel = covers > 0 ? 0 : Math.max(lo - band.top, band.base - hi)
    // 1. DOES THIS MASS OWN THIS VERY LEVEL — not merely overlap the loop's
    //    span. Ranking on the span let a thick neighbour that reaches into the
    //    loop outrank the band the sample is actually inside, and that painted
    //    over thin logs at their own test (11 own-column samples on his model).
    //    The own-column rule is absolute and outranks thickness.
    // 2. the nearer test, because a test owns the ground beside it;
    // 3. how big the mass is — *"fill in the rest with the dominant lithology"*,
    //    which is what tells his 5.6 m SF silt from a 0.5 m interbed on the
    //    facing test whose own loop has already closed.
    const ownsLevel = y <= band.top && y >= band.base
    const score: [number, number, number, number] = [
      ownsLevel ? 1 : 0,
      covers > 0 ? 1 : -gapToLevel,
      -Math.abs(band.x - x),
      band.top - band.base,
    ]
    let better = bestScore === null
    if (bestScore !== null) {
      for (let k = 0; k < score.length; k++) {
        if (score[k] > bestScore[k] + 1e-9) {
          better = true
          break
        }
        if (score[k] < bestScore[k] - 1e-9) break
      }
    }
    if (
      best !== null &&
      bestScore !== null &&
      score.every((v, k) => Math.abs(v - (bestScore as number[])[k]) <= 1e-9) &&
      massKeyOf(best) !== massKeyOf(band)
    ) {
      split = true
    }
    if (better) {
      best = band
      bestScore = score
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
    if (seamMeets(constructs, run.left.ci, run.right.ci)) {
      vertical(toFraction((run.left.x + run.right.x) / 2))
    }
    // THE ONLAP FLANK — the free contact closing onto its tie at the
    // termination. Without this line the arrangement has no edge along the
    // wedge's underside: one face spans the wedge AND the ground beyond it, the
    // face's own sample lands outside the wedge, and the onlap loses its own
    // column edge to whatever fills there (his gap-0 MD sand, painted D at
    // f=0.98 beside its own test). The lens flanks below have always been
    // inserted for exactly this reason; a pinching onlap needs it just as much.
    for (const construct of constructs) {
      if (construct.emit !== 'onlap' || construct.apexX === undefined) continue
      const free = construct.topTied ? construct.band.base : construct.band.top
      const apex = construct.topTied
        ? construct.baseAt(construct.apexX)
        : construct.topAt(construct.apexX)
      lines.push([
        { fraction: toFraction(construct.band.x), elevation: free },
        { fraction: toFraction(construct.apexX), elevation: apex },
      ])
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
  const levelColumns =
    run === null ? columns : columns.filter((c) => c.ci === run.left.ci || c.ci === run.right.ci)
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
  // A CONTACT IS SHARED, and the two bands meeting at it can disagree about
  // whose line it is: one rides the tie, the other holds its own level because
  // the mass over there closed its loop. Then the flat line is a real boundary
  // and has to be drawn — suppressing it because the OTHER band rides let one
  // face span both sides of it, and the face's own sample decided for the
  // whole: S6's thin silt lost its own log to the big silt above it at f=0.98.
  for (const key of held) stated.delete(key)
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
  const answering = run === null ? columns : [run.left, run.right]
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
  const middleX = run === null ? Number.NaN : (run.left.x + run.right.x) / 2

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
    // "emit lenses first, then emit onlaps" — nearest test first where two of a
    // kind cover the same point.
    let band: RunBand | null = null
    // The law's own order: lenses, then onlaps, then the rest — and "the rest"
    // is the ground between two masses a vertical stands in, then the dominant
    // mass of whatever is left.
    for (const tier of FILL_ORDER.map((step) =>
      step === 'lens' ? lenses : step === 'onlap' ? onlaps : spanning,
    )) {
      // Nearest test first, because a test owns the ground beside it — and on
      // ONE test, the band that owns this very level answers before its
      // neighbours. Two spanning constructs of the same column both claim the
      // ground between their lines where those lines cross a neighbour's
      // window, and without this the stack order decided it: S6's own thin silt
      // lost its own log to the big silt above it (S16c, at f=0.9 beside S6).
      let best: [number, number] | null = null
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
      // *"the remainder of each closed loop goes to the OPEN mass"* — and that
      // is ABSOLUTE (owner 2026-08-21, again on the S12|S7 quad: a lens'
      // level-scoped exclusion let it take ground OUTSIDE its own levels, and
      // a closed SILT interbed painted the SF cover below its neighbour's
      // base). While ANY open band can answer, only open bands are asked; a
      // closed construct is consulted solely in the nobody-open-can fallback
      // (the CF4/CF6 all-closed holes).
      // THE RUN'S OTHER TESTS ANSWER WHERE THE FLANKS CANNOT (owner
      // 2026-08-21, the S8|S6 deep VD passing under two shallow tests): the
      // correlated band's ground runs through gaps whose flanking tests never
      // reached it, and its owners stand on the run's other columns.
      //
      // So the ground asks in widening circles — the two flanks first, then
      // the whole family; open masses first, then closed ones — and the WALLS
      // hold in every circle. Only when every circle is walled out does the
      // last one drop the walls, because a wall chooses BETWEEN candidates and
      // may never un-class ground (measured: 345 cells of KLEI-23 went to
      // hatch without that last resort).
      const familyBands = columns.flatMap((c) => c.bands)
      const open = (bs: readonly RunBand[]): RunBand[] =>
        bs.filter((b) => !closedAtMiddle.has(b.layerId))
      // THE LAST RUNG'S WALL-DROP IS FOR A POCKET SOME OTHER TIE WALLS OFF BY
      // ACCIDENT, NEVER FOR GROUND GENUINELY ON THE FAR SIDE OF ITS OWN
      // CORRELATION (owner code-hunt finding B4, 2026-08-22): dropping the
      // wall lets the ladder pick the nearest candidate BY ELIMINATION even
      // when nothing actually relates to this ground positionally — undivided
      // head above a tie, near the far test, picked up the class that exists
      // only BELOW that same tie. So the last rung answers only when its
      // winner genuinely owns or covers the sample's own levels; a winner
      // that is merely "closest, nothing else was left" is refused, same as
      // finding nothing at all.
      const lastRungMustBeRelevant = (winner: RunBand | null): RunBand | null => {
        if (winner === null) return null
        const ownsLevel = y <= winner.top && y >= winner.base
        const covers = Math.min(winner.top, hi) - Math.max(winner.base, lo) > 0
        return ownsLevel || covers ? winner : null
      }
      const rungs: [readonly RunBand[], readonly RunTie[], boolean][] = [
        [open(allBands), drawnTies, false],
        [open(familyBands), drawnTies, false],
        [allBands, drawnTies, false],
        [familyBands, drawnTies, false],
        [familyBands, [], true],
      ]
      let dominant: { band: RunBand | null; split: boolean } | null = null
      for (const [candidates, walls, isLastRung] of rungs) {
        if (candidates.length === 0) continue
        dominant = pickDominant(candidates, closedAtMiddle, middleX, lo, hi, x, y, massKeyOf, walls, closureBars)
        if (isLastRung) dominant = { ...dominant, band: lastRungMustBeRelevant(dominant.band) }
        if (dominant.band !== null) break
      }
      band = dominant?.band ?? null
      if (band !== null) {
        remainderAreaM2 += areaM2(face.ring, width)
        if (dominant?.split === true) splitRemainders += 1
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
