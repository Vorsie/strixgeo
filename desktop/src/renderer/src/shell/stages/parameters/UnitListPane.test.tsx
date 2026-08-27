// Pins for the unit LIST's roster + selection — the pane half of the R3
// layout flip (owner 2026-08-27: "switch statistics and list from pane").
// These behaviours predate the flip (owner ballot 2026-08-26) and moved here
// verbatim from the old per-unit tab: the roster choice, the selection, the
// labels and the band counts are the same list, in a different home.
//
// PU1 — a project with geotech units lists them, not the litho roster.
// PU2 — a unit row is selectable, and selecting scopes the stage to it.
// PU3 — the selected row is marked as selected for assistive tech.
// PU4 — an UNCLASSIFIED (skeleton) unit still gets a readable label, never a
//       blank row (the 11b ruling).
// PU5 — a project with no geotech units still shows the litho roster, so the
//       tab never goes blank on a litho-only project.
// PU6 — the band count per unit counts only that unit's bands.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UnitListPane from './UnitListPane'

const setSelectedParameterUnit = vi.fn()

let mockGeotechFormations: unknown[] = []
let mockGeotechLayers: unknown[] = []
let mockLithoLayers: unknown[] = []
let mockSelectedUnit: {
  kind: 'litho' | 'geotech'
  unitId: string
  bodyId?: string | null
} | null = null

vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    // The body-roster fetch needs the project + active models; both models
    // null here keeps the pane fetch-free (labels fall back to id prefixes).
    project: { id: 'proj-1' },
    geoModel: {
      lithoFormations: [
        {
          id: 'litho-1',
          name: 'Dicht zand',
          parent_formation_name: 'Diest',
          nad_class: null,
          litho_main_soil_code: 'ZAND',
          litho_admixtures: [],
        },
        {
          id: 'litho-2',
          name: 'Boomse klei',
          parent_formation_name: 'Boom',
          nad_class: null,
          litho_main_soil_code: 'KLEI',
          litho_admixtures: [],
        },
      ],
      lithoLayers: mockLithoLayers,
      geotechFormations: mockGeotechFormations,
      geotechLayers: mockGeotechLayers,
      activeLithoModel: null,
      activeGeotechModel: null,
    },
    coordinator: {
      selectedParameterUnit: mockSelectedUnit,
      setSelectedParameterUnit,
    },
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockGeotechFormations = []
  mockGeotechLayers = []
  mockLithoLayers = []
  mockSelectedUnit = null
})

/** A classified geotech unit (NAD 6 = a sand packing class). */
function classifiedUnit() {
  return {
    id: 'geo-1',
    name: 'whatever the machine stored',
    nad_class: 6,
    litho_main_soil_code: 'ZAND',
    source_litho_formation_id: 'litho-1',
    // ALWAYS null on a real geotech row: the server resolves this from
    // ``parent_formation_id``, which the geotech materialiser never sets. A
    // fixture that supplies a value here hides the bug where the pane reads
    // the wrong field.
    parent_formation_name: null,
    color: '#aabbcc',
    color_override: null,
  }
}

/** A borehole-only skeleton unit — real ground, no class yet. */
function skeletonUnit() {
  return {
    id: 'geo-2',
    name: '',
    nad_class: null,
    litho_main_soil_code: 'KLEI',
    source_litho_formation_id: 'litho-1',
    // ALWAYS null on a real geotech row: the server resolves this from
    // ``parent_formation_id``, which the geotech materialiser never sets. A
    // fixture that supplies a value here hides the bug where the pane reads
    // the wrong field.
    parent_formation_name: null,
    color: '#ccbbaa',
    color_override: null,
  }
}

/** One accepted band on a CPT, belonging to ``unitId``. */
function bandOf(unitId: string, id: string) {
  return {
    id,
    formation_id: unitId,
    cpt_id: 'cpt-a',
    borehole_id: null,
    depth_top_m: 0,
    depth_base_m: 2,
    status: 'accepted',
  }
}

