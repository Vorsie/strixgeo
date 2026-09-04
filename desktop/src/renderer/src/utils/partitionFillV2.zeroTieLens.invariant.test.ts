/**
 * partitionFillV2.zeroTieLens.invariant.test.ts — THE 2/1/0 SKELETON INVARIANT.
 *
 * OWNER, 2026-09-04 (escalation, verbatim): "2/1/0 is the skeletal framework of our
 * interpolation mechanism — it has always been like that." The rule (docs/design/
 * section-fill.md, the contact-correlation model):
 *
 *   a unit's shape toward a neighbour is decided by how many of its TWO bounding
 *   contacts are correlated to that neighbour —
 *     0 correlated contacts → LENS   (pinches out INSIDE the gap; its polygon has
 *                                      NO vertex on the facing column; reaches neither edge)
 *     1 correlated contact  → ONLAP  (rides its tie, reaching the tied column)
 *     2 correlated contacts → BAND   (spans the gap)
 *
 * "0 ties is ALWAYS a lens — regardless of the facing column's TD, sub-TD substrate,
 * blind columns, surface-topped units, or any other exception path." (owner escalation).
 *
 * ONE PHYSICAL EXEMPTION, owner-ruled and kept (design §8 ruling 8e / 8j): a 0-tie
 * minority whose FACING column carries the SAME formation across its window is ONE BODY
 * with that facing run ("it should be one sand" / "1 corr = follow tie = same litho =
 * no onlap"). You cannot draw a visible silt lens inside continuous silt — a
 * same-formation full-width render is correct, not a violation. The invariant below
 * therefore governs a DIFFERENT-formation 0-tie minority: that one must be a visible lens.
 *
 * This gate is PERMANENT + ALWAYS-ON (not env-gated), run against the PRODUCT engine path
 * (two-sided terminations sweep, flag ON — the same flag ``partitionEngineSelect`` wraps
 * every render/voxel/fence call with). Two fixtures:
 *   1. ``__fixtures__/zeroTie_edged_minority.json`` — the anonymised S22 case (a sand
 *      minority enclosed by silt, 0 ties toward a shallow facing test whose TD falls
 *      INSIDE the sand's range, a top tie to a right band column). The invariant assertion
 *      here is RED on the current engine (the sand is absorbed by the enclosing silt flood
 *      — the documented ``ENABLE_ENCLOSED_LENS_EDGED`` wall, design §4 residual (b)).
 *   2. ``__fixtures__/cs1_golden_input.json`` — the frozen CS1 section. A GREEN regression
 *      guard: no DIFFERENT-formation 0-tie minority may render full-width/absent; every
 *      1-tie / 2-tie unit must at least appear.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves } from './partitionFillV2/emitCurves'
import { collectGapBands } from './partitionFillV2/emitBands'
import {
  derivedBandTies, isBandMember, renderedShape, shallowTDForGap,
  tiedFlags, topBandTies, unitHasDirectTie, FULL_EPS,
} from './partitionFillV2.conformance.classify'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX_DIR = resolve(HERE, '__fixtures__')
const EDGED_MINORITY = resolve(FIX_DIR, 'zeroTie_edged_minority.json')
const CS1_GOLDEN = resolve(FIX_DIR, 'cs1_golden_input.json')
// The full real S22 section (10 columns) is a scratchpad input, not checked in — a guarded
// assertion runs it only when the path is provided (S22_FULL_INPUT env). Skip when absent.
const S22_FULL = process.env.S22_FULL_INPUT

/** Run the fill on the PRODUCT engine path (two-sided terminations sweep, flag ON). */
function productFill(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[],
): SectionRegion[] {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2(columns, edges, undefined, alongM)
  } finally {
    setTwoSidedTerminations(prev)
  }
}

function normEdges(raw: { a: string; b: string; aSide?: string; bSide?: string }[]): CorrelationEdge[] {
  return raw.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
}

