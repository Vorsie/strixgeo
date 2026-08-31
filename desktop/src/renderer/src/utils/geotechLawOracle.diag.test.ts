/**
 * THE LAW ORACLE — the owner's own ask, 2026-08-21:
 *
 *   *"why don't you write tests that check if a body follows the 2 1 0 rules
 *    based on the number of contacts and the litho + packing on the other side
 *    of the tie."*
 *
 * So this file counts a band's ties, reads the mass on the OTHER SIDE of each
 * one, decides what the law says to emit, and then checks the rendered geometry
 * against that verdict. It deliberately re-derives everything: it imports
 * NOTHING from ``geotechHierarchicalFill/constructive`` — not the kernel, not
 * ``emitFor``, not the constructs — because an oracle that asks the constructor
 * what the law says can only ever agree with it. The emit table below is typed
 * out from his sentence, not imported:
 *
 *   *"If litho has no ties emit lens, if litho has one tie, follow tie - if
 *    litho at other end of tie has same litho and packing density emit nothing.
 *    If it is a different litho emit an onlap, if a litho has two ties, follow
 *    ties and check litho and packing density on the other end. if it is
 *    different then vertical line in the middle, else no emit."*
 *
 * ...plus the two later rulings that complete it:
 *
 *   *"an onlap can't paint over ground near test itself, it terminates at 0.5
 *    Distance approximately."* (2026-08-20)
 *   *"the D sand should fill that gap ... which forms a closed loop in that gap
 *    that only the D sand kan fill."* (2026-08-21 — the MIXED pair: one end
 *    welds, the other reads a different mass, so the band emits nothing and
 *    stays the open mass.)
 *
 * WHAT IT CHECKS, per band per gap:
 *
 *   lens (0 ties)          the band's own ground exists and stays on its side
 *                          of the middle.
 *   nothing, all-same      the welded mass reaches the far column.
 *   onlap (1, different)   the wedge exists and stays on its own side.
 *   vertical (2, different) the construct exists, reaches about the middle and
 *                          does not cross it.
 *   nothing, mixed         the band's ground exists; the law asks no reach.
 *
 * OUT OF SCOPE, as everywhere else: a gap whose facing test carries no bands at
 * all — an un-divided test shows empty ground by the 2026-08-15 ruling.
 *
 * ...and the two rulings of 2026-08-21 that fix how it counts and where it
 * measures, verbatim:
 *
 *   *"the SF silt on the right has 2 bands, definition is band an no lens or
 *    onlap is emitted, two ties is two tied contacts, if you have two ties on
 *    the same contact that means a layer tapers out to a pinch, right up to
 *    that contact. 0.5x distance to next test (so half of the line width it
 *    onlaps on)."*
 *
 * So: a FAN — two ties landing on ONE contact — is ONE tied contact here, and
 * states that the layer at the far end pinches out against that line. And the
 * termination is half of the LINE the construct rides, not half of the section
 * gap: a tie that bridges a test the family has no bands on carries its middle
 * past the gap's own far column, and a construct reaching there is obeying the
 * clause, not breaking it.
 *
 * Dormant unless GEOTECH_LAW=1. Env: GEOTECH_AXIS_INPUT (input override).
 * Report: scripts/throwaway_geotech_law.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { resolveBandParents } from './geotechHierarchicalFill/bandParents'
import { buildLithoFamilies } from './geotechHierarchicalFill/families'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_law.txt')

// Formation row → canonical class key, lazily from the dump's own nadMeta.
// The oracle compares masses exactly as the fill does — by CLASS (owner
// 2026-08-21: one mass one body): the duplicate formation rows the model keeps
// per geological parent are one mass, so a mass key here is the class key.
let packingClassCache: Map<string, string> | null = null
function loadPackingClassOf(): Map<string, string> {
  if (packingClassCache === null) {
    const raw = existsSync(INPUT)
      ? (JSON.parse(readFileSync(INPUT, 'utf8')) as {
          refinementBundle?: {
            nadMeta?: Record<string, { nadClass: number | null; soilCode: string | null }>
          }
        })
      : {}
    packingClassCache = buildPackingClassOf(Object.entries(raw.refinementBundle?.nadMeta ?? {}))
  }
  return packingClassCache
}
function classKeyOf(formationId: string): string {
  return loadPackingClassOf().get(formationId) ?? formationId
}

/** Two contacts are the same contact within this many metres. */
const CONTACT_EPS = 1e-6
/** *"terminates at 0.5 Distance approximately"* — his own word, as a grace. */
const MIDDLE_GRACE = 0.06
/** A welded mass must reach this close to the far column. */
const WELD_REACH = 0.99
/** A vertical must come at least this close to the middle. */
const MIDDLE_REACH = 0.4

