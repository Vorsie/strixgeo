/**
 * PHASE 1 — THE LINES. What the law (``emitKernel.ts``) decides, drawn.
 *
 * Owner, 2026-08-19: *"we said first draw all lines, lenses, onlaps, vertical
 * lines, this makes closed loops, then we fill everything and merge it"* ·
 * *"the lines are the structural framework, the fill is to fill all gaps, the
 * merge is to reduce the dimensions to a manageable level"*.
 *
 * This module is geometry, and it takes no decision of its own: for every band
 * of a family on the two tests a gap runs between it works out the ties on its
 * CONTACTS, reads what each shows at the other end, asks ``emitFor``, and draws
 * that. Three things it must get right, and all three are his words:
 *
 *  * **a tie is drawn on a CONTACT, and a contact is shared.** The clay-top tie
 *    under a sand band is that sand band's bottom tie — *"it has a top and
 *    bottom tie to the right though?"* So ties are counted per contact,
 *    whichever of the two adjoining bands the stored row happens to name.
 *  * **the other end of a tie is the band on the SAME SIDE of the contact
 *    there.** *"top dense sand has one tie, follow the tie, it is the same
 *    litho and packing density don't emit onlap"* — the tie under that sand
 *    lands on the sand|silt contact of the facing test, and what continues is
 *    the sand ABOVE it, not the silt below.
 *  * **an untied contact holds the band's own level** — unless it IS the parent
 *    unit's own contact, where it follows the SOIL's own line (ruling A, litho
 *    approval carries down). 2/1/0 counts packing ties — and, since 2026-08-26,
 *    a cover boundary whose far band is the SAME MASS, which is a weld and not
 *    a statement between packings (``coverWeld.ts``).
 *
 * @module utils/geotechHierarchicalFill/constructive/constructs
 */

import { carryReachTies, taperBetween, type BandCarry } from './carriedTaper'
import { readsWindow } from './columnReading'
import { coverContactOf, type CoverContact } from './coverWeld'
import { emitFor, sameMass, type Emit, type Mass } from './emitKernel'
import { CONTACT_EPS, farBandOf } from './farBand'
import { freeContactAt, restOnlapsOnPinches, type FreeVertex } from './onlapRestsOn'
import { LENS_PINCH_FRACTION, type CorrelationEdge, type PartitionColumn } from '../../sectionPartition'
import { edgeKey } from '../../partitionFillV2/crossingConflicts'

/** Smallest lens reach (fraction of the gap) — below this the lens is a hair. */
const MIN_REACH_FRACTION = 1e-3
/** Samples along a lens flank when testing it against a tie line. */
const LENS_COLLISION_SAMPLES = 8

/** One packing band, in absolute elevation, on a known column. */
export interface RunBand {
  layerId: string
  formationId: string
  bodyId: string | null
  /** Top elevation (mTAW). */
  top: number
  /** Base elevation (mTAW). */
  base: number
  /** Frame column index it stands on. */
  ci: number
  /** Along-section position of that column, in metres. */
  x: number
  /** Whether this contact of the band IS its parent litho unit's own contact. */
  atCoverTop?: boolean
  atCoverBase?: boolean
  /** Set while the band is crossing ground no test read — see {@link BandCarry}. */
  carry?: BandCarry
}

/** One banded column of a family. */
export interface RunColumn {
  ci: number
  x: number
  /** Its bands of this family, shallowest first. */
  bands: RunBand[]
}

/** A packing tie between two bands, as a straight line. */
export interface RunTie {
  /** Order-invariant identity of the correlation edge it came from. */
  key: string
  leftCi: number
  rightCi: number
  leftX: number
  rightX: number
  leftY: number
  rightY: number
}

