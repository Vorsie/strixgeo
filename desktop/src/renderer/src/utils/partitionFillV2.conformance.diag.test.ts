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
 *   - `8e-enclosure`    — OWNER RULING 8e (design §8): a full-width same-formation render
 *                          enclosed by its OWN formation's legitimately-tied face is ONE
 *                          body by construction ("it should be one sand"). A gate FALSE
 *                          POSITIVE (per-unit scoping of an invisible distinction inside one
 *                          face) — tagged, not flagged, no engine change. EXEMPTION CRITERION
 *                          (``sameFormationEnclosedByTiedBand``): the unit renders full-width
 *                          / band in its OWN formation AND that formation carries a
 *                          matched-pair band (drawn/derived tie, ``collectGapBands``) across
 *                          this gap. The negative guard (ruling 8) STAYS flagged: a
 *                          same-formation full-width with NO tie of that formation in the gap
 *                          is the retired geometric auto-match (opposing lenses), never
 *                          exempted. The ABSENT class is NEVER exempted — an absent minority
 *                          is missing from the line network (ruling 8e's condition: enclosed
 *                          different-formation minorities MUST render as their 8b lenses), so
 *                          it stays REAL engine work.
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

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations, twoSidedTerminationsEnabled } from './partitionFillV2/tileFlags'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves } from './partitionFillV2/emitCurves'
import { collectGapBands } from './partitionFillV2/emitBands'
import {
  derivedBandTies,
  isBandMember,
  renderedShape,
  sameFormationBaseTiedPair,
  sameFormationEnclosedByTiedBand,
  shallowTDForGap,
  tiedFlags,
  topBandTies,
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
type AdvClass = '0corr-reach-exceeds-cap' | 'q3-legit' | '8e-enclosure'

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

/** Run the full 2/1/0 classifier over all 14 real sections at the CURRENT engine flag
 * state and return the grand totals + the per-violation/advisory rows. Console output
 * mirrors the historical reporter. Extracted from the single ``it`` (S38) so the SAME
 * classification runs against BOTH the flag-OFF frozen-seam engine and the flag-ON
 * literal-8l product path, each hard-gated. */
function classifyAllSections(): {
  grand: {
    units: number; substrate: number; byCorr: Record<number, number>
    '0corr-not-lens': number; '1corr-not-onlap': number; '2corr-not-band': number
    '0corr-reach-exceeds-cap': number; 'q3-legit': number; '8e-enclosure': number
  }
  rows: ConfRow[]
} {
  {
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
      '8e-enclosure': 0, // ruling-8e same-formation-enclosure exemptions (tagged, not flagged)
    }

    for (const sec of raw.sections) {
      const { columns, alongM, edges, colNames } = prepare(sec, nameOf)
      if (columns.length < 2) continue

      const r2 = computeSectionFillV2(columns, edges, undefined, alongM)
      const gaps2 = groupByGap(r2)

      // Engine tie state (its own derivation) for this section. ``bridgeGapAnchored`` (ruling
      // 8i(e)) folds jump-tie bridge anchoring into the SAME arithmetic the engine emits against
      // — the gate must consume it so its corr count matches the sweep's (no drift).
      const section = buildSectionInput(columns, edges, undefined, alongM)
      const { activeTies, bridgeGapAnchored } = emitCurves(section)
      const geom = section.columns // ColumnGeom[] with topElev/baseElev per unit

      const sec0 = { '0corr-not-lens': 0, '1corr-not-onlap': 0, '2corr-not-band': 0, 'q3-legit': 0, '8e-enclosure': 0, 'cap': 0 }

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
          // Ruling 8i(e): fold the bridge-anchor extension so a bridge-near unit reads corr 1
          // (onlap) — the SAME arithmetic the sweep emits against (topTied/baseTied → hasAnchor).
          const flags = tiedFlags(gi, side, col.units.length, activeTies, bridgeGapAnchored)
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
            // Ruling 8d (§8): the TOP BAND is an implicit tie for the FIRST unit — BUT only as
            // the UPPER anchor of a band paired with a real/derived BASE tie. It does NOT on its
            // own make a first unit 1-corr: a first unit tied ONLY by the top band (no base tie,
            // nothing to band to) is the genuine §8-Q3 surface void and stays 0-corr. So the
            // top band folds into the 2-corr test (``firstUnitTopBandBand`` below) but NOT into
            // ``topTied`` / ``hasAnchor``.
            const topBandTied = topBandTies(ui)
            const topTied = direct.top || derived.topShared
            const baseTied = direct.base || derived.baseShared
            // Effective OUTCOME per the owner's 2/1/0 vocabulary (ruling 8/8a/8b/8d), mirroring
            // the engine's own band signal — NOT a naive tied-contact count:
            //   2 → BAND: the unit is a MATCHED-PAIR BAND member (``collectGapBands`` — a
            //       same-side, SAME-FORMATION tie between the two facing units; that pair spans
            //       the gap full-width by construction, §4 increment-7), OR a FIRST unit whose
            //       base rides a real/derived tie — ruling 8d makes the top band an implicit
            //       tie, so such a first unit is banded between the top band and its base tie
            //       (a same-formation band, or a no-auto-facies pair of midpoint quads when the
            //       facing formation differs). A unit sandwiched between two DIFFERENT-formation
            //       tied bands is a MINORITY (mixed-bracket, §4 residual (b)), NOT a band — so a
            //       naive "both contacts tied → 2" would wrongly count it. Band membership +
            //       the ruling-8d first-unit case are the correct band tests.
            //   1 → ONLAP: the unit is not a band member but a tie touches it — either a DIRECT
            //       correlation edge on its own contact, or a ruling-8a shared contact with a
            //       directly-adjacent same-side tied band (a DERIVED onlap). Tip ~0.5, riding
            //       the tie.
            //   0 → LENS: no tie touches the unit and no adjacent band shares a contact.
            const bandMember = isBandMember(bands, side, ui)
            // Ruling 8d: a first unit whose base is tied (direct/derived) bands between the top
            // band and the base tie — 2-corr even when it is not a same-formation matched pair.
            const firstUnitTopBandBand = topBandTied && baseTied
            const hasAnchor = unitHasDirectTie(gi, side, ui, activeTies) || topTied || baseTied
            const corr: 0 | 1 | 2 = bandMember || firstUnitTopBandBand ? 2 : hasAnchor ? 1 : 0

            const rs = renderedShape(regs, u.formationId, bandLo, bandHi, side)
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
            // Ruling 8e (§8): the full-width render is enclosed by the unit's OWN formation's
            // legitimately-tied face (a matched-pair band of that formation exists in the gap)
            // → ONE body by construction, a gate false positive. Only checked on a full-width /
            // band render — an ABSENT minority is never 8e-exempt (the missing lens IS the
            // engine work ruling 8e's condition mandates).
            const enclosedByOwnTiedBand = sameFormationEnclosedByTiedBand(bands, u.formationId)

            // OWNER 2026-07-26 — RENDER-BACKED FALSE-POSITIVE ACCEPTS. The strict bbox 0/1/2 shape
            // rule over-flags three CORRECT geometries; each is proven non-data-loss by the
            // ground-truth overpaint gate (partitionFillV2.groundTruth.diag.test.ts — every drilled
            // unit renders its own litho at its own column edge, 0 hits). Each predicate carries a
            // NEGATIVE guard so a genuine defect still trips:
            //   (A) SAME-LITHO FACING BAND — the FACING column carries the unit's OWN formation
            //       across the band, so two same-litho terminations merge into ONE band (ruling 8j;
            //       owner's "1 corr = follow tie = same litho = no onlap"). TS10-g0 ZAND[R] (corr-1),
            //       CS1-g22 SILT[L] (corr-0). GUARD: a DIFFERENT-litho facing → false → flagged.
            // SCOPED to the flag-ON literal-8l PRODUCT path — the flag-OFF frozen seam-engine
            // reference stays pinned by identity (a different, older arrangement; not disturbed).
            const acceptsOn = twoSidedTerminationsEnabled()
            const sameLithoFacingBand =
              acceptsOn &&
              facing.units.some(
                (fu) => fu.formationId === u.formationId && Math.min(fu.topElev, bandHi) - Math.max(fu.baseElev, bandLo) > 1e-6,
              )
            //   (B) SUB-TD SUBSTRATE STRADDLE — a full-width render whose unit DIPS below the gap's
            //       shallow TD is full-width because of the deep-to-deep substrate below the floor,
            //       not a termination band; above the floor it onlaps. CS1-g18 ZAND[R], CS1-g19
            //       KLEI[L] (both corr-1). GUARD: a unit ENTIRELY above the shallow TD that renders
            //       full-width stays flagged (a real 1corr-not-onlap). Extends the existing
            //       whole-unit substrate exclusion (bandHi ≤ shallowTD) to the STRADDLING unit.
            const subTdStraddle = acceptsOn && bandLo < shallowTD - 1e-3 && bandHi > shallowTD + 1e-3
            //   (C) OWN FULL-WIDTH BAND COMPONENT EXISTS — a corr-2 unit the incident-component
            //       picker scored as a partial onlap while a full-width SAME-formation component DOES
            //       span the gap over the band (a dipping band split at the unit's window boundary).
            //       CS1-g12 KLEI[L]. GUARD: no full-width own component → genuinely absent/partial →
            //       flagged (the real 2corr-not-band).
            const ownFullWidthBandComp =
              acceptsOn &&
              regs.some((r) => {
                if (r.formationId !== u.formationId) return false
                let flo = Infinity, fhi = -Infinity, elo = Infinity, ehi = -Infinity
                for (const p of r.polygon) {
                  if (p.fraction < flo) flo = p.fraction
                  if (p.fraction > fhi) fhi = p.fraction
                  if (p.elevation < elo) elo = p.elevation
                  if (p.elevation > ehi) ehi = p.elevation
                }
                // Full-width AND vertically OVERLAPPING or CONTIGUOUS-below the unit's band within
                // 10 cm — a dipping band split at the window boundary touches the unit's base (CS1-g12
                // KLEI: the full-width band [-10.36..-6.02] meets the unit [-6.02..-4.72] at -6.02).
                return flo <= 0.02 && fhi >= 0.98 && Math.min(ehi, bandHi) - Math.max(elo, bandLo) > -0.1
              })

            if (corr === 0) {
              // Rule: SMALL LENS around the unit — never full-width, never band.
              if (rs.shape === 'band' || (rs.reachesLeft && rs.reachesRight)) {
                // Full-width: a violation UNLESS it is a genuine §8 Q3 void case (tag, not flag)
                // OR a ruling-8e same-formation enclosure by an own-formation tied band.
                if (enclosedByOwnTiedBand || sameLithoFacingBand) {
                  // Accept (A): a corr-0 minority merged into a same-formation matrix (the facing
                  // carries the unit's own litho across the band → the 8j merge welds them into one
                  // body — you cannot draw a silt lens inside silt). CS1-g22 SILT[L].
                  advisory = '8e-enclosure'
                  note = '0-corr full-width but same-formation enclosure / merge (one body)'
                } else if (isSurfaceFirst || facesShallowVoid) {
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
              // Ruling 8g(b) (design §8, 2026-07-16): a purely BASE-TIED 1-corr unit whose
              // facing side carries the SAME formation across the gap connects into ONE band
              // through the shared base tie ("with or without the extra sand-top tie the sands
              // connect" — the Tie-10 g0 ZANDs). Its EXPECTED shape is BAND, not onlap. Computed
              // here so the corr==1 full-width branch below accepts a band render for it.
              const baseTiedPair = sameFormationBaseTiedPair(baseTied, topTied, u.formationId, bandLo, bandHi, facing)
              // Rule: ONLAPS its tie (tip ~0.5, riding the tie line) — UNLESS 8g(b) bands it.
              if (rs.shape === 'band' || (rs.reachesLeft && rs.reachesRight)) {
                // Ruling 8g(b): a base-tied same-formation pair is ONE band — the full-width
                // render is CORRECT (not a violation), tagged like the 8e one-body case.
                if (baseTiedPair || sameLithoFacingBand) {
                  // Accept (A): a same-litho EMERGENT band — the facing carries the unit's own
                  // formation across the band, so the two same-litho onlaps merge into one band
                  // (ruling 8j; owner's "1 corr = follow tie = same litho = no onlap"). Generalises
                  // 8g(b) to any tie side. TS10-g0 ZAND[R].
                  advisory = '8e-enclosure'
                  note = '1-corr full-width but same-litho emergent band (one body)'
                } else if (subTdStraddle) {
                  // Accept (B): the full-width render is the deep-to-deep SUBSTRATE below the gap's
                  // shallow TD (the unit dips below the floor); above the floor it onlaps. Not a
                  // termination band. CS1-g18 ZAND[R], CS1-g19 KLEI[L].
                  advisory = '8e-enclosure'
                  note = `1-corr full-width but sub-TD substrate straddle (band dips below shallowTD ${round(shallowTD)})`
                } else if (enclosedByOwnTiedBand) {
                  // Ruling 8e: a full-width same-formation render enclosed by its OWN formation's
                  // tied band is one body by construction (the Tie-4 ZAND boundary unit merging
                  // into the ZAND matched band above — "it should be one sand"). Gate false
                  // positive, tagged not flagged. NO tie of that formation in the gap → stays a
                  // violation (ruling 8 opposing-lens case).
                  advisory = '8e-enclosure'
                  note = '1-corr full-width but §8-e same-formation enclosure by own tied band (one body)'
                } else {
                  violation = '1corr-not-onlap'
                  note = '1-corr unit renders full-width instead of onlapping its tie'
                }
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
              // Ruling 8d subtlety: a FIRST unit banded between the top band and its base tie
              // whose FACING first unit carries a DIFFERENT formation is the no-auto-facies pair
              // of MIDPOINT QUADS — per side each quad reaches only its OWN column edge and meets
              // the facing formation's quad at the vertical midpoint seam. That renders as an
              // ``onlap`` shape (reaches one edge) on this side, which is the CORRECT band render;
              // it must NOT be flagged 2corr-not-band. A same-formation first-unit band, and a
              // matched-pair band, still render full-width and are held to ``band``.
              const facingFirstDiffers =
                firstUnitTopBandBand &&
                facing.units.length > 0 &&
                facing.units[0].formationId !== u.formationId
              const midpointQuadOk =
                facingFirstDiffers && (rs.reachesLeft !== rs.reachesRight) && rs.shape !== 'absent'
              // Accept (C): the incident-component picker scored a PARTIAL onlap piece even though a
              // full-width SAME-formation band component DOES span the gap over the band (a dipping
              // band split at the unit's window boundary — CS1-g12 KLEI[L]). The band exists → the
              // corr-2 render is correct. GUARD: no full-width own component → still flagged.
              if (rs.shape !== 'band' && !midpointQuadOk && !ownFullWidthBandComp) {
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
            } else if (advisory === '8e-enclosure') {
              grand['8e-enclosure']++
              sec0['8e-enclosure']++
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
        '8e-enclosure': sec0['8e-enclosure'],
        'reach-cap-advisory': sec0['cap'],
      })

      console.log(
        `\n=== ${sec.name}: cols=${columns.length} v2reg=${r2.length} | ` +
          `0corr-not-lens=${sec0['0corr-not-lens']} 1corr-not-onlap=${sec0['1corr-not-onlap']} ` +
          `2corr-not-band=${sec0['2corr-not-band']} | q3-legit=${sec0['q3-legit']} ` +
          `8e-encl=${sec0['8e-enclosure']} reach-cap(adv)=${sec0['cap']}`,
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
    console.log(`  advisory 8e-enclosure (ruling 8e one-body)  : ${grand['8e-enclosure']}  (gate false positive, tagged not flagged)`)
    console.log(`  dumped -> ${DUMP}`)
    console.log('##############################################')
    return { grand, rows }
  }
}

/** A pinned conformance instance identity (order-independent). ``layerId`` is deliberately
 * OMITTED — its 8-char slice is not unique across units — so the key is
 * section/gap/formation/side/corr/shape/elevation. */
interface Pin {
  section: string; gap: number; formation: string; side: 'left' | 'right'
  corr: 0 | 1 | 2; shape: RenderShape; violation: ViolClass
}
function pinKey(p: { section: string; gap: number; formation: string; side: 'left' | 'right'; corr: 0 | 1 | 2; shape: RenderShape; violation: ViolClass }): string {
  return `${p.section}|gap${p.gap}|${p.formation}|${p.side}|corr${p.corr}|${p.shape}|${p.violation}`
}

/** Diff the observed violation rows against a pinned baseline and assert exact equality:
 * fail on ANY new instance AND on any silent disappearance (a legitimate fix updates the pin
 * in the same commit — the ratchet). */
function assertRatchet(label: string, rows: ConfRow[], baseline: Pin[]): void {
  const observed = rows
    .filter((r): r is ConfRow & { violation: ViolClass } => r.violation != null)
    .map((r) => pinKey({ ...r, violation: r.violation as ViolClass }))
    .sort()
  const expected = baseline.map((p) => pinKey(p)).sort()
  const observedSet = new Set(observed)
  const expectedSet = new Set(expected)
  const added = [...observedSet].filter((k) => !expectedSet.has(k))
  const gone = [...expectedSet].filter((k) => !observedSet.has(k))
  expect(added, `${label}: NEW conformance instance(s) not in the pinned baseline (fix the engine or update the pin): ${added.join('  ||  ') || '(none)'}`).toEqual([])
  expect(gone, `${label}: pinned instance(s) DISAPPEARED (a real fix — update the pinned list in this commit): ${gone.join('  ||  ') || '(none)'}`).toEqual([])
  // Exact multiplicity too (guards a case where one instance is replaced by another sharing a key).
  expect(observed.length, `${label}: total pinned instance count`).toBe(baseline.length)
}

describe('v2 full 2/1/0 conformance gate (S38 HARD GATE)', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  // FLAG-OFF baseline — the DOCUMENTED historical seam-engine conformance. This block
  // AUDITS THE FROZEN FLAG-OFF RENDER with the pre-8l inline arithmetic (intentional, per
  // REWRITE_STATE §24/§25): the classifier's 2/1/0 derivation reflects the pre-8l engine,
  // and the flag-OFF render is byte-identical to the pre-campaign engine. Baseline is
  // 5 × 0corr-not-lens + 5 × 1corr-not-onlap + 0 × 2corr-not-band = TOTAL 10. Pinned EXACTLY:
  // a rise above 10 (new defect) AND a drop below 10 (silent movement) both fail.
  const FLAG_OFF_BASELINE: Pin[] = [
    { section: 'Tie-section 10', gap: 0, formation: 'ZAND', side: 'right', corr: 0, shape: 'absent', violation: '0corr-not-lens' },
    { section: 'Tie-section 10', gap: 0, formation: 'ZAND', side: 'right', corr: 1, shape: 'band', violation: '1corr-not-onlap' },
    { section: 'Tie-section 12', gap: 0, formation: 'SILT', side: 'right', corr: 1, shape: 'band', violation: '1corr-not-onlap' },
    { section: 'Cross-section 1', gap: 7, formation: 'SILT', side: 'right', corr: 0, shape: 'absent', violation: '0corr-not-lens' },
    { section: 'Cross-section 1', gap: 18, formation: 'ZAND', side: 'right', corr: 1, shape: 'band', violation: '1corr-not-onlap' },
    { section: 'Cross-section 1', gap: 19, formation: 'KLEI', side: 'left', corr: 1, shape: 'band', violation: '1corr-not-onlap' },
    { section: 'Cross-section 1', gap: 20, formation: 'ZAND', side: 'right', corr: 0, shape: 'absent', violation: '0corr-not-lens' },
    { section: 'Cross-section 1', gap: 22, formation: 'SILT', side: 'left', corr: 0, shape: 'band', violation: '0corr-not-lens' },
    { section: 'Cross-section 1', gap: 22, formation: 'ZAND', side: 'left', corr: 0, shape: 'absent', violation: '0corr-not-lens' },
    { section: 'Cross-section 2', gap: 13, formation: 'SILT', side: 'right', corr: 1, shape: 'band', violation: '1corr-not-onlap' },
  ]

  it('FLAG-OFF: frozen seam-engine conformance == 5/5/0 (TOTAL 10), pinned by identity', () => {
    console.log('\n===== CONFORMANCE FLAG-OFF (frozen seam engine, pre-8l arithmetic) =====')
    const { grand, rows } = classifyAllSections()
    const total = grand['0corr-not-lens'] + grand['1corr-not-onlap'] + grand['2corr-not-band']
    // Hard totals: any rise (new defect) OR drop (silent movement) fails.
    expect(grand['0corr-not-lens'], 'flag-OFF 0corr-not-lens must be 5').toBe(5)
    expect(grand['1corr-not-onlap'], 'flag-OFF 1corr-not-onlap must be 5').toBe(5)
    expect(grand['2corr-not-band'], 'flag-OFF 2corr-not-band must be 0').toBe(0)
    expect(total, 'flag-OFF total conformance violations must be exactly 10').toBe(10)
    assertRatchet('FLAG-OFF', rows, FLAG_OFF_BASELINE)
  })

  // FLAG-ON conformance — the literal-8l product path. Pinned BY IDENTITY as a RATCHET (fail on ANY
  // new instance AND on any silent disappearance — a legitimate fix updates this list in the same
  // commit). NOT an aspirational 0. These are the known walls: the shape=absent rows are
  // conformance-classifier artefacts at legitimate voids on the flag-ON render; the shape=band rows
  // are 8l emergent bands (a corr-1 onlap that merges full-width by the 8j post-fill merge).
  //
  // SESSION 50 (ruling 8n band-contour lens clamp): the CS2-g13 KLEI×ZAND overlap fix — adding the
  // gap's matched-pair band CONTOURS to the interior-lens collision brackets
  // (``gapBandContourBrackets``) — shortened FIVE band-crossing interior lenses (CS2-g13 KLEI,
  // CS1-g11 ZAND/SILT, CS2-g11 KLEI, CS2-g17 SILT). That restructured the enclosing-flood arrangement
  // enough to RESOLVE FOUR pinned ``absent`` violations with NO new violation (holes/overlaps stayed
  // 0/0): the two S40 F5 flood-absorption instances (CS1-g3 SILT + CS2-g21 SILT, previously
  // "closes with the termination-plan rebuild") now render their lens, and the TS7-g0 KLEI onlaps
  // (left+right) now render. The clamp is the correct 8n application (a band contour is a bracket
  // exactly like a tie), so those four closed as a side effect — the ratchet drops 14 → 10.
  // SAFE-DEFAULT DATA-LOSS REPAIR (owner 2026-07-26, ratchet 10 -> 5): FIVE of the pinned rows were
  // NOT classifier artefacts but HIDDEN DATA LOSS -- the drilled unit's OWN column edge rendered a
  // FOREIGN litho, its own regions absent (region evidence): TS11-g0 ZAND->silt, CS3-g6 KLEI->sand,
  // CS3-g7 ZAND->clay, CS2-g13 SILT->sand, CS2-g21 ZAND->silt. The holes gate can't see this (the
  // space is filled, just the wrong litho). Root cause: a flooded corr-2 BAND MEMBER was skipped by
  // the sweep (`if (c === 2) continue`) before the force-onlap bypass. FIX: detectFloodedUnits (which
  // already flagged them) -> the sweep now WIRES a forced-flooded corr-2 unit through as a corr-1
  // onlap so its litho survives (holes/overlaps stayed 0/0/0). Negative guard:
  // partitionFillV2.dataLossRepair.test.ts asserts each renders its drilled litho, so this drop can
  // never silently hide a re-regression.
  // CLASSIFIER FALSE-POSITIVE ACCEPTS (owner 2026-07-26, ratchet 5 -> 0). The remaining five were
  // render-correct classifier false-positives — the strict bbox 0/1/2 shape rule over-flagged three
  // CORRECT geometries, ALL proven non-data-loss by the ground-truth overpaint gate
  // (partitionFillV2.groundTruth.diag.test.ts: every drilled unit renders its own litho at its own
  // column edge, 0 hits across all 14 sections). Three guarded predicates (flag-ON only; see the
  // classify loop) accept them, each with a NEGATIVE guard so a genuine defect still trips:
  //   (A) same-litho FACING band -> TS10-g0 ZAND (corr-1), CS1-g22 SILT (corr-0): the facing carries
  //       the unit's own formation across the band, the 8j merge welds one body.
  //   (B) sub-TD substrate STRADDLE -> CS1-g18 ZAND, CS1-g19 KLEI (corr-1): the full-width render is
  //       the deep-to-deep substrate below the shallow TD, not a termination band.
  //   (C) own full-width band component EXISTS -> CS1-g12 KLEI (corr-2): a dipping band split at the
  //       unit's window boundary; the full-width KLEI band [-10.36..-6.02] meets the unit at -6.02.
  // The overpaint gate is the independent backstop: if any accept ever wrongly swallows real data
  // loss, that gate goes RED. Flag-ON conformance is now a true 0.
  const FLAG_ON_BASELINE: Pin[] = []

  it('FLAG-ON: literal-8l conformance == 0 (all shape-FPs accepted as guarded advisories)', () => {
    console.log('\n===== CONFORMANCE FLAG-ON (literal-8l product path) =====')
    const prev = setTwoSidedTerminations(true)
    let rows: ConfRow[]
    let grand: ReturnType<typeof classifyAllSections>['grand']
    try {
      ({ grand, rows } = classifyAllSections())
    } finally {
      setTwoSidedTerminations(prev)
    }
    const total = grand['0corr-not-lens'] + grand['1corr-not-onlap'] + grand['2corr-not-band']
    expect(total, 'flag-ON total conformance instances must be 0 (all shape-FPs accepted)').toBe(0)
    assertRatchet('FLAG-ON', rows, FLAG_ON_BASELINE)
  })
})