function fracExtent(poly: readonly PartitionPoint[]): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const p of poly) { if (p.fraction < lo) lo = p.fraction; if (p.fraction > hi) hi = p.fraction }
  return [lo, hi]
}

// ---------------------------------------------------------------------------
// Fixture 1 — the S22 edged same-formation-enclosed minority (RED: the owner's rule).
// ---------------------------------------------------------------------------
describe('2/1/0 is the skeleton: 0 ties is always a lens', () => {
  interface EdgedFixture {
    columns: PartitionColumn[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[]
    alongM: number[]; sandLayerId: string; owningColumnIndex: number; untiedGapIndex: number; tiedGapIndex: number
  }

  it('a 0-tie DIFFERENT-formation minority pinches INSIDE the untied gap and never reaches the facing column (S22)', () => {
    const fx = JSON.parse(readFileSync(EDGED_MINORITY, 'utf8')) as EdgedFixture
    const regions = productFill(fx.columns, normEdges(fx.edges), fx.alongM)

    // The owning column of the minority is the RIGHT column of the untied gap (fraction 1);
    // the untied FACING column is at fraction 0. The sand must render there as a visible lens.
    const untied = regions.filter((r) => r.gapIndex === fx.untiedGapIndex && (r.layerIds ?? []).includes(fx.sandLayerId))

    // (a) PRESENT — 0 ties does NOT mean absent; the drilled minority still renders (its own
    //     column shows its own litho — ruling 8k). Absorbed-by-the-enclosing-flood = data loss.
    expect(untied.length, 'the 0-tie sand minority must RENDER in the untied gap (not be absorbed by the enclosing silt flood)').toBeGreaterThan(0)

    // (b) LENS — it pinches inside the gap: no vertex touches the facing (untied) column edge.
    for (const r of untied) {
      const [flo] = fracExtent(r.polygon)
      expect(flo, `the 0-tie sand minority must NOT reach the untied facing column (fraction 0); got a vertex at fraction ${flo.toFixed(3)}`).toBeGreaterThan(FULL_EPS)
    }

    // MIRROR — in the TIED gap the same sand BANDS (2 ties) / at least reaches the tied column.
    const tied = regions.filter((r) => r.gapIndex === fx.tiedGapIndex && (r.layerIds ?? []).includes(fx.sandLayerId))
    expect(tied.length, 'the sand must still band toward its tied neighbour').toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Fixture 2 — CS1 golden regression guard (GREEN): no different-formation 0-tie minority
// may render full-width/absent; every tied unit must appear.
// ---------------------------------------------------------------------------
describe('2/1/0 skeleton — CS1 golden regression guard', () => {
  function groupByGap(regions: SectionRegion[]): Map<number, SectionRegion[]> {
    const m = new Map<number, SectionRegion[]>()
    for (const r of regions) { if (!m.has(r.gapIndex)) m.set(r.gapIndex, []); m.get(r.gapIndex)!.push(r) }
    return m
  }

  it('no DIFFERENT-formation 0-tie minority renders full-width/absent; tied units always appear', () => {
    if (!existsSync(CS1_GOLDEN)) { expect(true).toBe(true); return }
    const raw = JSON.parse(readFileSync(CS1_GOLDEN, 'utf8')) as {
      columns: PartitionColumn[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[]
      alongM: number[]; lithoSoil?: Record<string, string>
    }
    const soil = raw.lithoSoil ?? {}
    const fname = (id: string): string => soil[id] ?? id.slice(0, 10)
    const edges = normEdges(raw.edges)

    const prev = setTwoSidedTerminations(true)
    const violations: string[] = []
    try {
      const regions = computeSectionFillV2(raw.columns, edges, undefined, raw.alongM)
      const gaps = groupByGap(regions)
      const section = buildSectionInput(raw.columns, edges, undefined, raw.alongM)
      const { activeTies, bridgeGapAnchored } = emitCurves(section)
      const geom = section.columns

      for (let ci = 0; ci < geom.length; ci++) {
        const col = geom[ci]
        for (const gi of [ci - 1, ci] as const) {
          if (gi < 0 || gi + 1 >= geom.length) continue
          const side: 'left' | 'right' = ci === gi ? 'left' : 'right'
          const facing = side === 'left' ? geom[gi + 1] : geom[gi]
          const regs = gaps.get(gi) ?? []
          const flags = tiedFlags(gi, side, col.units.length, activeTies, bridgeGapAnchored)
          const bands = collectGapBands(gi, geom[gi], geom[gi + 1], activeTies)
          const shallowTD = shallowTDForGap(geom[gi], geom[gi + 1])
          for (let ui = 0; ui < col.units.length; ui++) {
            const u = col.units[ui]
            const bandLo = u.baseElev, bandHi = u.topElev
            if (bandHi <= shallowTD + 1e-3) continue // deep-to-deep substrate zone (owner §8 Q3)
            const direct = flags[ui]
            const derived = derivedBandTies(gi, side, ui, col, facing, activeTies)
            const topTied = direct.top || derived.topShared
            const baseTied = direct.base || derived.baseShared
            const bandMember = isBandMember(bands, side, ui)
            const firstUnitTopBandBand = topBandTies(ui) && baseTied
            const hasAnchor = unitHasDirectTie(gi, side, ui, activeTies) || topTied || baseTied
            const corr: 0 | 1 | 2 = bandMember || firstUnitTopBandBand ? 2 : hasAnchor ? 1 : 0
            const rs = renderedShape(regs, u.formationId, bandLo, bandHi, side)
            // The ONE physical exemption (design §8 8e/8j): the facing carries the unit's OWN
            // formation across the window → one body, a same-colour full-width is correct.
            const sameLithoFacing = facing.units.some(
              (fu) => fu.formationId === u.formationId && Math.min(fu.topElev, bandHi) - Math.max(fu.baseElev, bandLo) > 1e-6,
            )
            const label = `gap${gi} ${fname(u.formationId)} [${side}] corr=${corr} shape=${rs.shape}`
            if (corr === 0) {
              if (sameLithoFacing) continue // one body (8e/8j) — not a violation
              if (rs.shape === 'band' || (rs.reachesLeft && rs.reachesRight)) violations.push(`0corr-not-lens (full-width): ${label}`)
              else if (rs.shape === 'absent') violations.push(`0corr-not-lens (absent): ${label}`)
            } else if (corr === 1) {
              if (rs.shape === 'absent') violations.push(`1corr-absent: ${label}`)
            } else {
              if (rs.shape === 'absent') violations.push(`2corr-absent: ${label}`)
            }
          }
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
    expect(violations, `CS1 golden 2/1/0 skeleton violations:\n  ${violations.join('\n  ')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fixture 3 — the full real S22 section, guarded (skip when the scratchpad input is absent).
// ---------------------------------------------------------------------------
describe('2/1/0 skeleton — full real S22 section (guarded)', () => {
  it('the S22 lower sand pinches inside its untied (left) gap on the full section', () => {
    if (!S22_FULL || !existsSync(S22_FULL)) { expect(true).toBe(true); return }
    const raw = JSON.parse(readFileSync(S22_FULL, 'utf8')) as {
      columns: PartitionColumn[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[]; along: number[]
    }
    const SAND = '01a0698b-da34-7145-936e-ebf79f2d7f61'
    const UNTIED_GAP = 6 // S1 (col 6) ↔ S22 (col 7)
    const regions = productFill(raw.columns, normEdges(raw.edges), raw.along)
    const untied = regions.filter((r) => r.gapIndex === UNTIED_GAP && (r.layerIds ?? []).includes(SAND))
    expect(untied.length, 'the S22 sand must render in its untied left gap (not be absorbed)').toBeGreaterThan(0)
    for (const r of untied) {
      const [flo] = fracExtent(r.polygon)
      expect(flo, 'the S22 sand must not reach S1 (fraction 0)').toBeGreaterThan(FULL_EPS)
    }
  })
})