/** One band's construct in one gap: what the law emits, and where it lies. */
export interface BandConstruct {
  band: RunBand
  emit: Emit
  /** Top boundary at along-x (``lens`` / ``onlap`` / ``vertical`` only). */
  topAt: (x: number) => number
  /** Base boundary at along-x. */
  baseAt: (x: number) => number
  /** Along-x at which a lens closes. */
  apexX?: number
  /**
   * The elevation of an ONLAP's apex — its two contacts' single shared vertex
   * at {@link apexX}, computed ONCE (owner, 2026-08-25: *"if you draw the
   * onlap into a triangle onto the tie, you just have to verify by
   * coordinates, midpoint tie coordinate is end of onlap coordinate and you
   * have a closed loop?"*). The fill's flank line ends on THIS value rather
   * than re-deriving it, so the wedge closes exactly and no epsilon is
   * involved. Lenses carry none: both their flanks are already drawn to the
   * band's own mid-level, one value, shared by construction.
   */
  apexElev?: number
  /**
   * An ONLAP's FREE contact, stated ONCE, as a polyline from the band's own
   * column to {@link apexX} (see ``onlapRestsOn.ts``). Two vertices for the
   * ordinary straight closing line; three where the ruling of 2026-08-26 rests
   * it on the construct it shares that contact with.
   *
   * {@link topAt}/{@link baseAt} evaluate THIS on the free side, and
   * ``fillGap``'s flank pass draws THIS — line and claim state one shape by
   * construction rather than by two parallel derivations, which is exactly what
   * the plunging-tie bug was.
   */
  freeVertices?: readonly FreeVertex[]
  /**
   * The construct continues to the facing column instead of pinching — set
   * when the facing test has no band at any of this band's levels (sub-TD
   * ground: nothing over there to meet; owner 2026-08-21, "it should be a
   * continuous band starting from S7"). ``claims`` skips its middle cut for
   * these: the far half is nobody else's to answer.
   */
  extendsToFar?: boolean
  /**
   * The TRUE apex of a CARRIED band's taper — gaps away, past this gap's own far
   * column (owner ruling 2026-08-25, *"one smooth taper"*; see
   * ``carriedTaper.ts``). Set only alongside {@link extendsToFar}, and it does
   * NOT replace {@link apexX}: that stays the far column, so the closure bar
   * this construct contributes and the ownership rules that read it are exactly
   * what they were. This field says only where the flank line is drawn TO.
   */
  carryApexX?: number
  /**
   * Whether each contact's line IS its tie — i.e. the construct RIDES it. A
   * contact that does not ride holds the band's own level instead, so it is a
   * boundary of its own and the fill must draw it: without that line the face
   * runs on up to a tie this band never claimed, and the mass climbs a wedge
   * that is somebody else's statement.
   */
  topTied: boolean
  baseTied: boolean
  /** The far column's along-x — a vertical construct owns its own side of it. */
  farX: number
}

/** Identity of one contact: its column and its elevation, on the mm grid. */
const contactKey = (ci: number, elevation: number): string =>
  `${ci}@${Math.round(elevation * 1000)}`

/** The family bands of one column, shallowest first. */
export function runBandsOf(
  column: PartitionColumn | undefined,
  ci: number,
  x: number,
): RunBand[] {
  if (column === undefined) return []
  return [...column.units]
    .sort((a, b) => a.topDepthM - b.topDepthM)
    .map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      bodyId: u.bodyId,
      top: column.surfaceElevM - u.topDepthM,
      base: column.surfaceElevM - u.baseDepthM,
      ci,
      x,
    }))
}

/**
 * Resolve packing ties into straight lines, and report the crossings.
 *
 * Owner ruling Q4: crossing approved ties are a HARD CONFLICT — neither bands.
 * Both edges are dropped, so their bands fall back to the no-tie construct, and
 * the pair is reported for the warning chip. The scan is a symmetric pairwise
 * comparison, so it cannot depend on the order the rows arrived in.
 *
 * @param edges Candidate packing edges (cross-family ones already dropped).
 * @param columns The family's banded columns of ONE run, left to right.
 * @param bandAt Every packing band of the section, by ``layerId`` — a tie's end
 *   may name a band of a neighbouring family that shares the contact.
 * @returns The surviving ties and the crossing pairs (run-gap indexed).
 */
