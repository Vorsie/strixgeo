/**
 * THE FIX, end to end — mirrors ``partitionFillV2/subTdContinuation.test.ts``'s
 * scene 3 (their real CS1 FAR/SHORT/DEEP columns) on the geotech constructive
 * arm. FAR reads the target band's elevation window; SHORT (the immediate
 * neighbour, a tiny gap away) is genuinely blind there; DEEP carries the
 * 0-tie band itself. Gap widths mirror the real proportions (a tiny
 * immediate gap, a much wider far gap) so the reach fraction's projected
 * apex lands cleanly inside the far gap, same as the real litho measurement.
 *
 * Before this build: the band simply stopped at SHORT's own column line —
 * nothing of its story ever reached the FAR gap at all (see
 * ``extendsToFarCurtain.test.ts`` for the "before" pin on the 2-column case).
 * After: the band's story reaches the FAR gap (FAR|SHORT), where it closes on
 * the correctly-scaled taper, ending in FAR's own class before reaching FAR's
 * column.
 *
 * The band's own gap (SHORT|DEEP) used to draw that stretch FLAT, at full
 * thickness, and the band then entered the far gap already part-pinched — a
 * step at SHORT, the one column that read nothing of it. The owner ruled that
 * out on 2026-08-25 (*"one smooth taper ofcourse"*, ``carriedTaper.ts``), so
 * this gap now carries its own share of the same single taper. Every assertion
 * below is unchanged by that: each samples the band's MID elevation, which the
 * taper holds all the way to the apex — they pin where the band's story
 * reaches and where it has closed, which is what this scene exists to prove.
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from './index'
import { computeSectionFillActive } from '../partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'

interface UnitSpec {
  layerId: string
  formationId: string
  top: number
  base: number
}
function column(id: string, surface: number, units: readonly UnitSpec[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      topDepthM: u.top,
      baseDepthM: u.base,
      bodyId: null,
    })),
  }
}
const tie = (a: string, b: string): CorrelationEdge => ({ a, b, aSide: 'top', bSide: 'top' })

function inRegion(f: number, e: number, region: SectionRegion): boolean {
  const ring = region.polygon
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.elevation > e !== b.elevation > e &&
      f < a.fraction + ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}
function classAt(
  regions: readonly SectionRegion[],
  gap: number,
  f: number,
  e: number,
): string | null {
  for (const r of regions) if (r.gapIndex === gap && inRegion(f, e, r)) return r.formationId
  return null
}

const SAND = 'f-sand'
const FAR_CLASS = 'g-a'
const SHORT_CLASS = 'g-b'
const TARGET_CLASS = 'g-c'

describe('bandContinuation, end to end — a band crosses a blind column and pinches at the true reader', () => {
  it('BCS1: the band paints full thickness through its own gap, then tapers into the far gap ending in the far test\'s own class', () => {
    // FAR x=0, SHORT x=90 (gap0 width 90), DEEP x=100 (gap1 width 10) — a
    // tiny immediate gap, a wide far gap, matching the real litho scene's
    // proportions closely enough that the reach fraction's apex lands
    // cleanly inside gap0 rather than overshooting it.
    const litho = {
      columns: [
        column('FAR', 20, [{ layerId: 'L-FAR', formationId: SAND, top: 0, base: 20 }]),
        column('SHORT', 20, [{ layerId: 'L-SHORT', formationId: SAND, top: 0, base: 20 }]),
        column('DEEP', 20, [{ layerId: 'L-DEEP', formationId: SAND, top: 0, base: 20 }]),
      ],
      edges: [tie('L-FAR', 'L-SHORT'), tie('L-SHORT', 'L-DEEP')],
    }
    const geotech: PartitionColumn[] = [
      // FAR reads the target's whole window (elevation 8..12) as part of a
      // wide band spanning the full depth.
      column('FAR', 20, [{ layerId: 'GA', formationId: FAR_CLASS, top: 0, base: 20 }]),
      // SHORT logs only the top (depth 0..5 -> elevation 15..20) —
      // genuinely blind at the target's 8..12 elevation window.
      column('SHORT', 20, [{ layerId: 'GB', formationId: SHORT_CLASS, top: 0, base: 5 }]),
      // DEEP carries the 0-tie target band alone.
      column('DEEP', 20, [{ layerId: 'GC', formationId: TARGET_CLASS, top: 8, base: 12 }]),
    ]
    const alongM = [0, 90, 100]
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, alongM)
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      geotechColumns: geotech,
      geotechEdges: [],
      alongM,
    })

    // Gap 1 (SHORT|DEEP), the band's own gap — the band's story crosses it and
    // is still open at SHORT's own column line. It is no longer full thickness
    // there (it is closing along the one taper, per the 2026-08-25 ruling), but
    // its mid level runs the whole way to the apex, so the band is present.
    expect(
      classAt(out.regions, 1, 0.05, 10),
      "the band's own gap must still carry it right up beside the blind column",
    ).toBe(TARGET_CLASS)

    // Gap 0 (FAR|SHORT), the far gap — THE FIX. Near SHORT (fraction close
    // to 1) the target band's taper is still open: reads the target class.
    expect(
      classAt(out.regions, 0, 0.95, 10),
      'the far gap must carry the band\'s story near SHORT, where it has not pinched out yet',
    ).toBe(TARGET_CLASS)

    // Well before reaching FAR (fraction close to 0), the taper has already
    // closed: FAR's own class reads there instead.
    expect(
      classAt(out.regions, 0, 0.1, 10),
      "the taper must have closed well before FAR's own column — FAR's class reads there",
    ).toBe(FAR_CLASS)

    // The projected apex (0.45 of the full 100 m DEEP->FAR span = 45 m from
    // DEEP, i.e. x=55, gap0 fraction (55-0)/90 = 0.611) sits inside gap0 —
    // sample just past it and confirm the target class has already closed.
    expect(
      classAt(out.regions, 0, 0.5, 10),
      'past the projected apex the target class must already have pinched out',
    ).not.toBe(TARGET_CLASS)
  })
})
