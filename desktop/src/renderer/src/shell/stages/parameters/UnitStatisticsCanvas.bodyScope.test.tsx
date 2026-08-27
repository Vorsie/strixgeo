// Pins for the statistics canvas HEADER under the body scope (owner ruling
// 2026-08-27, verbatim: "a body is only a body if it is geometrically
// connected or if the users says, this body is the same as that body").
//
// The honest label is the ruling's point: the lumped view must SAY it lumps.
//
// UC1 — the pooled view's header states "pooled across N bodies" (N = the
//       distinct bodies among the row's accepted layers).
// UC2 — the body-scoped view's header names the one body, the way the 3-D
//       legend names bodies (the roster's name / #ordinal).
//
// The fence cutout is stubbed (its lazy chunk pulls Cesium, which does not
// run under jsdom); the pooling arithmetic itself is pinned in
// ``unitStatistics.test.ts`` (BS1–BS3).

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UnitStatisticsCanvas from './UnitStatisticsCanvas'

const listLenses = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      listLenses: (...args: unknown[]) => listLenses(...args),
    },
    cpt: { plotBatch: vi.fn().mockResolvedValue([]) },
    borehole: { detailBatch: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('./UnitFenceCutout', () => ({
  default: () => <div data-testid="unit-fence-cutout-stub" />,
}))

let mockScope: { kind: 'litho' | 'geotech'; unitId: string; bodyId?: string | null } = {
  kind: 'geotech',
  unitId: 'geo-1',
}

vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    project: { id: 'proj-1' },
    investigations: { plotMap: new Map() },
    visibleCpts: [],
    visibleBoreholes: [],
    sections: { visibleSections: [] },
    geoModel: {
      lithoFormations: [],
      geotechFormations: [
        {
          id: 'geo-1',
          name: 'machine name',
          nad_class: 6,
          litho_main_soil_code: 'ZAND',
          source_litho_formation_id: null,
          parent_formation_name: null,
          color: '#aabbcc',
          color_override: null,
        },
      ],
      lithoLayers: [],
      geotechLayers: [
        { id: 'l1', formation_id: 'geo-1', cpt_id: 'cpt-a', borehole_id: null, depth_top_m: 0, depth_base_m: 2, status: 'accepted', body_id: 'body-A' },
        { id: 'l2', formation_id: 'geo-1', cpt_id: 'cpt-b', borehole_id: null, depth_top_m: 0, depth_base_m: 2, status: 'accepted', body_id: 'body-B' },
      ],
      activeLithoModel: null,
      activeGeotechModel: { id: 'gm-1' },
    },
    coordinator: { setSelectedParameterUnit: vi.fn() },
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockScope = { kind: 'geotech', unitId: 'geo-1' }
})

describe('UnitStatisticsCanvas — the honest header (body-scope ruling 2026-08-27)', () => {
  it('UC1 — the pooled view states "pooled across N bodies"', async () => {
    listLenses.mockResolvedValue([])
    render(<UnitStatisticsCanvas scope={mockScope} />)

    const title = await screen.findByTestId('unit-stats-title')
    expect(title.textContent).toMatch(/pooled across 2 bodies/)
  })

  it('UC2 — the body-scoped view names the one body, the legend way', async () => {
    listLenses.mockResolvedValue([
      { id: 'body-A', formation_id: 'geo-1', body_ordinal: 3, name: null },
    ])
    mockScope = { kind: 'geotech', unitId: 'geo-1', bodyId: 'body-A' }
    render(<UnitStatisticsCanvas scope={mockScope} />)

    // The roster names body-A "#3"; the header must carry it.
    const title = await screen.findByTestId('unit-stats-title')
    await vi.waitFor(() => {
      expect(screen.getByTestId('unit-stats-title').textContent).toMatch(/— body #3/)
    })
    expect(title.textContent).not.toMatch(/pooled across/)
  })
})
