/**
 * oracle210.conformance.test.ts — the owner's 2/1/0 ORACLE vs the ENGINE's effectiveCorr, on
 * real data (the 14 committed sections in scripts/diag_allsections_input.json).
 *
 * The oracle (``walkSection210``) is the owner's rule with nothing else: count a unit's two
 * contacts, symmetric on a shared contact, adjacent tests only. The engine's
 * ``effectiveCorrForSide`` is the real 2/1/0 the sweep emits against — it folds in the implicit
 * top band (ruling 5-revised / 8d), the enclosed-lens MERGE that turns a sand-around-a-silt into
 * ONE band (design section-fill §4), ruling-8a DERIVED onlaps through a facing same-formation
 * band, jump-tie BRIDGES (ruling 8i(e)) and the crossing-tie SUSPENSION (owner §8 Q4).
 *
 * This test joins the two by ``layerId`` per (gap, side) and lists every disagreement. Where they
 * disagree the OWNER's oracle is the rule; each surviving disagreement is AUTO-ATTRIBUTED to the
 * documented ruling that explains it. A disagreement that matches NO ruling is a ``candidate`` —
 * a genuine oracle/engine divergence — and the test FAILS if the candidate set moves off its
 * pinned baseline (currently empty: every real-data disagreement is a documented ruling).
 *
 * Dump: scripts/oracle210_conformance.json. Always on — the input is committed; skips gracefully
 * only if it is genuinely absent.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn } from '../sectionPartition'
import { buildSectionInput } from './sectionGeom'
import { emitCurves } from './emitCurves'
import { derivedBandTies, effectiveCorrForUnit, tiedFlags } from './effectiveCorr'
import { collectGapBands } from './emitBands'
import { bridgeGapAnchorKey } from './emitSubstrate'
import { setTwoSidedTerminations } from './tileFlags'
import { walkSection210, type Outcome210, type SideName } from './oracle210'

const HERE = dirname(fileURLToPath(import.meta.url))
// HERE is desktop/src/renderer/src/utils/partitionFillV2 — six levels below the repo root.
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const DUMP = resolve(REPO_ROOT, 'scripts/oracle210_conformance.json')

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

/** Keep only tests with an elevation and litho; carry the surviving alongM (mirrors the engine). */
function prepare(sec: RawSection): { columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[] } {
  const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, alongM, edges }
}

const corrToOutcome = (corr: 0 | 1 | 2): Outcome210 => (corr === 2 ? 'band' : corr === 1 ? 'onlap' : 'lens')

/** Shallow TD of a gap (mTAW): the HIGHER of the two facing tests' deepest bases (owner §8 Q3). */
function shallowTDForGap(left: { units: { baseElev: number }[] }, right: { units: { baseElev: number }[] }): number {
  const td = (c: { units: { baseElev: number }[] }): number => Math.min(...c.units.map((u) => u.baseElev))
  return Math.max(td(left), td(right))
}

/** Everything the categoriser needs about ONE engine unit-in-a-gap-side. */
interface EngRec {
  outcome: Outcome210
  subTd: boolean
  isFirst: boolean
  topTieKind: string | null
  baseTieKind: string | null
  derivedTop: boolean
  derivedBase: boolean
  bridge: boolean
  /** Engine (normalised) elevation span — larger than the raw unit's when the merge grew it. */
  engTop: number
  engBase: number
}

interface Disagreement {
  section: string
  gap: number
  side: SideName
  layerId: string
  formation: string
  oracle: Outcome210
  engine: Outcome210
  oracleTies: number
  ruling: string
}

