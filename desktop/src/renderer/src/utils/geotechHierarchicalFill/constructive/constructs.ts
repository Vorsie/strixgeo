/**
 * PHASE 1 — THE LINES. Every 2/1/0 construct of one family, drawn before any
 * area exists.
 *
 * Owner, 2026-08-19: *"we said first draw all lines, lenses, onlaps, vertical
 * lines, this makes closed loops, then we fill everything and merge it"* — and
 * *"the lines are the structural framework, the fill is to fill all gaps, the
 * merge is to reduce the dimensions to a manageable level"*.
 *
 * This module is the framework half. It resolves, for every band of a family on
 * the two tests a gap runs between, the ONE construct the 2/1/0 law gives it,
 * and hands back both the LINES that construct draws and the CLAIM it makes —
 * a point predicate, so no emission order can ever decide anything:
 *
 *  * **2 ties → SPAN.** The band is bracketed: a tie on its top contact and a
 *    tie on its base contact. Its construct is the quad between those two
 *    lines, column edge to column edge. Never an onlap, never a pinch, no reach
 *    factor. Ties are counted on the band's CONTACTS, not on its layer id — a
 *    contact is shared with the neighbour above or below, and a tie drawn on it
 *    (whichever of the two layers the row happens to name) bounds both bands.
 *    That is the owner's own reading: *"it has a top and bottom tie to the
 *    right though? ... i said it was absolute"*.
 *  * **1 tie → ONLAP.** The tied contact follows its tie line; the untied
 *    contact stays flat at the band's own elevation. The construct closes by
 *    itself where the two meet — the interval between them is empty past the
 *    crossing — and is cut off by the family's litho cover.
 *  * **0 ties → LENS or LEVEL.** An interbed enclosed by the SAME class above
 *    and below on its own column closes as a lens at its own level (apex
 *    {@link LENS_PINCH_FRACTION} of the gap, halved while it would cross a tie
 *    line — ruling 8t), and the wrapper's mass owns its level beyond the apex.
 *    Any other untied band holds its own level into the gap and meets the
 *    facing test's own reading at the vertical termination between them, which
 *    is the owner's standing ruling for two data-backed masses: *"it should get
 *    a vertical termination in the middle left is MD right is D"*.
 *
 * WHICH TEST OWNS A POINT: the NEARER one, always. Its construct is asked
 * first; only where it claims nothing does the facing test's construct answer.
 * That single rule is the vertical termination — it puts the fence exactly
 * halfway between the two tests — and it is why a 2-tie band fills its own half
 * absolutely and takes the whole gap wherever the facing test reads nothing.
 *
 * @module utils/geotechHierarchicalFill/constructive/constructs
 */

import { LENS_PINCH_FRACTION, type CorrelationEdge, type PartitionColumn } from '../../partitionFill'
import { edgeKey } from '../../partitionFillV2/crossingConflicts'

/** Elevation tolerance (m) at which two contacts are the same contact. */
const CONTACT_EPS = 1e-6
/** Smallest lens reach (fraction of the gap) — below this the lens is a hair. */
const MIN_REACH_FRACTION = 1e-3
/** Samples along a lens flank when testing it against a tie line. */
const LENS_COLLISION_SAMPLES = 8

/** One packing band of a family, in absolute elevation, on a known column. */
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
  /**
   * Whether this contact of the band IS the family cover's own boundary on this
   * column — the parent litho unit's own top / base. An UNTIED contact there is
   * not a level the band chose: it is where the soil ends, and the litho model
   * already says where that goes (its own tie). So the band follows the cover
   * rather than holding a flat level that leaves a wedge of its own soil
   * unclaimed beside it — which is the owner's dark clay quad on gap 2, where a
   * single band IS the whole unit on its column and the cover rises past it.
   */
  atCoverTop?: boolean
  atCoverBase?: boolean
}

/** One banded column of a family. */
export interface RunColumn {
  ci: number
  x: number
  /** Its bands of this family, shallowest first. */
  bands: RunBand[]
}

/** A packing tie between two bands of one family, as a straight line. */
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

/** What the 2/1/0 law makes of one band in one gap. */
export type ConstructKind = 'span' | 'onlap' | 'lens' | 'level'

/** One band's construct in one gap: its two boundaries and where it ends. */
export interface BandConstruct {
  band: RunBand
  kind: ConstructKind
  /** Top boundary at along-x. */
  topAt: (x: number) => number
  /** Base boundary at along-x. */
  baseAt: (x: number) => number
  /**
   * Along-x at which the construct stops (a lens apex). Undefined ⇒ it reaches
   * both tests; the ownership rule, not the shape, decides where it yields.
   */
  apexX?: number
}

