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
 *    approval carries down). A boundary only: 2/1/0 counts packing ties.
 *
 * @module utils/geotechHierarchicalFill/constructive/constructs
 */

import { emitFor, type Emit, type Mass } from './emitKernel'
import { LENS_PINCH_FRACTION, type CorrelationEdge, type PartitionColumn } from '../../partitionFill'
import { edgeKey } from '../../partitionFillV2/crossingConflicts'

/** Elevation tolerance (m) at which two contacts are the same contact. */
const CONTACT_EPS = 1e-6
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
  /** Whether each contact is stated by a tie (its line IS that tie). */
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
 * *"follow tie ... check litho and packing density on the other end"* — the
 * mass that continues past the tie, on the SAME SIDE of the contact.
 *
 * The tie lands on a contact of the facing test, and a contact has a band above
 * it and a band below it. A band sitting ABOVE its own contact continues as
 * whatever sits above the contact over there; below, below. Reading the wrong
 * side reads the neighbouring soil and calls a continuous mass a different one,
 * which is the owner's own worked example: the sand's tie lands on the facing
 * sand|silt contact and *"it is the same litho and packing density"*.
 *
 * @param tie The tie on the band's contact.
 * @param ci The band's own column index.
 * @param above Whether the band lies ABOVE the contact the tie is on.
 * @param stacks EVERY packing band per column — the far band may belong to a
 *   neighbouring family, and its mass still decides.
 * @param massOf The mass of a band.
 * @returns The far mass, or null when nothing lies on that side there.
 */
function farMassOf(
  tie: RunTie,
  ci: number,
  elevation: number,
  above: boolean,
  stacks: ReadonlyMap<number, readonly RunBand[]>,
  massOf: (band: RunBand) => Mass,
): Mass | null {
  const onLeft = tie.leftCi === ci && Math.abs(tie.leftY - elevation) <= CONTACT_EPS
  const farCi = onLeft ? tie.rightCi : tie.leftCi
  const farY = onLeft ? tie.rightY : tie.leftY
  const stack = stacks.get(farCi) ?? []
  const far = stack.find((b) =>
    above ? Math.abs(b.base - farY) <= CONTACT_EPS : Math.abs(b.top - farY) <= CONTACT_EPS,
  )
  return far === undefined ? null : massOf(far)
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
  const out: BandConstruct[] = []
  for (const column of [left, right]) {
    const xFar = column.ci === left.ci ? right.x : left.x
    for (const band of column.bands) {
      const topTie = tieOnContact(gapTies, band.ci, band.top, left, right)
      const baseTie = tieOnContact(gapTies, band.ci, band.base, left, right)
      // The band sits BELOW its own top contact and ABOVE its own base contact.
      const farEnds: Mass[] = []
      const own = massOf(band)
      for (const [tie, elevation, above] of [
        [topTie, band.top, false],
        [baseTie, band.base, true],
      ] as const) {
        if (tie === null) continue
        farEnds.push(
          farMassOf(tie, band.ci, elevation, above, stacks, massOf) ?? { litho: '', packing: '' },
        )
      }
      const emit = emitFor(own, farEnds)
      // *"follow tie"* — a tied contact IS its tie line; an untied one holds the
      // band's own level. Nothing else moves a contact.
      const flat = (y: number) => () => y
      const topAt = topTie !== null ? (x: number) => tieElevAt(topTie, x) : flat(band.top)
      const baseAt = baseTie !== null ? (x: number) => tieElevAt(baseTie, x) : flat(band.base)
      if (emit === 'lens') {
        const reach = lensReach(band, gapTies, xFar)
        const apexX = band.x + reach * (xFar - band.x)
        const mid = (band.top + band.base) / 2
        const span = apexX - band.x
        const t = (x: number): number =>
          Math.min(1, Math.max(0, Math.abs(span) < 1e-9 ? 1 : (x - band.x) / span))
        out.push({
          band,
          emit,
          apexX,
          farX: xFar,
          topTied: topTie !== null,
          baseTied: baseTie !== null,
          topAt: (x) => band.top - t(x) * (band.top - mid),
          baseAt: (x) => band.base + t(x) * (mid - band.base),
        })
        continue
      }
      out.push({
        band,
        emit,
        farX: xFar,
        topTied: topTie !== null,
        baseTied: baseTie !== null,
        topAt,
        baseAt,
      })
    }
  }
  return out
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
  const middle = (construct.band.x + construct.farX) / 2
  if ((x - middle) * (construct.farX - middle) > 0) return false
  if (construct.apexX !== undefined) {
    const from = construct.band.x
    if ((x - from) * (construct.apexX - from) < 0) return false
    if (Math.abs(x - from) >= Math.abs(construct.apexX - from)) return false
  }
  const top = construct.topAt(x)
  const base = construct.baseAt(x)
  return y <= top && y >= base && top > base
}
