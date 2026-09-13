/**
 * partitionFillV2.twoZeroTieLenses.test.ts — TWO ZERO-TIE CLAYS AROUND A PEAT ARE
 * TWO SEPARATE LENSES, NOT ONE WRAPPING MASS.
 *
 * OWNER, installer #35 dogfeed of project "fhdh", 2026-09-13 (verbatim): "by our
 * rule those clays surrounding the peat should be 2 separate lenses (0 ties is lens
 * left)". On the GEOTECH axis of Cross-section 1, column GEO-22/047-S5, a thin peat
 * (VEEN) band sits between a KLEI band above and a KLEI band below; neither clay is
 * tied to the left neighbour GEO-16/057-S43. The engine drew the two clays as ONE
 * clay mass wrapping the peat lens, reaching left as a single wedge. The 2/1/0 rule
 * (docs/design/section-fill.md, contact-correlation model) says each zero-tie unit is
 * its OWN lens pinching out inside the gap on its untied side: two separate clay
 * lenses (one above, one below the peat), and the peat between them stays its own lens.
 *
 * ROOT: ``partitionFillV2/sectionGeom.ts`` ``extractEnclosedLenses`` merged the two
 * KLEI enclosing units into one continuous matrix (keyed on ``formationId`` equality,
 * with no tie check on the enclosing matrix) and spliced ``s5_klei_below`` out, so its
 * face rendered under ``s5_klei_above``'s identity. This is the LITHO frame the geotech
 * hierarchical fill is built on, so the wrap showed on BOTH axes.
 *
 * The fill runs on the PRODUCT engine path (two-sided terminations sweep, flag ON — the
 * same flag ``partitionEngineSelect`` wraps every render/voxel/fence call with).
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, 'partitionFillV2/__fixtures__/fhdh_peat_two_clay_lenses.json')

interface Fixture {
  alongM: number[]
  kleiAboveLayerId: string
  kleiBelowLayerId: string
  veenLayerId: string
  leftColumnIndex: number
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  columns: PartitionColumn[]
}

const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
const EDGES: CorrelationEdge[] = fx.edges.map((e) => ({
  a: e.a,
  b: e.b,
  aSide: (e.aSide ?? 'top') as 'top' | 'base',
  bSide: (e.bSide ?? 'top') as 'top' | 'base',
}))

/** Run the fill on the PRODUCT engine path (two-sided terminations sweep, flag ON). */
function productFill(): SectionRegion[] {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2(fx.columns, EDGES, undefined, fx.alongM)
  } finally {
    setTwoSidedTerminations(prev)
  }
}

/** Min gap-fraction reached by a region's polygon (0 = left column, 1 = right column). */
function minFraction(poly: readonly PartitionPoint[]): number {
  return poly.reduce((lo, p) => Math.min(lo, p.fraction), Infinity)
}

/** Regions carrying a given drilled ``layerId`` in their paint provenance. */
function regionsWithLayer(regions: readonly SectionRegion[], layerId: string): SectionRegion[] {
  return regions.filter((r) => (r.layerIds ?? []).includes(layerId))
}

const FULL_EPS = 1e-6

describe("two zero-tie clays surrounding a peat are two separate lenses (owner, fhdh #35)", () => {
  it('the clay ABOVE and the clay BELOW the peat each render as their OWN unit — the below clay is not merged into the above clay', () => {
    const regions = productFill()

    const above = regionsWithLayer(regions, fx.kleiAboveLayerId)
    const below = regionsWithLayer(regions, fx.kleiBelowLayerId)

    // The clay below the peat must render as its OWN unit. On the wrapping engine it was
    // spliced into the clay above and never appeared — this is the RED assertion.
    expect(
      below.length,
      'the clay BELOW the peat must render as its own unit, not be absorbed into the clay above',
    ).toBeGreaterThan(0)
    expect(above.length, 'the clay ABOVE the peat must render').toBeGreaterThan(0)

    // They are TWO separate lenses: no single region carries BOTH clays' identities
    // (one mass enclosing the peat would).
    const merged = regions.filter(
      (r) =>
        (r.layerIds ?? []).includes(fx.kleiAboveLayerId) &&
        (r.layerIds ?? []).includes(fx.kleiBelowLayerId),
    )
    expect(
      merged.length,
      'the two clays must not be welded into one mass wrapping the peat',
    ).toBe(0)
  })

  it('0 ties is lens left: each zero-tie clay pinches out inside the gap and reaches neither the facing (left) column', () => {
    const regions = productFill()
    for (const layerId of [fx.kleiAboveLayerId, fx.kleiBelowLayerId]) {
      const owned = regionsWithLayer(regions, layerId)
      expect(owned.length, `clay ${layerId} must render`).toBeGreaterThan(0)
      for (const r of owned) {
        expect(
          minFraction(r.polygon),
          `clay ${layerId} has 0 ties left and must pinch INSIDE the gap (no vertex on the facing left column)`,
        ).toBeGreaterThan(FULL_EPS)
      }
    }
  })

  it('the peat between them stays its own lens', () => {
    const regions = productFill()
    const veen = regionsWithLayer(regions, fx.veenLayerId)
    expect(veen.length, 'the peat must render as its own unit').toBeGreaterThan(0)
    for (const r of veen) {
      expect(
        minFraction(r.polygon),
        'the peat has 0 ties left and must pinch INSIDE the gap (its own lens)',
      ).toBeGreaterThan(FULL_EPS)
    }
  })
})
