/**
 * partitionFillV2/fillIdentity.augment.test.ts — geometric column-edge attribution
 * on the IDENTITY path (the S10–S6 refused-tie defect, dogfeed 2026-08-12).
 *
 * The rule, in the rule's own words: a fill region whose paint REACHES a column
 * over an elevation window where that column DRILLED a same-formation unit is
 * evidence OF that unit — even when the face's seed named a different (e.g. the
 * enclosed-lens-merged host's top) layer. On the real model, an interfingered
 * silt host emitted regions sitting exactly at three different silt units of
 * GEO-22/115-S10, yet all of them named only the seed layer (the column's TOP
 * silt); the middle silts appeared in ZERO regions, so they could never join a
 * connectivity group and their bodies never unioned.
 *
 * Behaviour pinned here: THREE stacked same-formation units separated by
 * other-formation interbeds on one column, ONE thick unit of that formation on
 * the other, tied — every one of the four layers' ids lands in the identity
 * groups, and all four end in ONE group.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { augmentRegionLayerIdsAtColumnEdges } from './fillIdentity'
import { type ColumnGeom, type RawLayerContact } from './sectionGeom'
import { computeSectionFillActiveWithIdentity } from '../partitionEngineSelect'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

const CLAY = 'clay'
const SILT = 'silt'

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

/**
 * The interfingering fixture: column L drills ONE thick silt; column R drills
 * THREE silts separated by clay interbeds (which the enclosed-lens merge
 * splices into one host unit carrying only R-silt1's id — exactly the S10
 * shape). One approved top-top tie bands/onlaps the silt across the gap, so
 * the engine emits gap regions at R's silt windows.
 */
function fixture(): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const columns = [
    col('L', 10, [
      { top: 0, base: 1, f: CLAY, layerId: 'L-clay' },
      { top: 1, base: 8, f: SILT, layerId: 'L-silt' },
    ]),
    col('R', 10, [
      { top: 0, base: 1, f: CLAY, layerId: 'R-clay0' },
      { top: 1, base: 2, f: SILT, layerId: 'R-silt1' },
      { top: 2, base: 3, f: CLAY, layerId: 'R-clay2' },
      { top: 3, base: 4, f: SILT, layerId: 'R-silt2' },
      { top: 4, base: 5, f: CLAY, layerId: 'R-clay3' },
      { top: 5, base: 6, f: SILT, layerId: 'R-silt3' },
    ]),
  ]
  const edges: CorrelationEdge[] = [{ a: 'L-silt', b: 'R-silt1', aSide: 'top', bSide: 'top' }]
  return { columns, edges, alongM: [0, 20] }
}

