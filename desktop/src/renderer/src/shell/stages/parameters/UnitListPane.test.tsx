// Pins for the unit-list PANE — now the owner-ruled body tree (spec §1,
// 2026-08-27, variant B): litho unit ▸ litho body ▸ NAD class ▸ geotech body.
//
// The old two-level PU pins are superseded: the pane shape changed on purpose
// (the tree is ALWAYS litho-unit rooted, killing the "litho units unreachable"
// gap, so the litho/geotech either-or roster + its loading-swap + the
// litho-selection chip are gone). What carries over in spirit: selection,
// counts, expand/collapse, and the F11 listbox a11y invariants.
//
// NP1 — the top level is litho units, always — even when a geotech model
//       exists (the geotech subsplit lives BENEATH, not at the top).
// NP2 — the four levels expand in order: unit ▸ body ▸ class ▸ geotech body.
// NP3 — single-child collapse: a litho unit with one body and no subdivision
//       is a leaf, no expander.
// NP4 — clicking a node scopes the stage to that node kind.
// NP5 — a selected node is marked selected, and its whole path auto-expands.
// NP6 — F11 a11y: the option carries aria-expanded, no focusable descendant,
//       ArrowRight/ArrowLeft toggle.
// NP7 — a geotech band with no covering litho band shows in the orphan footer,
//       never as an invented tree row.
// NP8 — a litho-only project still lists its litho units (never blank).
// NP9 — every row states "N bands · M with cone".
// NP10 — F9: the body-label roster follows the axis's recompute nonce.
// NP11 — F12: while the geotech layers load, the tree does not render.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UnitListPane from './UnitListPane'

const setSelectedParameterUnit = vi.fn()
const listLenses = vi.fn()

vi.mock('../../../api/client', () => ({
  api: { geology: { listLenses: (...args: unknown[]) => listLenses(...args) } },
}))

let mockLithoFormations: unknown[] = []
let mockGeotechFormations: unknown[] = []
let mockLithoLayers: unknown[] = []
let mockGeotechLayers: unknown[] = []
let mockGeotechLayersLoaded = true
let mockActiveGeotechModel: { id: string } | null = null
let mockGeotechNonce = 0
let mockSelectedUnit: unknown = null

vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    project: { id: 'proj-1' },
    geoModel: {
      lithoFormations: mockLithoFormations,
      geotechFormations: mockGeotechFormations,
      lithoLayers: mockLithoLayers,
      geotechLayers: mockGeotechLayers,
      geotechLayersLoaded: mockGeotechLayersLoaded,
      activeLithoModel: null,
      activeGeotechModel: mockActiveGeotechModel,
    },
    coordinator: {
      selectedParameterUnit: mockSelectedUnit,
      setSelectedParameterUnit,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: mockGeotechNonce,
    },
  }),
}))

function formation(id: string, over: Record<string, unknown>) {
  return {
    id,
    name: id,
    display_order: 0,
    nad_class: null,
    litho_main_soil_code: null,
    source_litho_formation_id: null,
    ...over,
  }
}

function layer(id: string, over: Record<string, unknown>) {
  return {
    id,
    formation_id: 'f',
    cpt_id: 'c1',
    borehole_id: null,
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    body_id: null,
    parent_litho_layer_id: null,
    ...over,
  }
}