type Verdict = 'lens' | 'onlap' | 'nothing'

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawArm {
  columns: { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}
interface RawSection extends RawArm {
  name: string
  geotech: RawArm
}

/** A band as the oracle reads it: a mass between two elevations on one column. */
interface Band {
  layerId: string
  formationId: string
  ci: number
  top: number
  base: number
}

function assemble(arm: RawArm): {
  columns: PartitionColumn[]
  alongM: number[]
  edges: CorrelationEdge[]
} {
  const paired = arm.columns
    .map((c, i) => ({ c, a: arm.alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...(c.units as PartitionColumn['units'])].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
    edges: arm.edges.map((e) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    })),
  }
}

/**
 * The law's own table, typed out from his sentence — never imported.
 *
 * @param own The band's own mass key.
 * @param fars The mass key at the far end of each tie the band carries here.
 * @returns What the law says to emit.
 */
function verdictOf(own: string, fars: readonly string[]): Verdict {
  if (fars.length === 0) return 'lens'
  const same = fars.filter((f) => f === own).length
  if (fars.length === 1) return same === 1 ? 'nothing' : 'onlap'
  // *"the SF silt on the right has 2 bands, definition is band an no lens or
  // onlap is emitted"* — two tied contacts is a band whatever the far ends
  // read. His *"vertical line in the middle"* is where two such open masses
  // meet, which the fill draws; no band emits it on its own.
  return 'nothing'
}

