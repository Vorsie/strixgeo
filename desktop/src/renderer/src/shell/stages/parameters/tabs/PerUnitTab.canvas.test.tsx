// Pins for the per-unit CANVAS after the layout flip (owner rulings 2026-08-27).
//
// R3, verbatim: "honestly i do not like the list view here. The statistics
// should be the main item, switch statistics and list from pane" — the
// distribution statistics ARE the canvas; the list lives in the inspector.
//
// R1: the litho-stage jump pools ALL CPT ground inside the litho unit's
// accepted bands "regardless of packing density" — the whole unit, spanning
// every NAD subdivision — and the header names what is pooled.
//
// R6, verbatim: "Only cpt's on the sections should be in the pooling so all
// hidden and removed should be excluded" — and the header states the
// population.
//
// RC1 — with a geotech unit scoped, the canvas draws its distributions.
// RC2 — a LITHO scope pools the whole litho unit across its NAD subdivisions,
//       and the header says so.
// RC3 — a CPT on no section contributes nothing; the header states the
//       pooled population (n over CPTs on sections).
// RC4 — no unit scoped → the canvas points at the list, never a blank.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PerUnitTab from './PerUnitTab'

const plotBatch = vi.fn()

vi.mock('../../../../api/client', () => ({
  api: { cpt: { plotBatch: (...args: unknown[]) => plotBatch(...args) } },
}))

import type { ParameterUnitScope } from '../../../ShellContext'

let mockScope: ParameterUnitScope | null = null
let mockLithoLayers: unknown[] = []
let mockGeotechLayers: unknown[] = []

// One section (0,0)→(100,0), 10 m buffer. cpt-a sits on it; cpt-off does not.
const SECTION = {
  id: 'sec-1',
  name: 'CS1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 10,
  excluded_cpt_ids: [],
  excluded_borehole_ids: [],
}

const PLOTS = new Map([
  [
    'cpt-a',
    {
      cpt_id: 'cpt-a',
      depths_m: [0.5, 1.5, 2.5, 3.5],
      qc_mpa: [2, 4, 20, 24],
      fs_mpa: null,
      rf_pct: null,
    },
  ],
  [
    'cpt-off',
    {
      cpt_id: 'cpt-off',
      depths_m: [0.5, 1.5],
      qc_mpa: [30, 32],
      fs_mpa: null,
      rf_pct: null,
    },
  ],
])