export function resolveRunTies(
  edges: readonly CorrelationEdge[],
  columns: readonly RunColumn[],
  bandAt: ReadonlyMap<string, RunBand>,
): { ties: RunTie[]; crossings: { runGap: number; keys: [string, string] }[] } {
  const indexOfColumn = new Map<number, number>()
  columns.forEach((column, index) => indexOfColumn.set(column.ci, index))
  /** Contact elevations of THIS family, per column — what a line may bound. */
  const familyContacts = new Set<string>()
  for (const column of columns) {
    for (const band of column.bands) {
      familyContacts.add(contactKey(column.ci, band.top))
      familyContacts.add(contactKey(column.ci, band.base))
    }
  }
  const raw: (RunTie & { loIndex: number; hiIndex: number })[] = []
  for (const edge of edges) {
    const aBand = bandAt.get(edge.a)
    const bBand = bandAt.get(edge.b)
    if (aBand === undefined || bBand === undefined) continue
    // ONE END IN THE RUN IS ENOUGH (owner, 2026-08-21: *"two ties is two tied
    // contacts"*). The line is drawn between two real tests, so it bounds the
    // contact it lands on here whatever lies at its other end — including a
    // column this family has no bands on. Demanding both ends inside the run
    // dropped the tie he drew on the SF silt's base and the band read as a
    // one-tie onlap instead of the band he ruled it to be. An outside endpoint
    // is placed by its own position along the section so the line still crosses
    // the same ground.
    const inRunA = indexOfColumn.get(aBand.ci)
    const inRunB = indexOfColumn.get(bBand.ci)
    if (inRunA === undefined && inRunB === undefined) continue
    const indexFor = (band: RunBand, exact: number | undefined): number => {
      if (exact !== undefined) return exact
      let position = 0
      while (position < columns.length && columns[position].x < band.x) position += 1
      return position - 0.5
    }
    const aIndex = indexFor(aBand, inRunA)
    const bIndex = indexFor(bBand, inRunB)
    if (aIndex === bIndex) continue
    const aY = (edge.aSide ?? 'top') === 'base' ? aBand.base : aBand.top
    const bY = (edge.bSide ?? 'top') === 'base' ? bBand.base : bBand.top
    if (
      !familyContacts.has(contactKey(aBand.ci, aY)) &&
      !familyContacts.has(contactKey(bBand.ci, bY))
    ) {
      continue
    }
    const a = { band: aBand, index: aIndex }
    const b = { band: bBand, index: bIndex }
    const [lo, hi, loY, hiY] = a.index < b.index ? [a, b, aY, bY] : [b, a, bY, aY]
    if (Math.abs(hi.band.x - lo.band.x) < 1e-9) continue
    raw.push({
      key: edgeKey(edge),
      leftCi: lo.band.ci,
      rightCi: hi.band.ci,
      leftX: lo.band.x,
      rightX: hi.band.x,
      leftY: loY,
      rightY: hiY,
      loIndex: lo.index,
      hiIndex: hi.index,
    })
  }
  const crossings: { runGap: number; keys: [string, string] }[] = []
  const suspended = new Set<string>()
  const reported = new Set<string>()
  for (let gap = 0; gap + 1 < columns.length; gap++) {
    const xa = columns[gap].x
    const xb = columns[gap + 1].x
    const here = raw.filter((t) => t.loIndex <= gap && t.hiIndex >= gap + 1)
    for (let i = 0; i < here.length; i++) {
      for (let j = i + 1; j < here.length; j++) {
        const p = here[i]
        const q = here[j]
        if (p.key === q.key) continue
        const dA = tieElevAt(p, xa) - tieElevAt(q, xa)
        const dB = tieElevAt(p, xb) - tieElevAt(q, xb)
        if (Math.abs(dA) <= CONTACT_EPS || Math.abs(dB) <= CONTACT_EPS || dA * dB >= 0) continue
        suspended.add(p.key)
        suspended.add(q.key)
        const pairKey = p.key <= q.key ? `${p.key}~${q.key}` : `${q.key}~${p.key}`
        if (reported.has(pairKey)) continue
        reported.add(pairKey)
        crossings.push({ runGap: gap, keys: [p.key, q.key] })
      }
    }
  }
  return { ties: raw.filter((t) => !suspended.has(t.key)), crossings }
}

/** A tie's elevation at along-x (straight line between its two endpoints). */
export function tieElevAt(tie: RunTie, x: number): number {
  const width = tie.rightX - tie.leftX
  if (Math.abs(width) < 1e-9) return tie.leftY
  return tie.leftY + ((x - tie.leftX) / width) * (tie.rightY - tie.leftY)
}

/** Does this tie cross the gap between run columns ``left`` and ``right``? */
function crossesGap(tie: RunTie, left: RunColumn, right: RunColumn): boolean {
  const lo = Math.min(tie.leftCi, tie.rightCi)
  const hi = Math.max(tie.leftCi, tie.rightCi)
  return lo <= left.ci && hi >= right.ci
}

/**
 * The tie bounding one CONTACT of one column across this gap, or null.
 *
 * A contact is shared by the bands above and below it, so a tie drawn on it
 * bounds both. Where several ties name the same contact (a fan), the one
 * reaching the facing test wins, then the nearest partner, then the lowest far
 * elevation: deterministic, never dependent on row order.
 */
function tieOnContact(
  ties: readonly RunTie[],
  ci: number,
  elevation: number,
  left: RunColumn,
  right: RunColumn,
): RunTie | null {
  const facing = ci === left.ci ? right.ci : left.ci
  let best: RunTie | null = null
  let bestScore: [number, number, number] | null = null
  for (const tie of ties) {
    if (!crossesGap(tie, left, right)) continue
    const onLeft = tie.leftCi === ci && Math.abs(tie.leftY - elevation) <= CONTACT_EPS
    const onRight = tie.rightCi === ci && Math.abs(tie.rightY - elevation) <= CONTACT_EPS
    if (!onLeft && !onRight) continue
    const farCi = onLeft ? tie.rightCi : tie.leftCi
    const farY = onLeft ? tie.rightY : tie.leftY
    const score: [number, number, number] = [farCi === facing ? 0 : 1, Math.abs(farCi - ci), farY]
    if (
      bestScore === null ||
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] &&
        (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))
    ) {
      best = tie
      bestScore = score
    }
  }
  return best
}

