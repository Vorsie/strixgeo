// Pins for the statistics canvas HEADER under the body scope (owner ruling
// 2026-08-27, verbatim: "a body is only a body if it is geometrically
// connected or if the users says, this body is the same as that body").
//
// The honest label is the ruling's point: the lumped view must SAY it lumps.
//
// UC1 — the pooled view's header states "pooled across N bodies" (N = the
//       distinct bodies CONTRIBUTING to the pool — F7's honesty fix).
// UC2 — the body-scoped view's header names the one body, the way the 3-D
//       legend names bodies (the roster's name / #ordinal).
// UC3 — a borehole-only body contributes nothing to the cone pool and is NOT
//       counted (F7 — the live case said 16 where only 9 contributed).
// UC5 — a body-scoped empty state blames the BODY, not the unit (F7).
// UC6 — the roster refetches when the axis's body-recompute nonce bumps (F9 —
//       labels must follow a recompute).
//
// The fence cutout is stubbed (its lazy chunk pulls Cesium, which does not
// run under jsdom); the pooling arithmetic itself is pinned in
// ``unitStatistics.test.ts`` (BS1–BS4).

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UnitStatisticsCanvas from './UnitStatisticsCanvas'
import type { ParameterUnitScope } from '../../ShellContext'

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

// The pooling population: both CPTs are section members, so the pool filters
// exclude nothing the fixtures put in (the honest-count pins below control
// membership per scene).
vi.mock('../../../utils/sectionClassification', () => ({
  memberIdsBySection: () => new Map([['s1', new Set(['cpt-a', 'cpt-b'])]]),
}))

let mockScope: ParameterUnitScope = { kind: 'geotech-unit', unitId: 'geo-1' }
let mockGeotechLayers: unknown[] = []
let mockGeotechNonce = 0

vi.mock('../../ShellContext', () => ({
  parameterScopeModel: (s: { kind: string }) =>
    s.kind === 'litho-unit' || s.kind === 'litho-body' ? 'litho' : 'geotech',
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
      geotechLayers: mockGeotechLayers,
      activeLithoModel: null,
      activeGeotechModel: { id: 'gm-1' },
    },
    coordinator: {
      setSelectedParameterUnit: vi.fn(),
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: mockGeotechNonce,
    },
  }),
}))

const TWO_CPT_BODIES = [
  { id: 'l1', formation_id: 'geo-1', cpt_id: 'cpt-a', borehole_id: null, depth_top_m: 0, depth_base_m: 2, status: 'accepted', body_id: 'body-A' },
  { id: 'l2', formation_id: 'geo-1', cpt_id: 'cpt-b', borehole_id: null, depth_top_m: 0, depth_base_m: 2, status: 'accepted', body_id: 'body-B' },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockScope = { kind: 'geotech-unit', unitId: 'geo-1' }
  mockGeotechLayers = TWO_CPT_BODIES
  mockGeotechNonce = 0
})
// The first test's fixtures (beforeEach would also do, but the afterEach
// reset above already runs between tests — only the very first needs seeding).
mockGeotechLayers = TWO_CPT_BODIES

describe('UnitStatisticsCanvas — the honest header (body-scope ruling 2026-08-27)', () => {
  it('UC1 — the pooled view states "pooled across N bodies"', async () => {
    listLenses.mockResolvedValue([])
    render(<UnitStatisticsCanvas scope={mockScope} />)

    const title = await screen.findByTestId('unit-stats-title')
    expect(title.textContent).toMatch(/pooled across 2 bodies/)
  })

  it('UC2 — the body-scoped view names the one body, the legend way (not "pooled")', async () => {
    listLenses.mockResolvedValue([
      { id: 'body-A', formation_id: 'geo-1', body_ordinal: 3, name: null },
    ])
    mockScope = { kind: 'geotech-body', unitId: 'geo-1', bodyId: 'body-A' }
    render(<UnitStatisticsCanvas scope={mockScope} />)

    // The roster names body-A "#3"; the leaf header carries it (the new tree's
    // "<class-abbr> #<ordinal>" body label), and it must NOT say "pooled".
    const title = await screen.findByTestId('unit-stats-title')
    await vi.waitFor(() => {
      expect(screen.getByTestId('unit-stats-title').textContent).toMatch(/#3/)
    })
    expect(title.textContent).not.toMatch(/pooled across/)
  })

  it('UC3 — a borehole-only body is not counted in "pooled across N"', async () => {
    listLenses.mockResolvedValue([])
    mockGeotechLayers = [
      ...TWO_CPT_BODIES,
      // A third body, borehole-anchored only: no cone, nothing in the pool.
      { id: 'l3', formation_id: 'geo-1', cpt_id: null, borehole_id: 'bh-1', depth_top_m: 0, depth_base_m: 2, status: 'accepted', body_id: 'body-BH' },
    ]
    render(<UnitStatisticsCanvas scope={mockScope} />)

    const title = await screen.findByTestId('unit-stats-title')
    expect(title.textContent).toMatch(/pooled across 2 bodies/)
  })

  it('UC5 — a body-scoped empty state blames the BODY, not the unit', async () => {
    listLenses.mockResolvedValue([])
    mockGeotechLayers = [
      ...TWO_CPT_BODIES,
      { id: 'l3', formation_id: 'geo-1', cpt_id: null, borehole_id: 'bh-1', depth_top_m: 0, depth_base_m: 2, status: 'accepted', body_id: 'body-BH' },
    ]
    mockScope = { kind: 'geotech-body', unitId: 'geo-1', bodyId: 'body-BH' }
    render(<UnitStatisticsCanvas scope={mockScope} />)

    const state = await screen.findByTestId('unit-stats-empty')
    expect(state.textContent).toMatch(/this body has no bands on a cpt/i)
    expect(state.textContent).not.toMatch(/this unit has no bands/i)
  })

  it('UC6 — the roster refetches when the body-recompute nonce bumps (F9)', async () => {
    listLenses.mockResolvedValue([])
    const view = render(<UnitStatisticsCanvas scope={mockScope} />)
    await vi.waitFor(() => expect(listLenses).toHaveBeenCalledTimes(1))

    mockGeotechNonce = 1
    view.rerender(<UnitStatisticsCanvas scope={mockScope} />)
    await vi.waitFor(() => expect(listLenses).toHaveBeenCalledTimes(2))
  })
})
