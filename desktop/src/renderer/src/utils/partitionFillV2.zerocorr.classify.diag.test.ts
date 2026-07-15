/**
 * THROWAWAY diag (2026-07-15) — per-instance derived-tie classification of the 15
 * ruling-8 zerocorr full-width violations, for the owner's "does the unit share a
 * contact with a directly-adjacent TIED band?" re-classification question.
 *
 * For every zerocorr row (from partitionFillV2.shapeaudit.zerocorr on v2 output) it
 * dumps, using the ENGINE's own tie state (buildSectionInput + emitCurves.activeTies
 * + the tiedContacts derived-tie rule): the violating unit on its own column, its
 * adjacent-above / adjacent-below units, and whether each of the unit's two contacts
 * (top / base) is TIED across the gap — including the DERIVED base-tie (a top-tie on
 * unit k also ties k-1.base; §4 increment-2). A unit that shares a tied contact with
 * a same-side band should route as a derived-tie ONLAP, not a 0-corr full-width band.
 *
 * Gate: SHAPE_AUDIT=1 (reuses the allowed audit gate). Never fails (diag). DELETE
 * after the campaign.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from './partitionFill'
import { computeSectionFillV2 } from './partitionFillV2'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves, type ResolvedTie } from './partitionFillV2/emitCurves'
import { zeroCorrFullWidth } from './partitionFillV2.shapeaudit.zerocorr'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const NAMES = resolve(REPO_ROOT, 'scripts/diag_shape_audit_names.json')
const DUMP = resolve(REPO_ROOT, 'scripts/diag_zerocorr_classify.json')

interface RawUnit {
  layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null
}
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection {
  sectionId: string; name: string; columns: RawCol[]; alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

function prep(sec: RawSection, nameOf: (id: string) => string) {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const colNames = keep.map(({ c }) => nameOf(c.investigationId))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a, b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, alongM, colNames, edges }
}

function groupByGap(regions: SectionRegion[]): Map<number, SectionRegion[]> {
  const m = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    if (!m.has(r.gapIndex)) m.set(r.gapIndex, [])
    m.get(r.gapIndex)!.push(r)
  }
  return m
}

/**
 * Derived-tie flags per unit index on a column (the ENGINE's tiedContacts rule,
 * §4 increment-2): a TOP tie on unit k sets k.top AND k-1.base; a BASE tie sets
 * only k.base. Returns {top,base} per unit index.
 */
function tiedFlags(
  gapIndex: number,
  side: 'left' | 'right',
  nUnits: number,
  activeTies: readonly ResolvedTie[],
): { top: boolean; base: boolean }[] {
  const flags = Array.from({ length: nUnits }, () => ({ top: false, base: false }))
  const setTop = (ui: number): void => {
    if (ui < 0 || ui >= nUnits) return
    flags[ui].top = true
    if (ui > 0) flags[ui - 1].base = true
  }
  const setBase = (ui: number): void => {
    if (ui < 0 || ui >= nUnits) return
    flags[ui].base = true
  }
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    const ui = side === 'left' ? t.leftUnitIndex : t.rightUnitIndex
    const s = side === 'left' ? t.leftSide : t.rightSide
    if (s === 'top') setTop(ui)
    else setBase(ui)
  }
  return flags
}

/**
 * Is there a same-side BAND tie (top-top or base-base, same formation) whose member
 * unit is the ADJACENT unit (index ui-1 above / ui+1 below) of the violating unit on
 * ``side``? A shared contact with such a band is the owner's derived-tie condition.
 */
function adjacentBandInfo(
  gapIndex: number,
  side: 'left' | 'right',
  ui: number,
  col: { units: { formationId: string }[] },
  facing: { units: { formationId: string }[] },
  activeTies: readonly ResolvedTie[],
): { aboveTiedBand: string | null; belowTiedBand: string | null } {
  let aboveTiedBand: string | null = null
  let belowTiedBand: string | null = null
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    if (t.leftSide !== t.rightSide) continue // symmetric band only
    const uIdx = side === 'left' ? t.leftUnitIndex : t.rightUnitIndex
    const lu = col.units[uIdx]
    const fIdx = side === 'left' ? t.rightUnitIndex : t.leftUnitIndex
    const fu = facing.units[fIdx]
    if (!lu || !fu || lu.formationId !== fu.formationId) continue
    if (uIdx === ui - 1) aboveTiedBand = lu.formationId
    if (uIdx === ui + 1) belowTiedBand = lu.formationId
  }
  return { aboveTiedBand, belowTiedBand }
}