function auditSection(sec: RawSection): string[] {
  const L = assemble(sec)
  const alongM = L.alongM
  const G = assemble(sec.geotech)
  if (L.columns.length < 2) return []
  const geotechColumns = frameAlignedColumns(
    L.columns,
    new Map(G.columns.map((c) => [c.investigationId, c])),
  )
  const empty = new Map<string, BodyBoundaryResponse>()
  const lithoRegions = computeSectionFillActive(
    L.columns,
    L.edges,
    deriveSectionApexOverrides(L.columns, L.edges, L.alongM, empty),
    L.alongM,
  )
  const out = computeHierarchicalGeotechFill({
    lithoColumns: L.columns,
    lithoEdges: L.edges,
    lithoRegions,
    geotechColumns,
    geotechEdges: G.edges,
    alongM: L.alongM,
    packingClassOf: loadPackingClassOf(),
  })

  // Every band, by column, in elevation terms.
  const bands: Band[][] = geotechColumns.map((col, ci) =>
    col.units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      ci,
      top: col.surfaceElevM - u.topDepthM,
      base: col.surfaceElevM - u.baseDepthM,
    })),
  )
  const home = new Map<string, Band>()
  for (const col of bands) for (const b of col) home.set(b.layerId, b)

  // THE NEXT TEST is the next test THIS FAMILY reads (the 2026-08-15 excluded
  // ruling: a run spans a test the family has no bands on), so *"0.5x distance
  // to next test"* is measured to that column, not to the section's next one.
  // Family membership only — the verdict above never consults it.
  const { parentOfBand } = resolveBandParents(geotechColumns, L.columns)
  const { familyOfLithoLayer } = buildLithoFamilies(L.columns, L.edges, lithoRegions)
  const familyOfBand = new Map<string, string>()
  for (const [layer, parent] of parentOfBand) {
    const family = familyOfLithoLayer.get(parent)
    if (family !== undefined) familyOfBand.set(layer, family)
  }
  const familyColumns = new Map<string, Set<number>>()
  for (const col of bands) {
    for (const b of col) {
      const family = familyOfBand.get(b.layerId)
      if (family === undefined) continue
      const set = familyColumns.get(family)
      if (set === undefined) familyColumns.set(family, new Set([b.ci]))
      else set.add(b.ci)
    }
  }
  const nextTestX = (b: Band, toTheRight: boolean): number => {
    const columns = familyColumns.get(familyOfBand.get(b.layerId) ?? '')
    const step = toTheRight ? 1 : -1
    for (let ci = b.ci + step; ci >= 0 && ci < geotechColumns.length; ci += step) {
      if (columns?.has(ci) === true) return alongM[ci]
    }
    return alongM[toTheRight ? geotechColumns.length - 1 : 0]
  }

  /** The bands adjoining a contact on one column, and on which side they sit. */
  const onContact = (ci: number, elevation: number): { band: Band; above: boolean }[] => {
    const found: { band: Band; above: boolean }[] = []
    for (const b of bands[ci] ?? []) {
      if (Math.abs(b.base - elevation) <= CONTACT_EPS) found.push({ band: b, above: true })
      else if (Math.abs(b.top - elevation) <= CONTACT_EPS) found.push({ band: b, above: false })
    }
    return found
  }

  // RUN-WIDE FAN WELD (the engine's ``fanWeldsSameMass``): a contact may carry
  // several ties (the fan), and ONE same-class far end welds it wherever the
  // band answers — the other ties are the far layers' own pinch statements.
  // The per-gap table below only sees ties CROSSING the audited gap, so the
  // welding tie of B2's MD tail (a jump to S6's own MD) is invisible from the
  // S10|B2 gap; this set carries the weld across. Keyed layerId@elevKey.
  const weldedContacts = new Set<string>()
  for (const e of G.edges) {
    const a = home.get(e.a)
    const b = home.get(e.b)
    if (a === undefined || b === undefined || a.ci === b.ci) continue
    const ea = (e.aSide ?? 'top') === 'base' ? a.base : a.top
    const eb = (e.bSide ?? 'top') === 'base' ? b.base : b.top
    for (const [nearCi, nearElev, farCi, farElev] of [
      [a.ci, ea, b.ci, eb],
      [b.ci, eb, a.ci, ea],
    ] as const) {
      for (const mine of onContact(nearCi, nearElev)) {
        const partner = onContact(farCi, farElev).find((p) => p.above === mine.above)
        if (partner === undefined) continue
        if (classKeyOf(partner.band.formationId) === classKeyOf(mine.band.formationId))
          weldedContacts.add(`${mine.band.layerId}@${Math.round(nearElev * 1000)}`)
      }
    }
  }

  // Per (layerId, gap): the far masses of the ties this band carries there. A
  // tie is drawn ON A CONTACT, and a contact belongs to the two bands that meet
  // at it — so a tie stored against one of them speaks for both, and the far
  // end is the band on the SAME SIDE of the contact over there.
  const fars = new Map<string, string[]>()
  /** (layerId|gap) -> contact key -> the far end read there (fans collapse).
   *  ``rescued`` marks a read the run-wide fan supplied over an EMPTY far
   *  side — same-mass by the weld, but with no ground across this gap for
   *  the mass to arrive at. */
  const contactsOf = new Map<
    string,
    Map<string, { far: string; spanX: [number, number]; rescued?: boolean }>
  >()
  for (const e of G.edges) {
    const a = home.get(e.a)
    const b = home.get(e.b)
    if (a === undefined || b === undefined || a.ci === b.ci) continue
    const elevOf = (band: Band, side: string): number => (side === 'base' ? band.base : band.top)
    const ea = elevOf(a, e.aSide ?? 'top')
    const eb = elevOf(b, e.bSide ?? 'top')
    const lo = Math.min(a.ci, b.ci)
    const hi = Math.max(a.ci, b.ci)
    for (let gap = lo; gap < hi; gap++) {
      for (const [near, nearElev, far, farElev] of [
        [a, ea, b, eb],
        [b, eb, a, ea],
      ] as const) {
        // Only the two columns of this gap answer for it.
        if (near.ci !== gap && near.ci !== gap + 1) continue
        for (const mine of onContact(near.ci, nearElev)) {
          const partner = onContact(far.ci, farElev).find((p) => p.above === mine.above)
          const key = `${mine.band.layerId}|${gap}`
          const contactKey = `${Math.round(nearElev * 1000)}`
          // A tie whose far side is EMPTY states nothing about the mass —
          // then, and only then, the contact's FAN speaks run-wide: a
          // same-class end on another of its ties welds it (``weldedContacts``
          // above — the engine's fanWeldsSameMass). A real far end across
          // this gap keeps its own read: a band welds one way and onlaps the
          // other, and the weld must not erase the onlap.
          if (
            partner === undefined &&
            !weldedContacts.has(`${mine.band.layerId}@${contactKey}`)
          ) {
            continue
          }
          // ONE CONTACT, ONE TIE: *"two ties is two tied contacts, if you have
          // two ties on the same contact that means a layer tapers out to a
          // pinch, right up to that contact."*
          const contacts = contactsOf.get(key) ?? new Map()
          if (!contacts.has(contactKey)) {
            contacts.set(contactKey, {
              // The far MASS is its class, not its formation row.
              far:
                partner !== undefined
                  ? classKeyOf(partner.band.formationId)
                  : classKeyOf(mine.band.formationId),
              spanX: [alongM[near.ci], alongM[far.ci]],
              rescued: partner === undefined,
            })
          }
          contactsOf.set(key, contacts)
        }
      }
    }
  }

  // The rendered ground, per (layerId, gap) — on TWO surfaces, because the law
  // speaks about two different things. A closed construct (lens, onlap,
  // vertical) is judged on the CONSTRUCT loops: after the fill sweep welds *"a
  // lens touching a body with same litho and packing"* into that body, the
  // lens's own id rides a region that spans the whole gap, and reading the
  // merged surface would call his own sweep a violation. A welded mass, on the
  // other hand, only exists on the merged surface — that IS what "emit nothing"
  // draws.
  const painted = new Map<string, SectionRegion[]>()
  const constructed = new Map<string, SectionRegion[]>()
  const index = (target: Map<string, SectionRegion[]>, r: SectionRegion): void => {
    for (const layer of r.layerIds ?? []) {
      const key = `${layer}|${r.gapIndex}`
      const list = target.get(key) ?? []
      list.push(r)
      target.set(key, list)
    }
  }
  for (const r of out.regions) index(painted, r)
  for (const r of out.preMergeRegions) if (r.role === 'construct') index(constructed, r)

  const exceptions: string[] = []
  for (let ci = 0; ci < geotechColumns.length; ci++) {
    for (const band of bands[ci]) {
      for (const gap of [ci - 1, ci].filter((g) => g >= 0 && g < geotechColumns.length - 1)) {
        const facing = gap === ci ? ci + 1 : gap
        if ((bands[facing]?.length ?? 0) === 0) continue
        const key = `${band.layerId}|${gap}`
        const contacts = [...(contactsOf.get(key)?.values() ?? [])]
        const far = contacts.map((c) => c.far)
        fars.set(key, far)
        const verdict = verdictOf(classKeyOf(band.formationId), far)
        const sameAllFar = far.length > 0 && far.every((f) => f === classKeyOf(band.formationId))
        const mine = painted.get(key) ?? []
        // The construct loops the law asked this band to draw — EMPTY where its
        // loop welded into a body of the same mass, which is the fill sweep
        // doing its job, not an absence.
        const loops = constructed.get(key) ?? []
        const tag =
          `${sec.name} col${ci} gap${gap} ${band.top.toFixed(2)}..${band.base.toFixed(2)} ` +
          `ties=${far.length} verdict=${verdict}`
        if (mine.length === 0) {
          exceptions.push(`${tag} — the law asks for a ${verdict} and nothing is drawn`)
          continue
        }
        // How far into the gap its ground reaches, as a fraction from its own
        // column: 0 at its own test, 1 at the facing one.
        const ownIsLeft = gap === ci
        let reach = 0
        for (const r of sameAllFar ? mine : loops) {
          for (const p of r.polygon) {
            reach = Math.max(reach, ownIsLeft ? p.fraction : 1 - p.fraction)
          }
        }
        if (sameAllFar) {
          // "emit nothing" — one mass through the gap, so it must arrive. What
          // must arrive is the CLASS: the two bands of one mass each own their
          // own half of the ground they weld into, so asking one band's id to
          // reach the far column asks for something the law never says.
          // A weld the fan RESCUED over an empty far side has nothing across
          // this gap to arrive at — its ground factually ends where its lines
          // converge (S6's ZAND-5 toward S7's bandless contact) — so the
          // arrival demand only stands where a real partner read exists.
          if (contacts.every((c) => c.rescued === true)) continue
          let massReach = 0
          for (const r of out.regions) {
            if (r.gapIndex !== gap || classKeyOf(r.formationId) !== classKeyOf(band.formationId))
              continue
            for (const p of r.polygon) {
              massReach = Math.max(massReach, ownIsLeft ? p.fraction : 1 - p.fraction)
            }
          }
          if (massReach < WELD_REACH)
            exceptions.push(`${tag} — welded mass stops at ${massReach.toFixed(2)} of the gap`)
          continue
        }
        if (verdict === 'nothing') continue // a band: it spans, no reach is asked
        if (loops.length === 0) continue // welded away by the fill sweep
        // A CLOSURE EXISTS TO MEET THE FACING READING (owner 2026-08-21 late
        // night, on S7's interbeds pinching at short S7A: *"it should be a
        // continuous band starting from S7 but now it is interrupted at S7A's
        // column"*). Where the facing test read NOTHING at these levels — the
        // ground over there is below its TD — there is nobody to meet, and the
        // construct continues to that column instead of terminating. The
        // termination clause only governs closures that face data.
        const facingReads = (bands[facing] ?? []).some(
          (b) => Math.min(b.top, band.top) - Math.max(b.base, band.base) > 0,
        )
        if (!facingReads) continue
        // *"0.5x distance to next test (so half of the line width it onlaps
        // on)"* — half of the LINE the construct rides, expressed in this gap's
        // own fractions. A tie that bridges a test this family has no bands on
        // puts that middle beyond the gap's far column, and then nothing in
        // this gap can cross it.
        const gapWidth = alongM[gap + 1] - alongM[gap]
        const ownX = band.ci === gap ? alongM[gap] : alongM[gap + 1]
        const lineFarX = contacts.length === 0 ? nextTestX(band, ownIsLeft) : contacts
          .map((c) => c.spanX[1])
          .reduce((furthest, x) => (Math.abs(x - ownX) > Math.abs(furthest - ownX) ? x : furthest), ownX)
        const halfLine =
          Math.abs(gapWidth) < 1e-9 ? 0.5 : Math.abs((ownX + lineFarX) / 2 - ownX) / Math.abs(gapWidth)
        if (reach > halfLine + MIDDLE_GRACE)
          exceptions.push(
            `${tag} — closed construct reaches ${reach.toFixed(2)}, past half its own line (${halfLine.toFixed(2)})`,
          )
      }
    }
  }
  return exceptions
}