/** Identity of one contact: its column and its elevation, on the mm grid. */
const contactKey = (ci: number, elevation: number): string =>
  `${ci}@${Math.round(elevation * 1000)}`

/** The family bands of one column, shallowest first. */
export function runBandsOf(column: PartitionColumn | undefined, ci: number, x: number): RunBand[] {
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
 * Resolve a family's packing ties into straight lines, and report the crossings.
 *
 * Owner ruling Q4 (design partition-engine-v2 §8): crossing approved ties are a
 * HARD CONFLICT — neither bands. Both edges are dropped from the tie set, so
 * their bands fall back to the 0-tie construct, and the pair is reported for the
 * warning chip. The scan is a symmetric pairwise comparison, so it cannot depend
 * on the order the rows arrived in.
 *
 * A TIE IS DRAWN ON A CONTACT, AND A CONTACT IS SHARED. The owner counts the
 * clay-top tie under a sand band as that sand band's bottom tie — *"it has a top
 * and bottom tie to the right though?"* — and he is right: the line lands on the
 * contact, and the contact bounds the band above it as much as the band below.
 * So the tie set offered here is every packing tie whose two ends stand on this
 * run's two columns, whichever bands the row happens to name, as long as one of
 * its ends lands on a contact of THIS family (a line elsewhere in the section
 * bounds nothing here). Cross-family ties — a clay band tied to a sand band —
 * are excluded by the caller: they state a contact, not one mass, and cannot
 * bound anything.
 *
 * @param edges Candidate packing edges (cross-family ones already dropped).
 * @param columns The family's banded columns of ONE run, left to right.
 * @param bandAt Every packing band of the section, by ``layerId`` — a tie's end
 *   may name a band of a NEIGHBOURING family that shares the contact.
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
    const aIndex = indexOfColumn.get(aBand.ci)
    const bIndex = indexOfColumn.get(bBand.ci)
    if (aIndex === undefined || bIndex === undefined || aIndex === bIndex) continue
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
  // Crossings, gap by gap: two lines that swap vertical order between the gap's
  // two columns cross inside it. A jump tie is compared in every gap it spans.
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
 * bounds both — which is why the count is taken on contacts and not on layer
 * ids. Where several ties name the same contact (a fan), the one reaching the
 * facing test wins, then the nearest partner, then the lowest far elevation:
 * deterministic, and never dependent on row order.
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
 * Does an untied band CLOSE AS A LENS here, or hold its own level?
 *
 * Two conditions, and both are the owner's own words rather than a size rule:
 *
 *  1. **It has a mass to hand its level to.** A lens pinches out and something
 *    else takes the ground it vacates — *"top circle should be a lens ... the
 *    level beyond that loop belongs to the class that wraps it"* (S11). Only an
 *    interbed the SAME class encloses above and below on its own column has
 *    such a wrapper; the top or bottom band of a stack, or one sandwiched
 *    between two different classes, has nothing to hand its level to, so it
 *    holds it (which is also the adoption a deep test's stack gets below a
 *    short test's TD).
 *  2. **There is nothing to pinch out AGAINST.** A pinch-out says the mass ends
 *    laterally. Where the facing test READ that ground and called it something
 *    else, the mass does not end — the two readings meet, and the owner's
 *    standing ruling for two data-backed masses is a vertical termination
 *    between them, not a pinch (*"it should get a vertical termination in the
 *    middle left is MD right is D"*). That is S6: the facing test read the
 *    interbed's levels as one band of the wrapper's class, so its own reading
 *    stays whole beside it — *"there the SF silt is one band, it gets split
 *    below TD at S8? why?"*. Where the facing test never reached those levels
 *    (S11: its unit ends metres above), nothing competes and the lens closes.
 *
 * @param bands The band's own column stack, shallowest first.
 * @param index Its position in that stack.
 * @param facing The facing test's bands of this family.
 * @returns Whether the 0-tie construct is a lens rather than a level.
 */
function closesAsLens(
  bands: readonly RunBand[],
  index: number,
  facing: readonly RunBand[],
): boolean {
  const band = bands[index]
  const above = bands[index - 1]
  const below = bands[index + 1]
  if (above === undefined || below === undefined) return false
  if (above.formationId !== below.formationId) return false
  if (above.formationId === band.formationId) return false
  if (
    Math.abs(above.base - band.top) > CONTACT_EPS ||
    Math.abs(below.top - band.base) > CONTACT_EPS
  ) {
    return false
  }
  for (const other of facing) {
    if (Math.min(other.top, band.top) - Math.max(other.base, band.base) > CONTACT_EPS) return false
  }
  return true
}

/**
 * The lens reach for one untied interbed: {@link LENS_PINCH_FRACTION}, HALVED
 * while its diamond would cross a tie line (owner ruling 8t, 2026-07-20 —
 * *"retire the thickness hug, just halve the length to 0.225"*). A lens may
 * never cross a correlation: the line is the statement, the lens is the guess.
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
 * Every construct of one gap: the 2/1/0 law applied to each band of the gap's
 * two tests, with no reference to any other band's outcome.
 *
 * @param left, right The gap's two banded columns of the run.
 * @param ties The surviving packing ties that may bound this family's contacts.
 * @param coverTies The LITHO lines, resolved the same way — consulted only for
 *   an untied contact that is the parent unit's own boundary (see below).
 * @returns One construct per band of the two columns, in stack order.
 */
export function buildGapConstructs(
  left: RunColumn,
  right: RunColumn,
  ties: readonly RunTie[],
  coverTies: readonly RunTie[] = [],
): BandConstruct[] {
  const gapTies = ties.filter((t) => crossesGap(t, left, right))
  const out: BandConstruct[] = []
  for (const column of [left, right]) {
    const xFar = column.ci === left.ci ? right.x : left.x
    column.bands.forEach((band, index) => {
      const topTie = tieOnContact(gapTies, band.ci, band.top, left, right)
      const baseTie = tieOnContact(gapTies, band.ci, band.base, left, right)
      // An untied contact holds the band's own level — UNLESS that contact is
      // the cover's own boundary and the LITHO model drew a line for it. There
      // the contact is not a level the band chose but where the SOIL ends, and
      // litho approval carries down (ruling A): the soil's own tie says where
      // it goes, so the band's contact follows it. It is a BOUNDARY only —
      // 2/1/0 counts PACKING ties, so a litho-lined band with no packing tie is
      // still a 0-tie band that closes its own loop, and a deleted packing tie
      // stays deleted.
      const flat = (y: number) => () => y
      const coverLine = (atCover: boolean | undefined, y: number): ((x: number) => number) => {
        if (atCover !== true) return flat(y)
        const line = tieOnContact(coverTies, band.ci, y, left, right)
        return line === null ? flat(y) : (x: number) => tieElevAt(line, x)
      }
      const ownTop = coverLine(band.atCoverTop, band.top)
      const ownBase = coverLine(band.atCoverBase, band.base)
      if (topTie !== null && baseTie !== null) {
        out.push({
          band,
          kind: 'span',
          topAt: (x) => tieElevAt(topTie, x),
          baseAt: (x) => tieElevAt(baseTie, x),
        })
        return
      }
      if (topTie !== null || baseTie !== null) {
        out.push({
          band,
          kind: 'onlap',
          topAt: topTie !== null ? (x) => tieElevAt(topTie, x) : ownTop,
          baseAt: baseTie !== null ? (x) => tieElevAt(baseTie, x) : ownBase,
        })
        return
      }
      const facing = column.ci === left.ci ? right.bands : left.bands
      if (!closesAsLens(column.bands, index, facing)) {
        out.push({ band, kind: 'level', topAt: ownTop, baseAt: ownBase })
        return
      }
      const reach = lensReach(band, gapTies, xFar)
      const apexX = band.x + reach * (xFar - band.x)
      const mid = (band.top + band.base) / 2
      const span = apexX - band.x
      const t = (x: number): number => (Math.abs(span) < 1e-9 ? 1 : (x - band.x) / span)
      out.push({
        band,
        kind: 'lens',
        apexX,
        topAt: (x) => band.top - Math.min(1, Math.max(0, t(x))) * (band.top - mid),
        baseAt: (x) => band.base + Math.min(1, Math.max(0, t(x))) * (mid - band.base),
      })
    })
  }
  return out
}

/** Does a construct claim the point (x, y)? */
export function claims(construct: BandConstruct, x: number, y: number): boolean {
  if (construct.apexX !== undefined) {
    const from = construct.band.x
    if ((x - from) * (construct.apexX - from) < 0) return false
    if (Math.abs(x - from) >= Math.abs(construct.apexX - from)) return false
  }
  const top = construct.topAt(x)
  const base = construct.baseAt(x)
  return y <= top && y >= base && top > base
}

/**
 * The elevation window a construct occupies anywhere in the gap — what the
 * band has ALREADY said about its own levels here. The matrix never repeats a
 * band past its own construct (see ``matrixOwner``).
 */
export function constructWindow(
  construct: BandConstruct,
  xa: number,
  xb: number,
): { lo: number; hi: number } {
  const xs = [xa, xb, construct.apexX].filter((x): x is number => x !== undefined)
  let lo = Infinity
  let hi = -Infinity
  for (const x of xs) {
    if (x < Math.min(xa, xb) - 1e-9 || x > Math.max(xa, xb) + 1e-9) continue
    lo = Math.min(lo, construct.baseAt(x))
    hi = Math.max(hi, construct.topAt(x))
  }
  return { lo, hi }
}