/**
 * Does ANY tie of this contact's FAN reach a same-mass far end?
 *
 * A contact may carry several ties (the fan — owner ruling 2026-08-21: the
 * extra tie is the far layer's pinch statement, not a second tied contact of
 * this band's). The far-end read must survey them ALL, run-wide: one same-mass
 * end welds the contact whatever the others say. Reading only one tie of the
 * fan let B2's MD tail read its S10 end — nothing there, the ground is below
 * S10's TD — and call itself an onlap, while its jump tie to S6's own MD said
 * WELD the whole time (owner: "the dense sand onlaps so the MD should fill").
 * A tie whose far side holds no band states nothing about the mass.
 */
function fanWeldsSameMass(
  ties: readonly RunTie[],
  band: RunBand,
  elevation: number,
  above: boolean,
  stacks: ReadonlyMap<number, readonly RunBand[]>,
  own: Mass,
  massOf: (band: RunBand) => Mass,
): boolean {
  for (const tie of ties) {
    const onLeft = tie.leftCi === band.ci && Math.abs(tie.leftY - elevation) <= CONTACT_EPS
    const onRight = tie.rightCi === band.ci && Math.abs(tie.rightY - elevation) <= CONTACT_EPS
    if (!onLeft && !onRight) continue
    const far = farBandOf(tie, band.ci, elevation, above, stacks)
    if (far !== null && sameMass(own, massOf(far))) return true
  }
  return false
}

/**
 * The lens reach: {@link LENS_PINCH_FRACTION}, HALVED while its diamond would
 * cross a tie line (the litho engine's own ruling 8t — *"just halve the length
 * to 0.225"*). A lens may never cross a correlation: the line is the statement.
 */
function lensReach(band: RunBand, gapTies: readonly RunTie[], xFar: number): number {
  const mid = (band.top + band.base) / 2
  const crosses = (reach: number): boolean => {
    const apexX = band.x + reach * (xFar - band.x)
    for (const tie of gapTies) {
      for (let s = 0; s <= LENS_COLLISION_SAMPLES; s++) {
        const t = s / LENS_COLLISION_SAMPLES
        const x = band.x + t * (apexX - band.x)
        const line = tieElevAt(tie, x)
        const top = band.top - t * (band.top - mid)
        const base = band.base + t * (mid - band.base)
        if (line < top && line > base) return true
      }
    }
    return false
  }
  let reach = LENS_PINCH_FRACTION
  while (reach > MIN_REACH_FRACTION && crosses(reach)) reach /= 2
  return Math.max(reach, MIN_REACH_FRACTION)
}

/**
 * Every construct of one gap — the law applied band by band, with no reference
 * to any other band's outcome.
 *
 * @param left, right The gap's two banded columns of the run.
 * @param ties The surviving packing ties that may bound this family's contacts.
 * @param coverTies The LITHO lines, resolved the same way — consulted only for
 *   an untied contact that is the parent unit's own boundary.
 * @param stacks EVERY packing band per column, for the far-end read.
 * @param massOf The mass (litho + packing) of a band.
 * @returns One construct per band of the two columns, in stack order.
 */