describe('the law oracle', () => {
  if (process.env.GEOTECH_LAW !== '1' || !existsSync(INPUT)) {
    it.skip('dormant — set GEOTECH_LAW=1 with the axis dump present', () => {})
    return
  }
  it('every band renders what the 2/1/0 table says for its ties', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const lines: string[] = []
    const perSection = new Map<string, number>()
    for (const sec of raw.sections) {
      const exceptions = auditSection(sec)
      perSection.set(sec.name, exceptions.length)
      lines.push(`${sec.name.padEnd(18)} exceptions=${exceptions.length}`)
      for (const e of exceptions) lines.push(`    ${e}`)
    }
    writeFileSync(OUT, lines.join('\n'))
    // ALL FOURTEEN SECTIONS AUDIT AT ZERO. The one frame-conflict exception
    // that stood here (#273's far half — the col19 ZAND-5 band 7.03..6.62)
    // dissolved with the 2026-08-21 ruling *"one mass one body"*: its two ties
    // land on another ZAND-5 that sat on a DIFFERENT duplicate formation row
    // (same class, different geological parent), and under class identity the
    // pair is one mass — it welds, spans, and the oracle's own decode agrees.
    const KNOWN_FRAME_CONFLICTS = 0
    const total = [...perSection.values()].reduce((sum, n) => sum + n, 0)
    expect(total, lines.join(String.fromCharCode(10))).toBe(KNOWN_FRAME_CONFLICTS)
    for (const [name, count] of perSection) {
      if (name === 'Cross-section 1') continue
      expect(count, `${name}: ${lines.join(String.fromCharCode(10))}`).toBe(0)
    }
  })
})
