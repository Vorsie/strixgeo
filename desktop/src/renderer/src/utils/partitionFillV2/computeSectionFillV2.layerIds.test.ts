/**
 * partitionFillV2/computeSectionFillV2.layerIds.test.ts — region PRODUCING LAYERS
 * ("persist geometric body identity", layer-space wire rework 2026-08-12).
 *
 * Every non-fallback v2 region names the ``litho_layer`` ids whose drilled units
 * produced its paint (``SectionRegion.layerIds``) — the label-independent identity
 * evidence the body recompute persists (layer ids never change; body ids are the
 * labels the recompute itself rewrites, and body-labelled evidence oscillated in
 * production). Pins, on BOTH label paths (flag OFF = boundary-composition vote,
 * flag ON = seeded paint-bucket):
 *
 *   * a tie-born band spanning the gap names BOTH columns' producing layers;
 *   * a single-column unit's fill names only its OWN layer — never the
 *     different-formation neighbour that merely abuts it;
 *   * the sub-TD wedge under the sloping tied base is NOT painted at all — the flat-floor
 *     substrate that used to fill it (a fallback region naming no layer) is retired (owner
 *     2026-10-04, "no tie, no band").
 */

import { afterEach, describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

const CLAY = 'clay'
const SAND = 'sand'

interface U {
  top: number
  base: number
  f: string
  layerId: string
}
function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: null,
    })),
  }
}

/** Ray-cast point-in-polygon in fraction×elevation space. */
function inPoly(f: number, e: number, poly: { fraction: number; elevation: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const fi = poly[i].fraction
    const ei = poly[i].elevation
    const fj = poly[j].fraction
    const ej = poly[j].elevation
    if (ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi) inside = !inside
  }
  return inside
}

function regionAt(regions: SectionRegion[], gap: number, f: number, e: number): SectionRegion | undefined {
  return regions.find((r) => r.gapIndex === gap && inPoly(f, e, r.polygon))
}

/** The fixture from computeSectionFillV2.fallback.test.ts: a SAND band tied top-top +
 *  base-base over a sloping base, CLAY above (untied), the no-data void under the tied base on
 *  the shallow side. */
function fixture(): { columns: PartitionColumn[]; edges: CorrelationEdge[] } {
  const columns = [
    col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: 'L-clay' },
      { top: 3, base: 12, f: SAND, layerId: 'L-sand' },
    ]),
    col('R', 10, [
      { top: 0, base: 3, f: CLAY, layerId: 'R-clay' },
      { top: 3, base: 8, f: SAND, layerId: 'R-sand' },
    ]),
  ]
  const edges: CorrelationEdge[] = [
    { a: 'L-sand', b: 'R-sand', aSide: 'top', bSide: 'top' },
    { a: 'L-sand', b: 'R-sand', aSide: 'base', bSide: 'base' },
  ]
  return { columns, edges }
}

/** The assertions shared by both label paths. */
function assertLayerIds(regions: SectionRegion[]): void {
  // The tie-born SAND band was produced by BOTH columns' sand layers.
  const band = regionAt(regions, 0, 0.5, 5)
  expect(band?.formationId).toBe(SAND)
  expect([...(band?.layerIds ?? [])].sort()).toEqual(['L-sand', 'R-sand'])
  // Under the tied base, below the shallow TD: the no-data void — no region, so no layer.
  expect(regionAt(regions, 0, 0.9, -1)).toBeUndefined()
  // Every CLAY region names only clay layers — the abutting SAND is not evidence.
  const clays = regions.filter((r) => r.formationId === CLAY)
  expect(clays.length).toBeGreaterThanOrEqual(1)
  for (const r of clays) {
    for (const lid of r.layerIds ?? []) expect(['L-clay', 'R-clay']).toContain(lid)
  }
}

describe('computeSectionFillV2 — regions name their producing layers on both label paths', () => {
  afterEach(() => {
    setTwoSidedTerminations(false)
  })

  it('flag OFF (boundary-composition vote): band names both sand layers; the sub-TD void names none', () => {
    const { columns, edges } = fixture()
    assertLayerIds(computeSectionFillV2(columns, edges, undefined, [0, 40]))
  })

  it('flag ON (seeded paint-bucket): band names both sand layers; the sub-TD void names none', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      const { columns, edges } = fixture()
      assertLayerIds(computeSectionFillV2(columns, edges, undefined, [0, 40]))
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})