export function buildGapConstructs(
  left: RunColumn,
  right: RunColumn,
  ties: readonly RunTie[],
  coverTies: readonly RunTie[],
  stacks: ReadonlyMap<number, readonly RunBand[]>,
  massOf: (band: RunBand) => Mass,
): BandConstruct[] {
  const gapTies = ties.filter((t) => crossesGap(t, left, right))
  const gapCoverTies = coverTies.filter((t) => crossesGap(t, left, right))
  const out: BandConstruct[] = []
  for (const column of [left, right]) {
    const xFar = column.ci === left.ci ? right.x : left.x
    const facing = column.ci === left.ci ? right : left
    for (const band of column.bands) {
      const topTie = tieOnContact(gapTies, band.ci, band.top, left, right)
      const baseTie = tieOnContact(gapTies, band.ci, band.base, left, right)
      // The band sits BELOW its own top contact and ABOVE its own base contact.
      const farEnds: Mass[] = []
      const own = massOf(band)
      // RULING A, THE GEOMETRY HALF (owner code-hunt finding, 2026-08-22): an
      // untied contact that IS the parent litho unit's own boundary follows the
      // accepted LITHO tie there instead of holding the band's own flat level.
      //
      // ...AND THE WELD HALF (owner, 2026-08-26 — see ``coverWeld.ts``):
      // *"the tops of all tests are connected? follow the tie, same nad class,
      // emit nothing."* Where the far band across that boundary is the SAME
      // MASS the contact counts as TIED for the law as well, because a weld is
      // not a statement between packings — which is the one thing Ruling A
      // exists to prevent, and the only case where it still applies in full.
      const topCover =
        topTie === null && band.atCoverTop === true
          ? coverContactOf(
              band,
              'top',
              tieOnContact(gapCoverTies, band.ci, band.top, left, right),
              column,
              facing,
              stacks,
              own,
              massOf,
            )
          : null
      const baseCover =
        baseTie === null && band.atCoverBase === true
          ? coverContactOf(
              band,
              'base',
              tieOnContact(gapCoverTies, band.ci, band.base, left, right),
              column,
              facing,
              stacks,
              own,
              massOf,
            )
          : null
      // WHOSE LINE IS IT? *"follow tie"* moves a contact onto its line — but a
      // line the mass over there has already spoken for is not this band's to
      // ride. Three cases, and the third is the owner's vertical:
      //   same far mass                -> ride: the line is a weld line;
      //   different, and I am the onlap-> ride: the onlap IS my statement
      //                                  about that line;
      //   different, far mass is OPEN  -> ride: *"two ties is two tied
      //     (two tied contacts of its own)   contacts"* makes it a band too, so
      //                                  we share the quad between our two
      //                                  lines and meet at the vertical in the
      //                                  middle (*"left is MD right is D"*);
      //   different, far mass CLOSED   -> hold my own level: its lens or onlap
      //                                  is the statement about that line, and
      //                                  riding it is the wedge he circled on
      //                                  gap 0 (*"why does this dense sand
      //                                  onlap, 1 tie = follow line, same
      //                                  packing = no onlap"*).
      const contested = { top: false, base: false }
      for (const [side, tie, elevation, above] of [
        ['top', topTie, band.top, false],
        ['base', baseTie, band.base, true],
      ] as const) {
        if (tie === null) continue
        const far = farBandOf(tie, band.ci, elevation, above, stacks)
        // A TIE WHOSE FAR SIDE IS EMPTY states nothing about the mass — then,
        // and only then, the contact's FAN speaks run-wide: any same-mass end
        // on another of its ties welds it (see ``fanWeldsSameMass``). A real
        // far end across THIS gap keeps its own read — a band welds one way
        // and onlaps the other, and the weld must not erase the onlap.
        if (far === null && fanWeldsSameMass(ties, band, elevation, above, stacks, own, massOf)) {
          farEnds.push(own)
          continue
        }
        const farMass = far === null ? { litho: '', packing: '' } : massOf(far)
        farEnds.push(farMass)
        if (far === null || sameMass(own, farMass)) continue
        const farTiedContacts =
          (tieOnContact(gapTies, far.ci, far.top, left, right) === null ? 0 : 1) +
          (tieOnContact(gapTies, far.ci, far.base, left, right) === null ? 0 : 1)
        // ONE CONTACT, ONE GEOMETRY (owner 2026-08-21, twice in one day — the
        // S10|S6 silt strip, *"the onlapping silt that should band"*, and the
        // S11 MD sand *"spills over the correlation band with the very dense
        // sand below"*): a contact is shared by two band pairs, and when the
        // pair on the OTHER side of it is the same mass, their weld puts the
        // contact ON its tie line — so this band rides that line too, whatever
        // its own far end reads, ON BOTH HALVES. Holding a flat level instead
        // left a wedge between level and line that the band's own log then
        // claimed — the MD paint inside the very dense sand's correlation
        // band. A far pinching onlap owns only its own half above the line and
        // never conflicts with the ride; the dense mass under a welded contact
        // fills UP TO the line on its own half (which is also the answer to
        // the S17 remainder triangle — the ground is this family's cover, so
        // the mass below the line takes it, to the line and no further).
        const localOpposite =
          (stacks.get(band.ci) ?? []).find((b) =>
            above
              ? Math.abs(b.top - elevation) <= CONTACT_EPS
              : Math.abs(b.base - elevation) <= CONTACT_EPS,
          ) ?? null
        const farOpposite = farBandOf(tie, band.ci, elevation, !above, stacks)
        const weldedAcross =
          localOpposite !== null &&
          farOpposite !== null &&
          sameMass(massOf(localOpposite), massOf(farOpposite))
        // Open over there (two tied contacts of its own) = we meet in the
        // middle, so the line is shared and both ride it.
        contested[side] = !weldedAcross && farTiedContacts < 2
      }
      // A WELDED COVER BOUNDARY IS A TIED CONTACT. Its far end is the band's own
      // mass by definition of the weld, so it can only ever say *"emit
      // nothing"* — alone (one tied contact, same mass) or alongside a packing
      // tie (two tied contacts is a band). It never turns anything into an
      // onlap, and it never contests: nobody is disagreeing about the line.
      for (const cover of [topCover, baseCover]) {
        if (cover !== null && cover.welds) farEnds.push(own)
      }
      // ONE TIE IS ONE ONLAP, AND THICKNESS IS NEVER CONSULTED (owner ruling
      // 2026-08-25, on his TS12 scene — a 0.41 m loose sand carrying a single
      // tie to a 4.26 m medium-dense sand): *"no it has one tie on top, so it
      // should onlap that same tie."* Where both bands share that single tie
      // and read different masses, BOTH onlap it and both pinch at the middle
      // — *"both tests will emit onlaps in this case depending on what test you
      // start from"*. So the law's own answer is the only answer here; nothing
      // between the far-end read and the emit weighs the two masses.
      const emit = emitFor(own, farEnds)
      const flat = (y: number) => () => y
      // A TWO-TIED-CONTACT BAND FOLLOWS BOTH ITS TIES, UNCONDITIONALLY (owner
      // code-hunt finding A4, 2026-08-22): the 2026-08-21 ruling — "two tied
      // contacts ... emits NOTHING whatever the far ends read" — is absolute,
      // and that absoluteness has to reach the GEOMETRY too, not just the
      // classification. ``contested`` exists to resolve a genuine collision
      // between two COMPETING one-tie statements about the same line; a band
      // with two tied contacts has already been told by the law it spans
      // regardless of what either far end says, so there is no collision left
      // to resolve — withholding the ride left its BASE holding a flat level
      // metres away from the tie it is provably tied to (a band whose top
      // welds via the fan while its base reads a real, different mass at the
      // far end).
      const bothTied = topTie !== null && baseTie !== null
      const ridesTop = topTie !== null && (bothTied || !(contested.top && emit !== 'onlap'))
      const ridesBase = baseTie !== null && (bothTied || !(contested.base && emit !== 'onlap'))
      // An untied cover contact rides the accepted LITHO line instead of the
      // band's own flat level (Ruling A) — or, where no litho tie is stored,
      // the cover's own edge to the same-mass band it welds to. A stored line
      // is ridden whatever the far mass reads, exactly as it has been since
      // 2026-08-22; an IMPLICIT edge is nobody's drawn correlation and earns
      // its line only by welding (``coverWeld.ts``).
      const ridesCover = (cover: CoverContact | null): boolean =>
        cover !== null && (cover.stored || cover.welds)
      const topAt = ridesTop
        ? (x: number) => tieElevAt(topTie as RunTie, x)
        : ridesCover(topCover)
          ? (x: number) => tieElevAt((topCover as CoverContact).tie, x)
          : flat(band.top)
      const baseAt = ridesBase
        ? (x: number) => tieElevAt(baseTie as RunTie, x)
        : ridesCover(baseCover)
          ? (x: number) => tieElevAt((baseCover as CoverContact).tie, x)
          : flat(band.base)
      // AN ONLAP PINCHES ONTO ITS OWN LINE (owner, 2026-08-21, on the picture he
      // then confirmed — *"Yes that's it, that has always been the rule, you got
      // it right before on the litho stage"*): it rides its tie and closes on it
      // at the termination. It never ends in a vertical cut and never takes
      // remainder ground — *"the MD sand onlaps, that means it is a closed loop
      // in that gap and cannot fill the gap."*
      if (emit === 'onlap') {
        const tie = (topTie ?? baseTie) as RunTie
        const apexX = (band.x + xFar) / 2
        // THE APEX IS ONE VERTEX, COMPUTED ONCE (owner's verification contract,
        // 2026-08-25 — see ``apexElev``). ``free + 1 * (line - free)`` is
        // algebraically the line, but it rounds a ULP away from it for about
        // one pair of elevations in ten (measured), and a ULP-wide gap between
        // the wedge's two edges is a loop the arrangement is entitled to mint.
        // So the free contact returns the LINE's own value once it has arrived,
        // and this same number is what the fill draws its flank onto.
        const apexElev = tieElevAt(tie, apexX)
        // THE FREE CONTACT CONVERGES ON THE APEX — one FIXED vertex, not the
        // tie's moving height. Owner dogfeed 2026-08-26, *"still not
        // onlapping"*, on Tie-section 12: S6's 0.41 m loose sand emitted its
        // onlap and painted nothing, the medium sand beside it taking the whole
        // wedge.
        //
        // Chasing the line — ``free + t·(tie(x) − free)`` — is quadratic in t,
        // and it opens a gap of
        //
        //     top − base = (1 − t)·(h + Δ·t)
        //
        // for a band of thickness ``h`` whose tie falls by ``Δ`` from its own
        // column to the termination. A PLUNGING tie has Δ < 0, so as soon as it
        // drops further over that half-gap than the band is thick the wedge
        // turns inside out at t = h/|Δ| and stays that way. S6's numbers are
        // h = 0.41 and Δ = −2.51: the band could claim the first 16 % of its own
        // half-gap and nothing at all of the other 84 %, because ``claims`` ends
        // in ``top > base``. It is the standing ruling of 2026-08-22 —
        // *"where a band's own construct speaks, it speaks completely"* — broken
        // by arithmetic rather than by a rule.
        //
        // Converging on ``apexElev`` gives ``top − base = h·(1 − t)``: a clean
        // taper to zero for ANY plunge, which is also the straight flank the
        // fill has always DRAWN for this construct (see ``fillGap``'s onlap
        // flank pass). Line and claim now state one shape instead of two.
        //
        // The free contact is stated ONCE, as the polyline ``freeVertices``, and
        // evaluated by ``freeContactAt`` — whose arithmetic over two vertices is
        // exactly the interpolation this comment describes, and which the
        // 2026-08-26 ruling then gives a middle vertex where the closing line
        // would otherwise wrap under the construct below (``onlapRestsOn.ts``).
        // ``fillGap`` draws the same vertices, so there is no second derivation
        // of this shape anywhere.
        const freeVertices: FreeVertex[] = [
          { x: band.x, y: topTie !== null ? band.base : band.top },
          { x: apexX, y: apexElev },
        ]
        const freeAt = (x: number): number => freeContactAt(freeVertices, x)
        out.push({
          band,
          emit,
          apexX,
          apexElev,
          freeVertices,
          farX: xFar,
          topTied: topTie !== null,
          baseTied: baseTie !== null,
          topAt: topTie !== null ? (x) => tieElevAt(tie, x) : freeAt,
          baseAt: baseTie !== null ? (x) => tieElevAt(tie, x) : freeAt,
        })
        continue
      }
      if (emit === 'lens') {
        // A LENS FACING NO DATA CONTINUES (owner 2026-08-21 night, on S7's
        // thin interbeds rendered as phantom pinches around short S7A: "it
        // should be a continuous band starting from S7 but now it is
        // interrupted at S7A's column"). The pinch exists to MEET the facing
        // test's reading; where the facing column has no band at any of this
        // band's levels — the ground over there is below its TD — there is
        // nothing to meet, and the band continues to that column at full
        // thickness. Adoption carries it on from there, and it still pinches
        // in the first gap whose facing test DID read that ground.
        const facingCi = column.ci === left.ci ? right.ci : left.ci
        // The SAME question ``bandContinuation`` asks of the same stack — one
        // predicate, so a column can never read as "has data" here and "blind"
        // there, which is what let a band close twice (``columnReading.ts``).
        const facingHasData = readsWindow(stacks.get(facingCi), band.top, band.base)
        if (!facingHasData) {
          // ...BUT IT IS STILL CLOSING WHILE IT CROSSES (owner ruling
          // 2026-08-25, *"option 1, one smooth taper ofcourse"* — see
          // ``carriedTaper.ts``). Where a column further out DOES read the
          // band's levels, ``bandContinuation`` has already resolved which one,
          // and the pinch this gap's ground belongs to is measured against THAT
          // column. Running flat to the blind column and then starting the next
          // gap part-pinched put a step in the band at the one place on the
          // section where nothing was measured. The apex itself is untouched:
          // the same ``lensReach`` question, asked of the same terminal gap's
          // ties, so the carried gaps and the terminal gap draw ONE line.
          //
          // SCOPED TO THE BLIND FACING COLUMN, deliberately. Where the facing
          // test DID read this ground — even as another family's soil — it has
          // a statement of its own there, the termination clause applies with
          // full force (*"an onlap can't paint over ground near test itself"*),
          // and the band closes within its own half as it always has. Letting
          // the carry govern that case too was measured on the owner's CS3 and
          // pushed a lens's apex PAST the middle, where ``claims`` then cut it
          // at the seam — a wedge cut instead of closed, which is the shape he
          // has already reported five times.
          //
          // With no carry at all the blind column IS the run's own edge —
          // nothing beyond it ever reads this ground, there is no apex to close
          // on, and the flat curtain stays the final answer
          // (``terminationRun``'s ``reads: false``).
          //
          // ``apexX`` deliberately stays the FAR COLUMN here: it is what this
          // construct contributes as a closure bar and what ``claims`` cuts on,
          // and neither of those meanings changed. The taper's own apex travels
          // separately, in ``carryApexX``.
          const carry: BandCarry | undefined = band.carry
          const carried =
            carry === undefined
              ? null
              : band.x +
                lensReach(band, carryReachTies(ties, carry), carry.farX) * (carry.farX - band.x)
          out.push({
            band,
            emit,
            apexX: xFar,
            farX: xFar,
            extendsToFar: true,
            carryApexX: carried ?? undefined,
            topTied: topTie !== null,
            baseTied: baseTie !== null,
            ...(carried === null
              ? { topAt: flat(band.top), baseAt: flat(band.base) }
              : taperBetween(band, carried)),
          })
          continue
        }
        const reach = lensReach(band, gapTies, xFar)
        const apexX = band.x + reach * (xFar - band.x)
        out.push({
          band,
          emit,
          apexX,
          farX: xFar,
          topTied: topTie !== null,
          baseTied: baseTie !== null,
          ...taperBetween(band, apexX),
        })
        continue
      }
      // A WELDED cover contact reports TIED: its line is the cover's own edge,
      // which the arrangement already carries as a cover-ring edge, so adding
      // the band's flat horizontal there would cut a sliver off a boundary the
      // band never held (``fillGap``'s "every band's own level" pass). A STORED
      // cover tie that does NOT weld keeps reporting untied, exactly as it has
      // since Ruling A: the two masses genuinely disagree about that line and
      // the flat one is a real boundary.
      out.push({
        band,
        emit,
        farX: xFar,
        topTied: ridesTop || topCover?.welds === true,
        baseTied: ridesBase || baseCover?.welds === true,
        topAt,
        baseAt,
      })
    }
  }
  // AN ONLAP RESTS ON WHAT IT SITS ON (owner, 2026-08-26 — see
  // ``onlapRestsOn.ts``). A SECOND PASS deliberately: the ruling compares an
  // onlap's free contact against the FINISHED construct sharing that contact,
  // and the loop above builds a column's bands shallowest first, so the mass
  // below an onlap does not exist yet when the onlap is emitted. Nothing about
  // the law's own decisions is revisited here — only where one already-emitted
  // free contact is drawn.
  return restOnlapsOnPinches(out)
}