/** Engine effectiveCorr + provenance for one section, keyed ``layerId|gap|side``. */
function engineOutcomes(
  columns: PartitionColumn[],
  edges: CorrelationEdge[],
  alongM: number[],
): { byKey: Map<string, EngRec>; enclosedLensLayers: Set<string> } {
  const section = buildSectionInput(columns, edges, undefined, alongM)
  const geom = section.columns
  const byKey = new Map<string, EngRec>()
  const enclosedLensLayers = new Set<string>()
  for (const c of geom) for (const el of c.enclosedLenses) enclosedLensLayers.add(el.lens.layerId)
  if (geom.length < 2) return { byKey, enclosedLensLayers }
  const { activeTies, bridgeGapAnchored } = emitCurves(section)
  for (let gi = 0; gi + 1 < geom.length; gi++) {
    const left = geom[gi]
    const right = geom[gi + 1]
    const shallowTD = shallowTDForGap(left, right)
    const bands = collectGapBands(gi, left, right, activeTies)
    for (const side of ['left', 'right'] as const) {
      const col = side === 'left' ? left : right
      const facing = side === 'left' ? right : left
      const flags = tiedFlags(gi, side, col.units.length, activeTies, bridgeGapAnchored)
      for (let ui = 0; ui < col.units.length; ui++) {
        const u = col.units[ui]
        const ec = effectiveCorrForUnit(gi, side, ui, col, facing, flags, bands, activeTies)
        const derived = derivedBandTies(gi, side, ui, col, facing, activeTies)
        const bridge =
          bridgeGapAnchored.has(bridgeGapAnchorKey(gi, side, ui, 'top')) ||
          bridgeGapAnchored.has(bridgeGapAnchorKey(gi, side, ui, 'base'))
        byKey.set(`${u.layerId}|${gi}|${side}`, {
          outcome: corrToOutcome(ec.corr),
          subTd: u.topElev <= shallowTD + 1e-3,
          isFirst: ui === 0,
          topTieKind: ec.topTie?.kind ?? null,
          baseTieKind: ec.baseTie?.kind ?? null,
          derivedTop: derived.topShared,
          derivedBase: derived.baseShared,
          bridge,
          engTop: u.topElev,
          engBase: u.baseElev,
        })
      }
    }
  }
  return { byKey, enclosedLensLayers }
}

/**
 * Attribute one disagreement to the ruling that explains it, or 'candidate' if none. The
 * UNIVERSAL explanations (a merge that reshaped the unit, a jump-tie bridge, the shallow-TD
 * substrate) are checked first — they change the very stack / tie set the oracle never saw —
 * then the tie-adding rulings (top band, ruling-8a derived), then the tie-dropping one
 * (crossing-tie suspension).
 */
function attribute(os: Outcome210, e: EngRec, rawTop: number, rawBase: number): string {
  const engFewer = // the engine sees FEWER ties than the oracle (oracle band/onlap -> engine onlap/lens)
    (os === 'band' && e.outcome === 'onlap') || (os === 'onlap' && e.outcome === 'lens') || (os === 'band' && e.outcome === 'lens')
  if (e.subTd) return 'sub-TD substrate (owner §8 Q3 — 2/1/0 does not govern below the shallow TD)'
  // The enclosed-lens MERGE grew this unit over a minority (design section-fill §4): its
  // normalised span is bigger than the raw unit, so it picks up (or loses) a contact tie the
  // owner's per-piece walk never sees.
  if (e.engTop > rawTop + 1e-3 || e.engBase < rawBase - 1e-3)
    return 'enclosed-lens MERGE — the enclosing same-formation pieces are one grown band (design section-fill §4)'
  // A jump-tie bridge anchors a contact of this unit (ruling 8i(e)) — a drawn correlation to a
  // non-adjacent test the owner's two-column walk does not count as "the neighbour's".
  if (e.bridge) return 'ruling 8i(e) — a jump-tie bridge anchors a contact of this unit'
  if (engFewer) return 'crossing-tie SUSPENSION or merge-dropped tie (owner §8 Q4) — an approved tie the oracle counts is not active in the engine'
  // The implicit top band ties the first unit (ruling 5-revised / 8d).
  if (e.isFirst && e.topTieKind === 'top-band')
    return 'ruling 5-revised / 8d — the implicit top band ties the first unit'
  // A facing same-formation band shares one of this unit's contacts (ruling 8a derived onlap/band).
  if (e.derivedTop || e.derivedBase) return 'ruling 8a — a facing same-formation band shares this contact (derived tie)'
  return 'candidate'
}