/** The standard scene: SILT (two bodies, geotech subsplit + one orphan) + CLAY. */
function seedScene() {
  mockLithoFormations = [
    formation('silt', { name: 'SILT', display_order: 0 }),
    formation('clay', { name: 'CLAY', display_order: 1 }),
  ]
  mockGeotechFormations = [
    formation('silt-sf', { nad_class: 13, source_litho_formation_id: 'silt' }),
    formation('silt-mf', { nad_class: 14, source_litho_formation_id: 'silt' }),
  ]
  mockLithoLayers = [
    layer('L1', { formation_id: 'silt', body_id: 'lb1' }),
    layer('L2', { formation_id: 'silt', body_id: 'lb2' }),
    layer('LC', { formation_id: 'clay', body_id: 'lbC' }),
  ]
  mockGeotechLayers = [
    layer('g1', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gbA' }),
    layer('g2', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gbB' }),
    layer('g3', { formation_id: 'silt-mf', parent_litho_layer_id: 'L1', body_id: 'gbMF' }),
    layer('gO', { formation_id: 'silt-sf', parent_litho_layer_id: null, body_id: null }),
  ]
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockLithoFormations = []
  mockGeotechFormations = []
  mockLithoLayers = []
  mockGeotechLayers = []
  mockGeotechLayersLoaded = true
  mockActiveGeotechModel = null
  mockGeotechNonce = 0
  mockSelectedUnit = null
})

describe('UnitListPane — the body tree (spec §1)', () => {
  it('NP1 — the top level is litho units, even when a geotech model exists', () => {
    seedScene()
    render(<UnitListPane />)
    expect(screen.getByTestId('parameters-node-litho-unit:silt')).toBeTruthy()
    expect(screen.getByTestId('parameters-node-litho-unit:clay')).toBeTruthy()
    // The geotech subsplit is NOT at the top level.
    expect(screen.queryByTestId('parameters-node-geotech-unit:silt-sf')).toBeNull()
  })

  it('NP2 — the four levels expand in order: unit ▸ body ▸ class ▸ geotech body', () => {
    seedScene()
    render(<UnitListPane />)
    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-unit:silt'))
    expect(screen.getByTestId('parameters-node-litho-body:silt:lb1')).toBeTruthy()

    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-body:silt:lb1'))
    expect(screen.getByTestId('parameters-node-geotech-class:silt:lb1:13')).toBeTruthy()

    fireEvent.click(screen.getByTestId('parameters-node-expander-geotech-class:silt:lb1:13'))
    expect(screen.getByTestId('parameters-node-geotech-body:silt-sf:gbA')).toBeTruthy()
    expect(screen.getByTestId('parameters-node-geotech-body:silt-sf:gbB')).toBeTruthy()
  })

  it('NP3 — a litho unit with one body and no subdivision is a leaf (single-child collapse)', () => {
    seedScene()
    render(<UnitListPane />)
    // CLAY has one litho body, no geotech → collapsed to a leaf unit row.
    expect(screen.queryByTestId('parameters-node-expander-litho-unit:clay')).toBeNull()
  })

  it('NP4 — clicking a node scopes the stage to that node kind', () => {
    seedScene()
    render(<UnitListPane />)
    fireEvent.click(screen.getByTestId('parameters-node-litho-unit:silt'))
    expect(setSelectedParameterUnit).toHaveBeenCalledWith({ kind: 'litho-unit', unitId: 'silt' })

    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-unit:silt'))
    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-body:silt:lb1'))
    fireEvent.click(screen.getByTestId('parameters-node-geotech-class:silt:lb1:13'))
    expect(setSelectedParameterUnit).toHaveBeenCalledWith({
      kind: 'geotech-class',
      lithoUnitId: 'silt',
      lithoBodyId: 'lb1',
      nadClass: 13,
    })

    fireEvent.click(screen.getByTestId('parameters-node-expander-geotech-class:silt:lb1:13'))
    fireEvent.click(screen.getByTestId('parameters-node-geotech-body:silt-sf:gbA'))
    expect(setSelectedParameterUnit).toHaveBeenCalledWith({
      kind: 'geotech-body',
      unitId: 'silt-sf',
      bodyId: 'gbA',
    })
  })

  it('NP5 — a selected node is marked selected and its whole path auto-expands', () => {
    seedScene()
    mockSelectedUnit = { kind: 'geotech-body', unitId: 'silt-sf', bodyId: 'gbA' }
    render(<UnitListPane />)
    // The path (silt ▸ lb1 ▸ class 13) auto-expanded, so the leaf is visible...
    const leaf = screen.getByTestId('parameters-node-geotech-body:silt-sf:gbA')
    expect(leaf.getAttribute('aria-selected')).toBe('true')
    // ...and the ancestor unit is not itself the selected row.
    expect(
      screen.getByTestId('parameters-node-litho-unit:silt').getAttribute('aria-selected'),
    ).toBe('false')
  })

  it('NP6 — F11: the option carries aria-expanded, no focusable descendant, ArrowRight expands', () => {
    seedScene()
    render(<UnitListPane />)
    const option = screen.getByTestId('parameters-node-litho-unit:silt')
    expect(option.getAttribute('aria-expanded')).toBe('false')
    expect(option.querySelector('button')).toBeNull()
    for (const el of Array.from(option.querySelectorAll('[tabindex]'))) {
      expect(el.getAttribute('tabindex')).toBe('-1')
    }
    fireEvent.keyDown(option, { key: 'ArrowRight' })
    expect(screen.getByTestId('parameters-node-litho-body:silt:lb1')).toBeTruthy()
    // Expanding must not change the scope.
    expect(setSelectedParameterUnit).not.toHaveBeenCalled()
    fireEvent.keyDown(option, { key: 'ArrowLeft' })
    expect(screen.queryByTestId('parameters-node-litho-body:silt:lb1')).toBeNull()
  })

  it('NP7 — a geotech band with no covering litho band is counted in the orphan footer', () => {
    seedScene()
    render(<UnitListPane />)
    const footer = screen.getByTestId('parameters-orphan-footer')
    expect(footer.textContent).toMatch(/1 band outside the litho model/)
  })

  it('NP8 — a litho-only project still lists its litho units', () => {
    mockLithoFormations = [formation('silt', { name: 'SILT' })]
    mockLithoLayers = [layer('L1', { formation_id: 'silt', body_id: 'lb1' })]
    render(<UnitListPane />)
    expect(screen.getByTestId('parameters-node-litho-unit:silt')).toBeTruthy()
    expect(screen.queryByTestId('parameters-orphan-footer')).toBeNull()
  })

  it('NP9 — every row states N bands · M with cone', () => {
    seedScene()
    render(<UnitListPane />)
    // SILT pools two litho bands (L1, L2), both CPT-anchored.
    const count = screen.getByTestId('parameters-node-count-litho-unit:silt')
    expect(count.textContent).toContain('2 bands')
    expect(count.textContent).toContain('2 with cone')
  })

  it('NP10 — the roster refetches when the axis recompute nonce bumps (F9)', async () => {
    listLenses.mockResolvedValue([])
    seedScene()
    mockActiveGeotechModel = { id: 'gm-1' }
    const view = render(<UnitListPane />)
    await vi.waitFor(() => expect(listLenses).toHaveBeenCalledTimes(1))

    mockGeotechNonce = 1
    view.rerender(<UnitListPane />)
    await vi.waitFor(() => expect(listLenses).toHaveBeenCalledTimes(2))
  })

  it('NP11 — while the geotech layers load, the tree does not render (F12)', () => {
    seedScene()
    mockGeotechLayers = []
    mockGeotechLayersLoaded = false
    render(<UnitListPane />)
    expect(screen.queryByTestId('parameters-node-litho-unit:silt')).toBeNull()
    expect(screen.getByTestId('parameters-unit-list-loading')).toBeTruthy()
  })

  it('NP12 — a single-class litho body stays openable and auto-expands so the pakkingsdichtheid label shows without an extra click (owner ruling 2026-09-02)', () => {
    // SILT unit, one litho body lb1 with EXACTLY ONE packing class (NAD 13) —
    // the owner's "SILT · #1" case that used to collapse to a non-openable leaf.
    mockLithoFormations = [formation('silt', { name: 'SILT', display_order: 0 })]
    mockGeotechFormations = [formation('silt-sf', { nad_class: 13, source_litho_formation_id: 'silt' })]
    mockLithoLayers = [layer('L1', { formation_id: 'silt', body_id: 'lb1' })]
    mockGeotechLayers = [
      layer('g1', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gbA' }),
    ]
    render(<UnitListPane />)

    // Reach the body level (where the owner was) by expanding the unit.
    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-unit:silt'))

    // The body is openable — no more "submenu I cannot open".
    expect(screen.getByTestId('parameters-node-expander-litho-body:silt:lb1')).toBeTruthy()

    // ...and it is auto-expanded, so the class row — the pakkingsdichtheid label
    // — is visible WITHOUT a further click on the body's expander.
    const classLabel = screen.getByTestId('parameters-node-label-geotech-class:silt:lb1:13')
    expect(classLabel.textContent).toBe('SILT, slightly firm')
  })

  it('NP13 — a single-class body is default-open, NOT force-open: the user can collapse it and it stays collapsed across a tree rebuild', () => {
    mockLithoFormations = [formation('silt', { name: 'SILT', display_order: 0 })]
    mockGeotechFormations = [formation('silt-sf', { nad_class: 13, source_litho_formation_id: 'silt' })]
    mockLithoLayers = [layer('L1', { formation_id: 'silt', body_id: 'lb1' })]
    mockGeotechLayers = [
      layer('g1', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gbA' }),
    ]
    const view = render(<UnitListPane />)
    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-unit:silt'))
    // Auto-open: the class row is visible to start with.
    expect(screen.getByTestId('parameters-node-label-geotech-class:silt:lb1:13')).toBeTruthy()

    // The collapse gesture is HONOURED (a force-open node would ignore it).
    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-body:silt:lb1'))
    expect(screen.queryByTestId('parameters-node-label-geotech-class:silt:lb1:13')).toBeNull()

    // A tree rebuild (new data reference, same shape) must NOT re-open what the
    // user deliberately closed — the seed fires once, not on every rebuild.
    mockLithoLayers = [...mockLithoLayers]
    view.rerender(<UnitListPane />)
    expect(screen.queryByTestId('parameters-node-label-geotech-class:silt:lb1:13')).toBeNull()
  })
})