vi.mock('../../../ShellContext', () => ({
  parameterScopeModel: (s: { kind: string }) =>
    s.kind === 'litho-unit' || s.kind === 'litho-body' ? 'litho' : 'geotech',
  useShell: () => ({
    project: { id: 'proj-1', view_state: null },
    investigations: { plotMap: PLOTS },
    visibleCpts: [
      { id: 'cpt-a', location_x: 50, location_y: 0 },
      { id: 'cpt-off', location_x: 500, location_y: 500 },
    ],
    visibleBoreholes: [],
    sections: { visibleSections: [SECTION] },
    geoModel: {
      lithoFormations: [
        {
          id: 'litho-1',
          name: 'Zand van Diest',
          nad_class: null,
          litho_main_soil_code: 'ZAND',
          litho_admixtures: [],
        },
      ],
      geotechFormations: [
        {
          id: 'geo-1',
          name: '',
          nad_class: 6,
          litho_main_soil_code: 'ZAND',
          source_litho_formation_id: 'litho-1',
          parent_formation_name: null,
          color: '#aabbcc',
          color_override: null,
        },
        {
          id: 'geo-2',
          name: '',
          nad_class: 8,
          litho_main_soil_code: 'ZAND',
          source_litho_formation_id: 'litho-1',
          parent_formation_name: null,
          color: '#ccbbaa',
          color_override: null,
        },
      ],
      lithoLayers: mockLithoLayers,
      geotechLayers: mockGeotechLayers,
    },
    coordinator: {
      selectedParameterUnit: mockScope,
      setSelectedParameterUnit: vi.fn(),
      setSectionsDeepLinkTarget: vi.fn(),
    },
    toasts: { toast: vi.fn() },
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockScope = null
  mockLithoLayers = []
  mockGeotechLayers = []
})

/** An accepted CPT-anchored band. */
function band(
  id: string,
  formationId: string,
  cptId: string,
  top: number,
  base: number,
) {
  return {
    id,
    formation_id: formationId,
    cpt_id: cptId,
    borehole_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
  }
}

describe('PerUnitTab — the statistics are the main item (R3)', () => {
  it('RC1 — a scoped geotech unit draws its distributions in the canvas', () => {
    mockScope = { kind: 'geotech-unit', unitId: 'geo-1' }
    mockGeotechLayers = [band('l1', 'geo-1', 'cpt-a', 0, 2)]
    render(<PerUnitTab />)

    expect(screen.getByTestId('unit-stats-panel')).toBeTruthy()
    // qc over 0–2 m on cpt-a = [2, 4].
    expect(screen.getByTestId('unit-stats-n-qc').textContent).toContain('2')
  })

  it('RC4 — no unit scoped points at the list, never a blank', () => {
    mockGeotechLayers = [band('l1', 'geo-1', 'cpt-a', 0, 2)]
    render(<PerUnitTab />)

    expect(screen.queryByTestId('unit-stats-panel')).toBeNull()
    expect(screen.getByTestId('parameters-unit-pick-hint')).toBeTruthy()
  })

  it('RC5 — the canvas offers a way out of the unit view', () => {
    mockScope = { kind: 'geotech-unit', unitId: 'geo-1' }
    mockGeotechLayers = [band('l1', 'geo-1', 'cpt-a', 0, 2)]
    render(<PerUnitTab />)

    // The close X clears the scope — without it the only escape from a
    // deep-linked unit is to pick another row.
    expect(screen.getByTestId('parameters-unit-close')).toBeTruthy()
  })
})

describe('PerUnitTab — litho scope pools the whole unit (R1)', () => {
  it('RC2 — pools ALL CPT ground in the litho unit regardless of packing density', () => {
    mockScope = { kind: 'litho-unit', unitId: 'litho-1' }
    // The litho unit covers 0–4 m on cpt-a; the geotech model subdivides that
    // same ground into NAD 6 (0–2) and NAD 8 (2–4). The litho pool takes all
    // four readings — the subdivision must not narrow it.
    mockLithoLayers = [band('ll1', 'litho-1', 'cpt-a', 0, 4)]
    mockGeotechLayers = [
      band('gl1', 'geo-1', 'cpt-a', 0, 2),
      band('gl2', 'geo-2', 'cpt-a', 2, 4),
    ]
    render(<PerUnitTab />)

    expect(screen.getByTestId('unit-stats-n-qc').textContent).toContain('4')
    // The header NAMES what is pooled — the whole litho unit, every class.
    const title = screen.getByTestId('unit-stats-title').textContent ?? ''
    expect(title).toContain('Zand van Diest')
    expect(title).toMatch(/whole litho unit, all packing classes/i)
  })
})

describe('PerUnitTab — only tests on the sections pool (R6)', () => {
  it('RC3 — an off-section CPT contributes nothing, and the header states the population', () => {
    mockScope = { kind: 'geotech-unit', unitId: 'geo-1' }
    mockGeotechLayers = [
      band('l1', 'geo-1', 'cpt-a', 0, 2),
      // cpt-off is visible but projects onto NO section — its band is out.
      band('l2', 'geo-1', 'cpt-off', 0, 2),
    ]
    render(<PerUnitTab />)

    // Only cpt-a's two readings pool.
    expect(screen.getByTestId('unit-stats-n-qc').textContent).toContain('2')
    // The population line: n over how many CPTs on how many sections.
    const population = screen.getByTestId('unit-stats-population').textContent ?? ''
    expect(population).toMatch(/n = 2/)
    expect(population).toMatch(/1 CPT/)
    expect(population).toMatch(/1 section/)
  })
})