interface ClassifyRow {
  section: string; gap: number; colLeft: string; colRight: string
  formation: string; kind: string; topElev: number; baseElev: number; existingKlass: string
  // The violating unit's location: which side it lives on + its unit index.
  side: 'left' | 'right' | 'both'
  ownColStack: string
  facingColStack: string
  aboveUnit: string; belowUnit: string
  ownTopTied: boolean; ownBaseTied: boolean
  aboveTiedBand: string | null; belowTiedBand: string | null
  // Owner-insight verdict: qualifies for derived-tie onlap?
  derivedTieOnlap: boolean
  verdict: string
  // v1 reference: does v1 render this formation full-width or pinched in this gap?
  v1Full: boolean; v1Apex: number
  // Ties touching the violating unit's own layer directly (edges naming its layerId).
  ownEdges: string[]
  // All active ties in this gap (resolved side + formation on each end).
  gapTies: string[]
  // Whether the facing column also carries this formation untied in-band (geometric-match).
  facingSameFormUntied: boolean
}

describe('zerocorr derived-tie classification', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  it('dumps the derived-tie picture per zerocorr instance', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]; formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const nameOf = (id: string): string => nameMap[id] ?? id.slice(0, 8)

    const rows: ClassifyRow[] = []

    for (const sec of raw.sections) {
      const { columns, alongM, colNames, edges } = prep(sec, nameOf)
      if (columns.length < 2) continue
      const r2 = computeSectionFillV2(columns, edges, undefined, alongM)
      const gaps2 = groupByGap(r2)
      const zrows = zeroCorrFullWidth(gaps2, columns, edges, colNames, sec.name, fname)
      if (zrows.length === 0) continue
      const r1 = computeSectionFill(columns, edges, undefined, alongM)
      const gaps1 = groupByGap(r1)
      // v1 full-width-by-formation per gap (for the reference column).
      const v1Full = (gi: number, fid: string): { full: boolean; apex: number } => {
        let full = false
        let apex = 0
        for (const r of gaps1.get(gi) ?? []) {
          if (fname(r.formationId) !== fid) continue
          let lo = Infinity
          let hi = -Infinity
          for (const p of r.polygon) {
            if (p.fraction < lo) lo = p.fraction
            if (p.fraction > hi) hi = p.fraction
          }
          if (lo <= 0.02 && hi >= 0.98) full = true
          apex = Math.max(apex, lo <= 0.02 ? hi : 1 - lo)
        }
        return { full, apex }
      }
      // layerId -> the raw edges naming it (with sides).
      const edgeStrOf = (layerId: string): string[] =>
        edges
          .filter((e) => e.a === layerId || e.b === layerId)
          .map((e) => `${e.a === layerId ? 'self' : 'other'}.${e.a === layerId ? e.aSide : e.bSide}<->${e.a === layerId ? e.bSide : e.aSide}`)

      // Engine tie state for this section.
      const section = buildSectionInput(columns, edges, undefined, alongM)
      const { activeTies } = emitCurves(section)
      const geom = section.columns

      // Elevation stack per surviving geom column (top->down).
      const stackStr = (ci: number): string =>
        geom[ci].units
          .map((u) => `${fname(u.formationId)}[${u.topElev.toFixed(2)}..${u.baseElev.toFixed(2)}]`)
          .join(' ')

      for (const z of zrows) {
        const gi = z.gap
        const L = geom[gi]
        const R = geom[gi + 1]
        // Locate the violating unit: a unit of the row's formation whose elevation band
        // overlaps [baseElev..topElev] on either column.
        const inBand = (u: { topElev: number; baseElev: number }): boolean =>
          u.topElev > z.baseElev + 0.01 && z.topElev > u.baseElev + 0.01
        const fidMatch = (u: { formationId: string }): boolean => fname(u.formationId) === z.formation
        const idxL = L.units.findIndex((u) => fidMatch(u) && inBand(u))
        const idxR = R.units.findIndex((u) => fidMatch(u) && inBand(u))
        const onL = idxL >= 0
        const onR = idxR >= 0
        const side: 'left' | 'right' | 'both' = onL && onR ? 'both' : onL ? 'left' : 'right'
        const useSide: 'left' | 'right' = onL ? 'left' : 'right'
        const col = useSide === 'left' ? L : R
        const facing = useSide === 'left' ? R : L
        const ui = useSide === 'left' ? idxL : idxR
        const flags = tiedFlags(gi, useSide, col.units.length, activeTies)
        const uf = ui >= 0 ? flags[ui] : { top: false, base: false }
        const above = ui > 0 ? fname(col.units[ui - 1].formationId) : 'SURF'
        const below = ui >= 0 && ui + 1 < col.units.length ? fname(col.units[ui + 1].formationId) : 'TD'
        const { aboveTiedBand, belowTiedBand } = adjacentBandInfo(gi, useSide, ui, col, facing, activeTies)

        // Owner-insight verdict: the unit qualifies for a derived-tie onlap when it
        // shares a contact with a directly-adjacent SAME-SIDE tied band — i.e. the
        // adjacent-above unit is a tied band (shares this unit's TOP contact) OR the
        // adjacent-below unit is a tied band (shares this unit's BASE contact).
        const derivedTieOnlap = aboveTiedBand !== null || belowTiedBand !== null
        let verdict: string
        if (derivedTieOnlap) {
          verdict = `DERIVED-TIE-ONLAP (adjacent band: above=${aboveTiedBand ?? '-'} below=${belowTiedBand ?? '-'})`
        } else if (uf.top || uf.base) {
          verdict = `already-tied-contact (top=${uf.top} base=${uf.base}) but no adjacent same-form band`
        } else {
          verdict = `NO tied contact — stays ${z.klass}`
        }

        const ownLayerId = ui >= 0 ? col.units[ui].layerId : ''
        const v1r = v1Full(gi, z.formation)
        const gapTies = activeTies
          .filter((t) => t.gapIndex === gi)
          .map((t) => {
            const lu = L.units[t.leftUnitIndex]
            const ru = R.units[t.rightUnitIndex]
            return `${fname(lu?.formationId ?? '?')}.${t.leftSide}<->${fname(ru?.formationId ?? '?')}.${t.rightSide}`
          })
        // Does the FACING column carry the same formation untied, overlapping the band?
        const facingCol = onL ? R : L
        const facingSameFormUntied = facingCol.units.some(
          (u) => fname(u.formationId) === z.formation && u.topElev > z.baseElev + 0.01 && z.topElev > u.baseElev + 0.01,
        )
        rows.push({
          section: z.section, gap: gi, colLeft: z.colLeft, colRight: z.colRight,
          formation: z.formation, kind: z.kind, topElev: z.topElev, baseElev: z.baseElev,
          existingKlass: z.klass, side,
          ownColStack: onL ? stackStr(gi) : stackStr(gi + 1),
          facingColStack: onL ? stackStr(gi + 1) : stackStr(gi),
          aboveUnit: above, belowUnit: below,
          ownTopTied: uf.top, ownBaseTied: uf.base,
          aboveTiedBand, belowTiedBand, derivedTieOnlap, verdict,
          v1Full: v1r.full, v1Apex: Math.round(v1r.apex * 1000) / 1000,
          ownEdges: ownLayerId ? edgeStrOf(ownLayerId) : [],
          gapTies, facingSameFormUntied,
        })
      }
    }

    writeFileSync(DUMP, JSON.stringify({ count: rows.length, rows }, null, 1))
    // Also compute v1 for cross-reference (does v1 band or pinch it?) — cheap sanity.
    void computeSectionFill
    console.log(`\n### ZEROCORR DERIVED-TIE CLASSIFICATION (${rows.length} rows) ###`)
    for (const r of rows) {
      console.log(
        `\n[${r.section} g${r.gap} ${r.colLeft}<->${r.colRight}] ${r.formation} ${r.kind} ` +
          `el[${r.baseElev}..${r.topElev}] side=${r.side} existing=${r.existingKlass}`,
      )
      console.log(`   own:   ${r.ownColStack}`)
      console.log(`   facing:${r.facingColStack}`)
      console.log(`   above=${r.aboveUnit} below=${r.belowUnit} | ownTopTied=${r.ownTopTied} ownBaseTied=${r.ownBaseTied}`)
      console.log(`   => ${r.verdict}`)
    }
    expect(true).toBe(true)
  })
})