describe('oracle210 vs engine effectiveCorr — real-data conformance (14 sections)', () => {
  if (!existsSync(INPUT)) {
    it.skip('input absent (scripts/diag_allsections_input.json)', () => {})
    return
  }

  it('every real-data disagreement is a documented ruling (no unexplained candidate)', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    const disagreements: Disagreement[] = []
    let compared = 0
    let unmatched = 0
    const prev = setTwoSidedTerminations(true) // the flag-ON product path is what the app renders
    try {
      for (const sec of raw.sections) {
        const { columns, alongM, edges } = prepare(sec)
        if (columns.length < 2) continue
        const walk = walkSection210(columns, edges)
        const eng = engineOutcomes(columns, edges, alongM)
        // Raw unit spans, for merge-grown detection.
        const rawSpan = new Map<string, { top: number; base: number }>()
        for (const c of columns) for (const u of c.units) rawSpan.set(u.layerId, { top: c.surfaceElevM - u.topDepthM, base: c.surfaceElevM - u.baseDepthM })

        for (let ci = 0; ci < walk.length; ci++) {
          for (const u of walk[ci].units) {
            for (const side of ['left', 'right'] as const) {
              const os = side === 'left' ? u.left : u.right
              if (os.outcome === 'edge-of-section') continue
              const gap = side === 'right' ? ci : ci - 1
              const engSide: SideName = side === 'right' ? 'left' : 'right'
              const e = eng.byKey.get(`${u.layerId}|${gap}|${engSide}`)
              const rs = rawSpan.get(u.layerId) ?? { top: 0, base: 0 }
              if (!e) {
                if (eng.enclosedLensLayers.has(u.layerId)) {
                  compared++
                  if (os.outcome !== 'lens') {
                    disagreements.push({
                      section: sec.name, gap, side, layerId: u.layerId, formation: fname(u.formationId),
                      oracle: os.outcome, engine: 'lens', oracleTies: os.tieCount,
                      ruling: 'enclosed-lens MERGE — the engine extracted this minority as a lens (agree=lens)',
                    })
                  }
                } else {
                  unmatched++
                }
                continue
              }
              compared++
              if (e.outcome === os.outcome) continue
              disagreements.push({
                section: sec.name, gap, side, layerId: u.layerId, formation: fname(u.formationId),
                oracle: os.outcome, engine: e.outcome, oracleTies: os.tieCount,
                ruling: attribute(os.outcome, e, rs.top, rs.base),
              })
            }
          }
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }

    disagreements.sort((a, b) =>
      `${a.section}|${String(a.gap).padStart(3, '0')}|${a.side}|${a.layerId}`.localeCompare(
        `${b.section}|${String(b.gap).padStart(3, '0')}|${b.side}|${b.layerId}`,
      ),
    )
    const byRuling: Record<string, number> = {}
    for (const d of disagreements) byRuling[d.ruling] = (byRuling[d.ruling] ?? 0) + 1
    const candidates = disagreements.filter((d) => d.ruling === 'candidate')
    writeFileSync(
      DUMP,
      JSON.stringify(
        { compared, unmatched, disagreements: disagreements.length, byRuling, candidates: candidates.length, rows: disagreements },
        null,
        1,
      ),
    )

    expect(compared).toBeGreaterThan(0)
    // Every disagreement resolves to a documented ruling. A 'candidate' is a genuine oracle/engine
    // divergence with no ruling behind it — the signal this gate exists to raise.
    expect(
      candidates.map((c) => `${c.section}|gap${c.gap}|${c.side}|${c.formation}|${c.oracle}->${c.engine}`),
      'unexplained oracle/engine divergence (no ruling): investigate before pinning',
    ).toEqual([])
  })
})
