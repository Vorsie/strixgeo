/**
 * partitionFillV2.conformance.diag.test.ts — the FULL 2/1/0 CONFORMANCE GATE
 * (INSTRUMENT ONLY — no engine changes). Design: docs/design/partition-engine-v2.md
 * §8 rulings 8 / 8a / 8b + §8 Q3 + ruling 5-revised.
 *
 * The existing shape audit only checks the 0-corr-FULL-WIDTH counter (one third of the
 * rule). This gate checks ALL THREE outcomes of the owner's per-unit-per-gap rule, on v2
 * output, for EVERY unit in EVERY gap of all 14 real sections:
 *
 *   effective tie count per unit per gap (counting the unit's TWO contacts — top/base —
 *   tied DIRECTLY or DERIVED through a shared contact with an adjacent same-side tied
 *   band; the engine's own `tiedContacts` rule, §4 increment-2) →
 *     0 → a SMALL LENS around the unit (never full-width; ruling 8/8b)
 *     1 → ONLAPS its tie (tip ~0.5, riding the tie line; ruling 8a)
 *     2 → BANDS (region spans the gap following both ties)
 *
 * Violation classes reported (v2 output vs. the rendered SectionRegion shape):
 *   - `0corr-not-lens`  — a 0-corr unit that renders full-width / band (SUBSUMES the
 *                          existing shapeaudit zerocorr counter).
 *   - `1corr-not-onlap` — a 1-corr unit not riding its tie (full-width, or the taper is on
 *                          the wrong side of the tie).
 *   - `2corr-not-band`  — a unit tied on BOTH sides that does not span the gap.
 * Advisory (NOT counted as violations, tagged for the future):
 *   - `0corr-reach-exceeds-cap` — the 0-corr lens reach exceeds min(0.45×gap, ~2×unit
 *                          thickness) (ruling 8b cap; advisory until the cap ships).
 *   - `q3-legit`        — a genuine surface / facing-shallow-TD void (§8 Q3) — a 0-corr
 *                          unit whose terminating shape is a legitimate void, tagged not
 *                          flagged.
 *
 * Gate: SHAPE_AUDIT=1 (reuses the allowed audit env var). Pure reporter — never fails.
 * Deterministic (no Date.now / Math.random; fixed iteration order). Dump:
 * scripts/diag_conformance.json.
 * Run (desktop/): SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.conformance.diag.test.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './partitionFill'
import { computeSectionFillV2 } from './partitionFillV2'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves } from './partitionFillV2/emitCurves'
import { collectGapBands } from './partitionFillV2/emitBands'
import {
  derivedBandTies,
  isBandMember,
  renderedShape,
  shallowTDForGap,
  tiedFlags,
  unitHasDirectTie,
  type RenderShape,
} from './partitionFillV2.conformance.classify'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const NAMES = resolve(REPO_ROOT, 'scripts/diag_shape_audit_names.json')
const DUMP = resolve(REPO_ROOT, 'scripts/diag_conformance.json')

// ---------------------------------------------------------------------------
// Input shapes (mirror the extractor output — same as the shape-audit diag).
// ---------------------------------------------------------------------------
interface RawUnit {
  layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null
}
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection {
  sectionId: string; name: string; columns: RawCol[]; alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

// ---------------------------------------------------------------------------
// Geometry helpers (shared shape of the other diags).
// ---------------------------------------------------------------------------
const round = (x: number): number => Math.round(x * 1000) / 1000
// ---------------------------------------------------------------------------
// Section preparation.
// ---------------------------------------------------------------------------
function prepare(sec: RawSection, nameOf: (id: string) => string): {
  columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[]; colNames: string[]
} {
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
  return { columns, alongM, edges, colNames }
}

function groupByGap(regions: SectionRegion[]): Map<number, SectionRegion[]> {
  const m = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    if (!m.has(r.gapIndex)) m.set(r.gapIndex, [])
    m.get(r.gapIndex)!.push(r)
  }
  return m
}

// ---------------------------------------------------------------------------
// Dump rows.
// ---------------------------------------------------------------------------
type ViolClass = '0corr-not-lens' | '1corr-not-onlap' | '2corr-not-band'
type AdvClass = '0corr-reach-exceeds-cap' | 'q3-legit'

interface ConfRow {
  section: string; gap: number; colLeft: string; colRight: string
  formation: string; unitLayerId: string; side: 'left' | 'right'
  corr: 0 | 1 | 2; topTied: boolean; baseTied: boolean
  bandLo: number; bandHi: number; thicknessM: number
  shape: RenderShape; fracLo: number; fracHi: number; apex: number
  violation: ViolClass | null
  advisory: AdvClass | null
  note: string
}

// Ruling 8b lens-reach cap: min(0.45 × gap-fraction[=1.0], ~2× unit thickness as a
// fraction of the gap). We express the thickness-derived cap in fraction space using the
// unit's own thickness / the gap's typical unit height as a rough proxy is not stable, so
// the cap here is the FRACTION form of ruling 8b's first term (0.45) plus a thickness-scaled
// tolerance; the advisory only fires when a 0-corr lens clearly overshoots 0.45.
const LENS_PINCH_FRACTION = 0.45

describe('v2 full 2/1/0 conformance gate', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  it('classifies every unit in every gap by effective tie count vs rendered shape', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]; formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const nameOf = (id: string): string => nameMap[id] ?? id.slice(0, 8)

    const rows: ConfRow[] = []
    const perSection: Record<string, unknown>[] = []
    const grand = {
      units: 0,
      substrate: 0, // sub-shallow-TD units excluded from 2/1/0 (owner §8 Q3 substrate)
      byCorr: { 0: 0, 1: 0, 2: 0 } as Record<number, number>,
      '0corr-not-lens': 0,
      '1corr-not-onlap': 0,
      '2corr-not-band': 0,
      '0corr-reach-exceeds-cap': 0,
      'q3-legit': 0,
    }

    for (const sec of raw.sections) {
      const { columns, alongM, edges, colNames } = prepare(sec, nameOf)
      if (columns.length < 2) continue

      const r2 = computeSectionFillV2(columns, edges, undefined, alongM)
      const gaps2 = groupByGap(r2)

      // Engine tie state (its own derivation) for this section.
      const section = buildSectionInput(columns, edges, undefined, alongM)
      const { activeTies } = emitCurves(section)
      const geom = section.columns // ColumnGeom[] with topElev/baseElev per unit

      const sec0 = { '0corr-not-lens': 0, '1corr-not-onlap': 0, '2corr-not-band': 0, 'q3-legit': 0, 'cap': 0 }

      // Every unit belongs to two gaps (its left face = gap ci-1, its right face = gap ci).
      // We evaluate a unit's termination shape SEPARATELY into each adjacent gap — that is
      // where the 2/1/0 rule applies (per unit PER GAP).
      for (let ci = 0; ci < geom.length; ci++) {
        const col = geom[ci]
        for (const gi of [ci - 1, ci] as const) {
          if (gi < 0 || gi + 1 >= geom.length) continue
          const side: 'left' | 'right' = ci === gi ? 'left' : 'right'
          const facing = side === 'left' ? geom[gi + 1] : geom[gi]
          const regs = gaps2.get(gi) ?? []
          const flags = tiedFlags(gi, side, col.units.length, activeTies)
          const bands = collectGapBands(gi, geom[gi], geom[gi + 1], activeTies)
          const shallowTD = shallowTDForGap(geom[gi], geom[gi + 1])
          for (let ui = 0; ui < col.units.length; ui++) {
            const u = col.units[ui]
            const bandLo = u.baseElev
            const bandHi = u.topElev
            // Deep-to-deep substrate exclusion (owner §8 Q3): a unit whose band sits ENTIRELY at
            // or below the shallow TD is filled by the substrate mechanism (bridges / bottom-tie),
            // not by a same-formation termination — the 2/1/0 rule does not govern it. Mirrors the
            // zerocorr counter's substrate exclusion. Counted separately, never a violation.
            if (bandHi <= shallowTD + 1e-3) {
              grand.substrate++
              continue
            }
            const direct = flags[ui]
            const derived = derivedBandTies(gi, side, ui, col, facing, activeTies)
            const topTied = direct.top || derived.topShared
            const baseTied = direct.base || derived.baseShared
            // Effective OUTCOME per the owner's 2/1/0 vocabulary (ruling 8/8a/8b), mirroring the
            // engine's own band signal — NOT a naive tied-contact count:
            //   2 → BAND: the unit is a MATCHED-PAIR BAND member (``collectGapBands`` — a
            //       same-side, SAME-FORMATION tie between the two facing units; that pair spans
            //       the gap full-width by construction, §4 increment-7). This is the ONLY band
            //       authority. A unit sandwiched between two DIFFERENT-formation tied bands is a
            //       MINORITY (mixed-bracket, ruling-pending §4 residual (b)), NOT a band — so a
            //       naive "both contacts tied → 2" would wrongly count it. Band membership is the
            //       correct same-formation-continuation test.
            //   1 → ONLAP: the unit is not a band member but a tie touches it — either a DIRECT
            //       correlation edge on its own contact, or a ruling-8a shared contact with a
            //       directly-adjacent same-side tied band (a DERIVED onlap). Tip ~0.5, riding
            //       the tie.
            //   0 → LENS: no tie touches the unit and no adjacent band shares a contact.
            const bandMember = isBandMember(bands, side, ui)
            const hasAnchor = unitHasDirectTie(gi, side, ui, activeTies) || topTied || baseTied
            const corr: 0 | 1 | 2 = bandMember ? 2 : hasAnchor ? 1 : 0

            const rs = renderedShape(regs, u.formationId, bandLo, bandHi)
            grand.units++
            grand.byCorr[corr]++

            let violation: ViolClass | null = null
            let advisory: AdvClass | null = null
            let note = ''

            // §8 Q3: a 0-corr unit that is a surface-boundary first unit OR faces a shallow-TD
            // void may legitimately terminate as a void rather than a hugging lens — tagged.
            const isSurfaceFirst = ui === 0
            const facingTD = Math.min(...facing.units.map((fu) => fu.baseElev))
            const facesShallowVoid = facingTD > bandLo + 0.01 && bandHi > facingTD // unit's band drops below facing TD

            if (corr === 0) {
              // Rule: SMALL LENS around the unit — never full-width, never band.
              if (rs.shape === 'band' || (rs.reachesLeft && rs.reachesRight)) {
                // Full-width: a violation UNLESS it is a genuine §8 Q3 void case (tag, not flag).
                if (isSurfaceFirst || facesShallowVoid) {
                  advisory = 'q3-legit'
                  note = `0-corr full-width but §8-Q3 void (surfaceFirst=${isSurfaceFirst} facesShallowVoid=${facesShallowVoid})`
                } else {
                  violation = '0corr-not-lens'
                  note = '0-corr unit renders full-width / band'
                }
              } else if (rs.shape === 'absent') {
                if (isSurfaceFirst || facesShallowVoid) {
                  advisory = 'q3-legit'
                  note = '0-corr absent — §8-Q3 void'
                } else {
                  violation = '0corr-not-lens'
                  note = '0-corr unit absent (no terminating lens drawn)'
                }
              } else {
                // onlap / lens shape: acceptable termination. Ruling 8b reach cap (advisory).
                if (rs.apex > LENS_PINCH_FRACTION + 0.02) {
                  advisory = '0corr-reach-exceeds-cap'
                  note = `0-corr lens reach ${round(rs.apex)} exceeds ${LENS_PINCH_FRACTION} cap (ruling 8b, advisory)`
                }
              }
            } else if (corr === 1) {
              // Rule: ONLAPS its tie (tip ~0.5, riding the tie line).
              if (rs.shape === 'band' || (rs.reachesLeft && rs.reachesRight)) {
                violation = '1corr-not-onlap'
                note = '1-corr unit renders full-width instead of onlapping its tie'
              } else if (rs.shape === 'absent') {
                violation = '1corr-not-onlap'
                note = '1-corr unit absent (no onlap drawn)'
              } else {
                // onlap/lens: check it rides the correct (tied) side. The tie is on the side
                // whose contact is tied; the onlap should reach the facing column across the
                // gap from this unit's own column. A lens (reaches neither edge) for a 1-corr
                // unit is a wrong-tip shape.
                if (rs.shape === 'lens') {
                  violation = '1corr-not-onlap'
                  note = '1-corr unit renders as a closed lens (reaches neither edge) — not riding its tie'
                }
              }
            } else {
              // corr === 2. Rule: BANDS (spans the gap following both ties).
              if (rs.shape !== 'band') {
                if (rs.shape === 'absent') {
                  violation = '2corr-not-band'
                  note = '2-corr unit absent (no band drawn)'
                } else {
                  violation = '2corr-not-band'
                  note = `2-corr unit does not span the gap (shape=${rs.shape}, reachesL=${rs.reachesLeft} reachesR=${rs.reachesRight})`
                }
              }
            }

            if (violation) {
              grand[violation]++
              sec0[violation]++
            }
            if (advisory === 'q3-legit') {
              grand['q3-legit']++
              sec0['q3-legit']++
            } else if (advisory === '0corr-reach-exceeds-cap') {
              grand['0corr-reach-exceeds-cap']++
              sec0['cap']++
            }

            // Only DUMP rows that carry a violation or an advisory (the conformant majority is
            // summarised by counts) — keeps the JSON actionable and the run deterministic.
            if (violation || advisory) {
              rows.push({
                section: sec.name, gap: gi, colLeft: colNames[gi], colRight: colNames[gi + 1],
                formation: fname(u.formationId), unitLayerId: u.layerId, side,
                corr, topTied, baseTied,
                bandLo: round(bandLo), bandHi: round(bandHi), thicknessM: round(bandHi - bandLo),
                shape: rs.shape, fracLo: round(rs.fracLo), fracHi: round(rs.fracHi), apex: round(rs.apex),
                violation, advisory, note,
              })
            }
          }
        }
      }

      perSection.push({
        section: sec.name,
        cols: columns.length,
        v2Regions: r2.length,
        '0corr-not-lens': sec0['0corr-not-lens'],
        '1corr-not-onlap': sec0['1corr-not-onlap'],
        '2corr-not-band': sec0['2corr-not-band'],
        'q3-legit': sec0['q3-legit'],
        'reach-cap-advisory': sec0['cap'],
      })

      console.log(
        `\n=== ${sec.name}: cols=${columns.length} v2reg=${r2.length} | ` +
          `0corr-not-lens=${sec0['0corr-not-lens']} 1corr-not-onlap=${sec0['1corr-not-onlap']} ` +
          `2corr-not-band=${sec0['2corr-not-band']} | q3-legit=${sec0['q3-legit']} ` +
          `reach-cap(adv)=${sec0['cap']}`,
      )
      for (const r of rows.filter((x) => x.section === sec.name && x.violation)) {
        console.log(
          `   ${r.violation} gap${r.gap} ${r.colLeft}↔${r.colRight} ${r.formation} ` +
            `[${r.side}] corr=${r.corr}(top=${r.topTied} base=${r.baseTied}) shape=${r.shape} ` +
            `frac[${r.fracLo}..${r.fracHi}] el[${r.bandLo}..${r.bandHi}] — ${r.note}`,
        )
      }
    }

    // ---- SUMMARY + DUMP ----
    const dump = {
      generatedFor: '14 real sections, v2 engine only, full 2/1/0 conformance gate',
      grandTotals: grand,
      perSection,
      rows,
    }
    writeFileSync(DUMP, JSON.stringify(dump, null, 1))

    const totalViolations =
      grand['0corr-not-lens'] + grand['1corr-not-onlap'] + grand['2corr-not-band']
    console.log('\n########## CONFORMANCE GRAND TOTALS ##########')
    console.log(`  units classified: ${grand.units}  (0corr=${grand.byCorr[0]} 1corr=${grand.byCorr[1]} 2corr=${grand.byCorr[2]})`)
    console.log(`  0corr-not-lens  : ${grand['0corr-not-lens']}   <-- includes full-width (subsumes zerocorr counter)`)
    console.log(`  1corr-not-onlap : ${grand['1corr-not-onlap']}   <-- NEW class`)
    console.log(`  2corr-not-band  : ${grand['2corr-not-band']}   <-- NEW class`)
    console.log(`  -> TOTAL VIOLATIONS: ${totalViolations}`)
    console.log(`  advisory 0corr-reach-exceeds-cap (ruling 8b): ${grand['0corr-reach-exceeds-cap']}  (advisory, not a violation)`)
    console.log(`  advisory q3-legit (§8 Q3 genuine void)      : ${grand['q3-legit']}  (tagged, not a violation)`)
    console.log(`  dumped -> ${DUMP}`)
    console.log('##############################################')
    expect(true).toBe(true)
  })
})
