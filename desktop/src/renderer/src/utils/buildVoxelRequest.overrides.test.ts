/**
 * The BUILD must use the same hand-drawn overrides the section view RENDERS with.
 *
 * Owner, 2026-07-30: the basal clay was missing from the 3-D model while Fill bands
 * showed it correctly. Cause: ``buildVoxelRequest`` passed ``undefined`` where
 * ``PartitionFillOverlay`` passes the derived apex/contact overrides, so the model
 * was built from the no-override partition. Measured on the dev model — the basal
 * clay banded across all 23 gaps of Cross-section 1 without overrides, while the
 * posted payload wedged it at four of them.
 *
 * This pins the wiring at the engine boundary rather than the geometry, because the
 * defect WAS the wiring: a single ``undefined`` argument. Asserting on region shapes
 * would need a fixture where an override happens to bite, which is fragile and would
 * not have caught this.
 */

import { describe, expect, it, vi } from 'vitest'
import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import type { FenceSectionInput } from './buildProjectFence'
import { buildVoxelRequest } from './buildVoxelRequest'
import * as engine from './partitionEngineSelect'

// One horizontal section, two columns, a through-going clay over a sand.
const sections: FenceSectionInput[] = [
  {
    section: { start_x: 0, start_y: 0, end_x: 100, end_y: 0 },
    projectedColumns: [
      { investigationId: 'A', alongM: 0, surfaceElevM: 10 },
      { investigationId: 'B', alongM: 100, surfaceElevM: 10 },
    ],
    layers: [
      {
        investigationId: 'A',
        layerId: 'a1',
        formationId: 'KLEI',
        bodyId: 'c',
        topDepthM: 0,
        baseDepthM: 4,
        accepted: true,
      },
      {
        investigationId: 'A',
        layerId: 'a2',
        formationId: 'ZAND',
        bodyId: 'z',
        topDepthM: 4,
        baseDepthM: 9,
        accepted: true,
      },
      {
        investigationId: 'B',
        layerId: 'b1',
        formationId: 'KLEI',
        bodyId: 'c',
        topDepthM: 0,
        baseDepthM: 4,
        accepted: true,
      },
      {
        investigationId: 'B',
        layerId: 'b2',
        formationId: 'ZAND',
        bodyId: 'z',
        topDepthM: 4,
        baseDepthM: 9,
        accepted: true,
      },
    ],
    edges: [{ a: 'a1', b: 'b1' }],
  },
]

/** A stored hand-drawn boundary carrying one node inside the gap. */
const boundaries: ReadonlyMap<string, BodyBoundaryResponse> = new Map([
  [
    'c',
    {
      body_id: 'c',
      render_style: 'wedge',
      upper_nodes: [{ along_m: 55, elevation_m: 7.5 }],
      lower_nodes: [],
    } as unknown as BodyBoundaryResponse,
  ],
])

describe('buildVoxelRequest passes the drawn overrides to the engine', () => {
  it('hands the engine an override map when boundaries are supplied', () => {
    const spy = vi.spyOn(engine, 'computeSectionFillActive')
    try {
      const req = buildVoxelRequest(sections, 2, 0.25, boundaries)

      expect(req.sections).toHaveLength(1)
      expect(spy).toHaveBeenCalled()
      // The LAST call is the payload pass (a no-override base pass runs first to
      // classify persisted lens nodes). Its third argument must be the override
      // map — that argument being ``undefined`` was the whole defect.
      const overrides = spy.mock.calls[spy.mock.calls.length - 1][2]
      expect(overrides).toBeInstanceOf(Map)
    } finally {
      spy.mockRestore()
    }
  })

  it('still builds when nothing is drawn', () => {
    const req = buildVoxelRequest(sections, 2, 0.25)

    expect(req.sections).toHaveLength(1)
    expect(req.sections[0].regions.length).toBeGreaterThan(0)
  })
})