/**
 * Does this gap's constructs draw the vertical "two statements meet" seam?
 *
 * *"if it is different then vertical line in the middle"* — the line exists
 * ONLY where two statements MEET: two onlaps reaching from opposite tests, or
 * two open ('nothing') masses spanning into each other. A LONE onlap or a
 * lone open mass — the tie's far side is empty, or nothing on the facing test
 * disagrees — has nobody on the facing side to meet, so no seam is drawn and
 * the ground fills through instead (the SF silt case). Reviewer finding
 * (2026-08-22): the onlap half of this rule was previously "ANY onlap
 * anywhere in the gap", which drew the seam even when the facing test had
 * nothing there at all.
 *
 * @param constructs Every construct of the gap.
 * @param leftCi The left flank's column index.
 * @param rightCi The right flank's column index.
 */
export function seamMeets(
  constructs: readonly BandConstruct[],
  leftCi: number,
  rightCi: number,
): boolean {
  const on = (emit: Emit, ci: number): boolean =>
    constructs.some((c) => c.emit === emit && c.band.ci === ci)
  return (
    (on('onlap', leftCi) && on('onlap', rightCi)) ||
    (on('nothing', leftCi) && on('nothing', rightCi))
  )
}

/**
 * Does a construct's own shape contain the point (x, y)?
 *
 * A ``vertical`` construct owns the window between its two ties on ITS OWN SIDE
 * of the line the law draws in the middle — *"if it is different then vertical
 * line in the middle"*, and *"left is MD right is D"*.
 */