describe('fill identity — geometric column-edge attribution (v2 identity path)', () => {
  beforeEach(() => {
    // The identity path is the v2 engine's; pin it regardless of device pref.
  })
  afterEach(() => {
  })

  it('all four same-formation layers (3 interbedded + 1 thick) land in ONE identity group', () => {
    const { columns, edges, alongM } = fixture()
    const { regions, groups } = computeSectionFillActiveWithIdentity(columns, edges, undefined, alongM)

    // Every silt layer's id lands in the identity evidence at all (region layerIds).
    const namedAnywhere = new Set(regions.flatMap((r) => r.layerIds ?? []))
    for (const id of ['L-silt', 'R-silt1', 'R-silt2', 'R-silt3']) {
      expect(namedAnywhere, `layer ${id} named by at least one region`).toContain(id)
    }

    // ...and all four end in ONE connectivity group.
    const four = ['L-silt', 'R-silt1', 'R-silt2', 'R-silt3']
    const together = groups.some((g) => four.every((id) => g.includes(id)))
    expect(together, `one group contains all of ${four.join(', ')} — groups: ${JSON.stringify(groups)}`).toBe(true)
  })

  it('different-formation drilled units never join through the augmentation (interbeds stay out)', () => {
    const { columns, edges, alongM } = fixture()
    const { groups } = computeSectionFillActiveWithIdentity(columns, edges, undefined, alongM)
    // No group may mix silt and clay layer ids — geometric attribution is
    // same-formation only (a clay interbed abutting the silt paint is not silt evidence).
    const siltIds = new Set(['L-silt', 'R-silt1', 'R-silt2', 'R-silt3'])
    const clayIds = new Set(['L-clay', 'R-clay0', 'R-clay2', 'R-clay3'])
    for (const g of groups) {
      const hasSilt = g.some((id) => siltIds.has(id))
      const hasClay = g.some((id) => clayIds.has(id))
      expect(hasSilt && hasClay, `group mixes formations: ${JSON.stringify(g)}`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Focused helper cases — hand-built regions + columns, precision rules only.
// ---------------------------------------------------------------------------

const GEOM_COLS: ColumnGeom[] = [
  { investigationId: 'L', x: 0, surfaceElevM: 10, units: [], enclosedLenses: [] },
  { investigationId: 'R', x: 10, surfaceElevM: 10, units: [], enclosedLenses: [] },
]

function raw(entries: [string, RawLayerContact][]): ReadonlyMap<string, RawLayerContact> {
  return new Map(entries)
}

/** A full-gap quad region: fraction 0..1, elevation eLo..eHi. */
function quad(formationId: string, eLo: number, eHi: number, layerIds?: string[]): SectionRegion {
  return {
    formationId,
    bodyId: null,
    kind: 'quad',
    gapIndex: 0,
    polygon: [
      { fraction: 0, elevation: eHi },
      { fraction: 1, elevation: eHi },
      { fraction: 1, elevation: eLo },
      { fraction: 0, elevation: eLo },
    ],
    ...(layerIds ? { layerIds } : {}),
  }
}

describe('augmentRegionLayerIdsAtColumnEdges — precision rules', () => {
  it('unions strictly-overlapping same-formation raw units from BOTH column edges with the seeds', () => {
    const region = quad(SILT, 4, 8, ['seed'])
    const out = augmentRegionLayerIdsAtColumnEdges(
      [region],
      GEOM_COLS,
      raw([
        ['l-silt', { colIndex: 0, topElev: 9, baseElev: 2, formationId: SILT }],
        ['r-silt-a', { colIndex: 1, topElev: 8, baseElev: 7, formationId: SILT }],
        ['r-clay', { colIndex: 1, topElev: 7, baseElev: 6, formationId: CLAY }],
        ['r-silt-b', { colIndex: 1, topElev: 6, baseElev: 5, formationId: SILT }],
      ]),
    )
    // Seeds kept, both edges' same-formation drilled units added, clay excluded.
    expect(out[0].layerIds).toEqual(['seed', 'l-silt', 'r-silt-a', 'r-silt-b'])
  })

  it('a unit merely TOUCHING the span at a contact line does not attribute (strict > 1 mm overlap)', () => {
    const region = quad(SILT, 4, 8, ['seed'])
    const out = augmentRegionLayerIdsAtColumnEdges(
      [region],
      GEOM_COLS,
      raw([
        // Shares only the elevation-4 contact line with the span — abutment, not coverage.
        ['r-touch', { colIndex: 1, topElev: 4, baseElev: 3, formationId: SILT }],
      ]),
    )
    expect(out[0].layerIds).toEqual(['seed'])
    expect(out[0]).toBe(region) // untouched regions are the original objects
  })

  it('a fallback region is returned untouched — inferred fill names no layer', () => {
    const region = { ...quad(SILT, 4, 8), fallback: true as const }
    const out = augmentRegionLayerIdsAtColumnEdges(
      [region],
      GEOM_COLS,
      raw([['r-silt', { colIndex: 1, topElev: 8, baseElev: 4, formationId: SILT }]]),
    )
    expect(out[0]).toBe(region)
    expect(out[0].layerIds).toBeUndefined()
  })

  it('a region whose paint does not reach a column edge takes nothing from that column', () => {
    // Interior lens: fraction 0.2..0.8 — reaches neither column.
    const region: SectionRegion = {
      formationId: SILT,
      bodyId: null,
      kind: 'lens',
      gapIndex: 0,
      polygon: [
        { fraction: 0.2, elevation: 6 },
        { fraction: 0.8, elevation: 6 },
        { fraction: 0.5, elevation: 5 },
      ],
      layerIds: ['seed'],
    }
    const out = augmentRegionLayerIdsAtColumnEdges(
      [region],
      GEOM_COLS,
      raw([
        ['l-silt', { colIndex: 0, topElev: 9, baseElev: 2, formationId: SILT }],
        ['r-silt', { colIndex: 1, topElev: 9, baseElev: 2, formationId: SILT }],
      ]),
    )
    expect(out[0].layerIds).toEqual(['seed'])
  })

  it('absent raw contacts are a no-op copy', () => {
    const region = quad(SILT, 4, 8, ['seed'])
    expect(augmentRegionLayerIdsAtColumnEdges([region], GEOM_COLS, undefined)[0]).toBe(region)
  })
})