describe('UnitListPane — geotech roster', () => {
  it('PU1 — lists the geotech units when the project has them', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1')]
    render(<UnitListPane />)

    expect(screen.getByTestId('parameters-unit-geo-1')).toBeTruthy()
    // The litho unit is not the roster here.
    expect(screen.queryByTestId('parameters-unit-litho-1')).toBeNull()
  })

  it('PU2 — clicking a unit row scopes the stage to that unit', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1')]
    render(<UnitListPane />)

    fireEvent.click(screen.getByTestId('parameters-unit-geo-1'))

    expect(setSelectedParameterUnit).toHaveBeenCalledWith({ kind: 'geotech', unitId: 'geo-1' })
  })

  it('PU3 — the selected row is marked selected', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1')]
    mockSelectedUnit = { kind: 'geotech', unitId: 'geo-1' }
    render(<UnitListPane />)

    expect(
      screen.getByTestId('parameters-unit-geo-1').getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('PU4 — an unclassified unit gets a readable label, never a blank row', () => {
    mockGeotechFormations = [skeletonUnit()]
    mockGeotechLayers = [bandOf('geo-2', 'l1')]
    render(<UnitListPane />)

    const row = screen.getByTestId('parameters-unit-geo-2')
    // "CLAY — not yet classified" or equivalent; the point is it says WHICH
    // ground it is rather than rendering an empty cell.
    expect((row.textContent ?? '').trim().length).toBeGreaterThan(3)
    expect(row.textContent ?? '').toMatch(/not yet classified/i)
  })

  it('PU5 — a litho-only project still shows the litho roster', () => {
    mockGeotechFormations = []
    render(<UnitListPane />)

    expect(screen.getByTestId('parameters-unit-litho-1')).toBeTruthy()
  })

  it('PU6 — each unit reports only its own bands', () => {
    mockGeotechFormations = [classifiedUnit(), skeletonUnit()]
    mockGeotechLayers = [
      { id: 'l1', formation_id: 'geo-1', cpt_id: 'cpt-a', borehole_id: null, depth_top_m: 0, depth_base_m: 2, status: 'accepted' },
      { id: 'l2', formation_id: 'geo-1', cpt_id: 'cpt-a', borehole_id: null, depth_top_m: 2, depth_base_m: 4, status: 'accepted' },
      { id: 'l3', formation_id: 'geo-2', cpt_id: 'cpt-a', borehole_id: null, depth_top_m: 4, depth_base_m: 5, status: 'accepted' },
    ]
    render(<UnitListPane />)

    expect(screen.getByTestId('parameters-unit-bands-geo-1').textContent).toContain('2')
    expect(screen.getByTestId('parameters-unit-bands-geo-2').textContent).toContain('1')
  })

  it('PU7 — a unit that describes nothing in this model is not listed', () => {
    // Owner ruling 2026-08-26 on the Geotech-units pane: "if a bin is empty
    // that means there is nothing in it and nothing exists". The orphan sweep
    // deletes these shortly anyway.
    mockGeotechFormations = [classifiedUnit(), skeletonUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1')]
    render(<UnitListPane />)

    expect(screen.getByTestId('parameters-unit-geo-1')).toBeTruthy()
    expect(screen.queryByTestId('parameters-unit-geo-2')).toBeNull()
  })

  it('PU9 — the source litho unit is named, via source_litho_formation_id', () => {
    // The column is labelled "Source litho unit" and must not read "—" on every
    // row. It cannot come from ``parent_formation_name`` (always null on a
    // geotech row) — it is reached through ``source_litho_formation_id``.
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1')]
    render(<UnitListPane />)

    // litho-1 is the source; its display name is what the cell must show.
    const cell = screen.getByTestId('parameters-unit-source-geo-1')
    expect(cell.textContent ?? '').not.toBe('—')
    expect((cell.textContent ?? '').toLowerCase()).toContain('sand')
  })

  it('PU10 — two unclassified units of the same soil are told apart by their source', () => {
    // Without the source name these read as two copies of one row — the exact
    // defect the geotech pane's disambiguation rule exists to prevent.
    const clayFromBoom = { ...skeletonUnit(), id: 'geo-3', source_litho_formation_id: 'litho-2' }
    const clayFromDiest = { ...skeletonUnit(), id: 'geo-4', source_litho_formation_id: 'litho-1' }
    mockGeotechFormations = [clayFromBoom, clayFromDiest]
    mockGeotechLayers = [bandOf('geo-3', 'l1'), bandOf('geo-4', 'l2')]
    render(<UnitListPane />)

    const a = screen.getByTestId('parameters-unit-geo-3').textContent ?? ''
    const b = screen.getByTestId('parameters-unit-geo-4').textContent ?? ''
    expect(a).not.toEqual(b)
  })

  it('PU11 — a pending band is not counted as ground the unit describes', () => {
    // ``listLayers`` returns every status. A unit whose only layer is a pending
    // proposal has nothing accepted, so it is empty and must not be listed —
    // otherwise it lists as having bands and then shows nothing.
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [{ ...bandOf('geo-1', 'l1'), status: 'pending' }]
    render(<UnitListPane />)

    expect(screen.queryByTestId('parameters-unit-geo-1')).toBeNull()
  })

  // ── The body level (owner ruling 2026-08-27, verbatim: "a body is only a
  //    body if it is geometrically connected or if the users says, this body
  //    is the same as that body") — the unit row lumps resolver bodies; the
  //    tree makes each reachable. ────────────────────────────────────────────
  it('PU12 — a unit lumping two bodies gets an expander; expanding lists a row per body', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [
      { ...bandOf('geo-1', 'l1'), body_id: 'body-A' },
      { ...bandOf('geo-1', 'l2'), body_id: 'body-B' },
    ]
    render(<UnitListPane />)

    const expander = screen.getByTestId('parameters-unit-expander-geo-1')
    fireEvent.click(expander)

    expect(screen.getByTestId('parameters-unit-body-body-A')).toBeTruthy()
    expect(screen.getByTestId('parameters-unit-body-body-B')).toBeTruthy()
  })

  it('PU13 — a unit with ONE body needs no expander (the GT3 precedent)', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [
      { ...bandOf('geo-1', 'l1'), body_id: 'body-A' },
      { ...bandOf('geo-1', 'l2'), body_id: 'body-A' },
    ]
    render(<UnitListPane />)

    expect(screen.queryByTestId('parameters-unit-expander-geo-1')).toBeNull()
    expect(screen.queryByTestId('parameters-unit-body-body-A')).toBeNull()
  })

  it('PU14 — clicking a body row scopes {unitId, bodyId}; the unit row stays the pooled scope', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [
      { ...bandOf('geo-1', 'l1'), body_id: 'body-A' },
      { ...bandOf('geo-1', 'l2'), body_id: 'body-B' },
    ]
    render(<UnitListPane />)

    fireEvent.click(screen.getByTestId('parameters-unit-expander-geo-1'))
    fireEvent.click(screen.getByTestId('parameters-unit-body-body-B'))
    expect(setSelectedParameterUnit).toHaveBeenCalledWith({
      kind: 'geotech',
      unitId: 'geo-1',
      bodyId: 'body-B',
    })

    setSelectedParameterUnit.mockClear()
    fireEvent.click(screen.getByTestId('parameters-unit-geo-1'))
    // EXACTLY the pooled shape — no bodyId key (PU2's contract).
    expect(setSelectedParameterUnit).toHaveBeenCalledWith({ kind: 'geotech', unitId: 'geo-1' })
  })

  it('PU15 — a body row shows its own band and CPT counts', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [
      { ...bandOf('geo-1', 'l1'), body_id: 'body-A' },
      { ...bandOf('geo-1', 'l2'), body_id: 'body-A', cpt_id: 'cpt-b' },
      { ...bandOf('geo-1', 'l3'), body_id: 'body-B' },
    ]
    render(<UnitListPane />)

    fireEvent.click(screen.getByTestId('parameters-unit-expander-geo-1'))
    const rowA = screen.getByTestId('parameters-unit-body-body-A')
    expect(rowA.textContent).toContain('2 bands')
    expect(rowA.textContent).toContain('2 CPTs')
    const rowB = screen.getByTestId('parameters-unit-body-body-B')
    expect(rowB.textContent).toContain('1 band')
    expect(rowB.textContent).toContain('1 CPT')
  })

  it('PU16 — the litho roster gets the same body level, from the litho layers', () => {
    mockGeotechFormations = []
    mockLithoLayers = [
      { id: 'll1', formation_id: 'litho-1', cpt_id: 'cpt-a', borehole_id: null, depth_top_m: 0, depth_base_m: 2, status: 'accepted', body_id: 'lbody-1' },
      { id: 'll2', formation_id: 'litho-1', cpt_id: 'cpt-a', borehole_id: null, depth_top_m: 2, depth_base_m: 4, status: 'accepted', body_id: 'lbody-2' },
    ]
    render(<UnitListPane />)

    fireEvent.click(screen.getByTestId('parameters-unit-expander-litho-1'))
    fireEvent.click(screen.getByTestId('parameters-unit-body-lbody-2'))
    expect(setSelectedParameterUnit).toHaveBeenCalledWith({
      kind: 'litho',
      unitId: 'litho-1',
      bodyId: 'lbody-2',
    })
  })

  it('PU17 — a selected body row is marked selected; the unit row is not', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [
      { ...bandOf('geo-1', 'l1'), body_id: 'body-A' },
      { ...bandOf('geo-1', 'l2'), body_id: 'body-B' },
    ]
    mockSelectedUnit = { kind: 'geotech', unitId: 'geo-1', bodyId: 'body-A' }
    render(<UnitListPane />)

    // A body-scoped selection keeps the unit expanded so the scoped row is
    // visible without a click.
    expect(
      screen.getByTestId('parameters-unit-body-body-A').getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      screen.getByTestId('parameters-unit-geo-1').getAttribute('aria-selected'),
    ).toBe('false')
  })

  it('PU8 — a borehole-only unit IS listed; it just has no cone to summarise', () => {
    // "Empty" means no bands, not "no CPT bands". This unit has real ground;
    // the inspector is what explains that a borehole carries no qc.
    mockGeotechFormations = [skeletonUnit()]
    mockGeotechLayers = [
      {
        id: 'l1',
        formation_id: 'geo-2',
        cpt_id: null,
        borehole_id: 'bh-a',
        depth_top_m: 0,
        depth_base_m: 2,
        status: 'accepted',
      },
    ]
    render(<UnitListPane />)

    expect(screen.getByTestId('parameters-unit-geo-2')).toBeTruthy()
  })
})