export function claims(construct: BandConstruct, x: number, y: number): boolean {
  // "emit nothing" means no NEW line — not that the band has no ground. Its two
  // contacts are the lines it follows (its ties, or its own level where untied)
  // and the ground between them is its own. It is NOT capped at the middle: the
  // mass at the other end of those ties is the SAME litho and packing, so the
  // two halves paint one class either way and the merge welds them into the one
  // body the law asks for.
  if (construct.emit === 'nothing') {
    const top = construct.topAt(x)
    const base = construct.baseAt(x)
    return y <= top && y >= base && top > base
  }
  // THE TERMINATION CLAUSE (owner, 2026-08-20): *"an onlap can't paint over
  // ground near test itself, it terminates at 0.5 Distance approximately."*
  // It governs EVERY construct, not just the onlap: a construct is one test's
  // statement about the ground, so it owns at most its OWN HALF of the gap and
  // the far half belongs to the far test's constructs and its dominant fill.
  // Without it a construct riding a tie reached the facing column and painted
  // over ground that test itself measured — 44 of 1120 own-column-edge samples
  // on his model before this clause, 0 after.
  // An EXTENDED construct owns its window to the facing column: the ground on
  // the far half is below that test's TD, so there is no facing statement for
  // the middle to protect (see ``extendsToFar``).
  if (construct.extendsToFar !== true) {
    const middle = (construct.band.x + construct.farX) / 2
    if ((x - middle) * (construct.farX - middle) > 0) return false
    if (construct.apexX !== undefined) {
      const from = construct.band.x
      if ((x - from) * (construct.apexX - from) < 0) return false
      if (Math.abs(x - from) >= Math.abs(construct.apexX - from)) return false
    }
  }
  const top = construct.topAt(x)
  const base = construct.baseAt(x)
  return y <= top && y >= base && top > base
}
