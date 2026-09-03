// Grouping FROM the Parameters right pane (owner finding 2026-09-03: "ik wil ook
// kunnen groeperen in de right hand pane van de parameter stage"). Until now a
// group could only be made by right-clicking a body on a cross-section; the pane
// showed the "(group N)" tag but offered no gesture to make or undo one.
//
// The pane reuses the section-canvas body-union client VERBATIM — createBodyUnion
// / deleteBodyUnion — behind a checkbox multi-select + a "N selected · Group ·
// Clear" bulk bar (docs/ux.md selection model). These pins are in the rule's own
// words: two same-class bodies + Group writes ONE union and the rows show
// "(group 1)"; Ungroup on a member removes it from the group; bodies of a
// different class cannot be grouped — the action is disabled.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UnitListPane from './UnitListPane'

const setSelectedParameterUnit = vi.fn()
const listLenses = vi.fn()
const listBodyUnions = vi.fn()
const createBodyUnion = vi.fn()
const deleteBodyUnion = vi.fn()
const requestBodyRecompute = vi.fn()
const requestGeotechLayersRefetch = vi.fn()
const toast = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      listLenses: (...args: unknown[]) => listLenses(...args),
      listBodyUnions: (...args: unknown[]) => listBodyUnions(...args),
      createBodyUnion: (...args: unknown[]) => createBodyUnion(...args),
      deleteBodyUnion: (...args: unknown[]) => deleteBodyUnion(...args),
    },
  },
}))

let mockLithoFormations: unknown[] = []
let mockGeotechFormations: unknown[] = []
let mockLithoLayers: unknown[] = []
let mockGeotechLayers: unknown[] = []
let mockActiveGeotechModel: { id: string } | null = null
let mockGeotechNonce = 0

vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    project: { id: 'proj-1' },
    geoModel: {
      lithoFormations: mockLithoFormations,
      geotechFormations: mockGeotechFormations,
      lithoLayers: mockLithoLayers,
      geotechLayers: mockGeotechLayers,
      geotechLayersLoaded: true,
      activeLithoModel: null,
      activeGeotechModel: mockActiveGeotechModel,
      requestGeotechLayersRefetch,
    },
    coordinator: {
      selectedParameterUnit: null,
      setSelectedParameterUnit,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: mockGeotechNonce,
      requestBodyRecompute,
    },
    toasts: { toast },
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

/** SILT unit, one litho body lb1, TWO packing classes (13 = gbA+gbB, 14 = gbMF+gbMF2). */
function seedTwoClassScene() {
  mockLithoFormations = [formation('silt', { name: 'SILT', display_order: 0 })]
  mockGeotechFormations = [
    formation('silt-sf', { nad_class: 13, source_litho_formation_id: 'silt' }),
    formation('silt-mf', { nad_class: 14, source_litho_formation_id: 'silt' }),
  ]
  mockLithoLayers = [layer('L1', { formation_id: 'silt', body_id: 'lb1' })]
  mockGeotechLayers = [
    layer('g1', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gbA' }),
    layer('g2', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gbB' }),
    layer('g3', { formation_id: 'silt-mf', parent_litho_layer_id: 'L1', body_id: 'gbMF' }),
    layer('g4', { formation_id: 'silt-mf', parent_litho_layer_id: 'L1', body_id: 'gbMF2' }),
  ]
  mockActiveGeotechModel = { id: 'geo-1' }
}

/** Expand SILT ▸ lb1 ▸ class 13 so the gbA / gbB geotech-body leaves show. */
function expandToClass13() {
  fireEvent.click(screen.getByTestId('parameters-node-expander-litho-unit:silt'))
  fireEvent.click(screen.getByTestId('parameters-node-expander-litho-body:silt:lb1'))
  fireEvent.click(screen.getByTestId('parameters-node-expander-geotech-class:silt:lb1:13'))
}

function unionItem(id: string, aBody: string, bBody: string) {
  return {
    id,
    model_id: 'geo-1',
    layer_a_id: `${aBody}-L`,
    layer_b_id: `${bBody}-L`,
    anchor_a: { layer_id: `${aBody}-L`, body_id: aBody, body_name: null, body_ordinal: 0, formation_id: 'silt-sf' },
    anchor_b: { layer_id: `${bBody}-L`, body_id: bBody, body_name: null, body_ordinal: 1, formation_id: 'silt-sf' },
    created_at: '',
  }
}

const CREATED_UNION = {
  union_id: 'u1',
  model_id: 'geo-1',
  layer_a_id: 'g1',
  layer_b_id: 'g2',
  was_created: true,
  bodies_changed: 1,
  renamed: [],
  suppressed: false,
  inert: false,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockLithoFormations = []
  mockGeotechFormations = []
  mockLithoLayers = []
  mockGeotechLayers = []
  mockActiveGeotechModel = null
  mockGeotechNonce = 0
})

describe('UnitListPane — grouping in the right pane', () => {
  it('PG1 — selecting two same-class bodies and pressing Group writes ONE union, refetches, and toasts the undo path (no confirm dialog)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    seedTwoClassScene()
    listBodyUnions.mockResolvedValue([])
    createBodyUnion.mockResolvedValue(CREATED_UNION)
    render(<UnitListPane />)
    expandToClass13()

    fireEvent.click(screen.getByTestId('parameters-node-check-geotech-body:silt-sf:gbA'))
    fireEvent.click(screen.getByTestId('parameters-node-check-geotech-body:silt-sf:gbB'))
    fireEvent.click(screen.getByTestId('parameters-group-action'))

    // Exactly one union, between the two bodies' first accepted anchor layers.
    await vi.waitFor(() => expect(createBodyUnion).toHaveBeenCalledTimes(1))
    expect(createBodyUnion).toHaveBeenCalledWith('proj-1', 'geo-1', 'g1', 'g2')
    // The tag-driving refetch: the same geotech-recompute path the canvas uses.
    await vi.waitFor(() => expect(requestBodyRecompute).toHaveBeenCalledWith('geotech'))
    expect(requestGeotechLayersRefetch).toHaveBeenCalled()
    // Reversible → a toast naming the undo path (Ungroup), never a confirm dialog.
    expect(toast).toHaveBeenCalledWith('success', expect.stringMatching(/ungroup/i))
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('PG2 — after grouping, both members show "(group 1)"', async () => {
    seedTwoClassScene()
    // The union list is empty until the Join lands, then reports the new pair.
    listBodyUnions.mockResolvedValueOnce([]).mockResolvedValue([unionItem('u1', 'gbA', 'gbB')])
    createBodyUnion.mockResolvedValue(CREATED_UNION)
    // The recompute bump re-keys useBodyUnions (mirrors NP10's nonce+rerender).
    requestBodyRecompute.mockImplementation(() => {
      mockGeotechNonce += 1
    })
    const view = render(<UnitListPane />)
    expandToClass13()
    fireEvent.click(screen.getByTestId('parameters-node-check-geotech-body:silt-sf:gbA'))
    fireEvent.click(screen.getByTestId('parameters-node-check-geotech-body:silt-sf:gbB'))
    fireEvent.click(screen.getByTestId('parameters-group-action'))
    await vi.waitFor(() => expect(createBodyUnion).toHaveBeenCalledTimes(1))

    view.rerender(<UnitListPane />)
    const tagA = await screen.findByTestId('parameters-node-group-geotech-body:silt-sf:gbA')
    expect(tagA.textContent).toContain('(group 1)')
    expect(
      screen.getByTestId('parameters-node-group-geotech-body:silt-sf:gbB').textContent,
    ).toContain('(group 1)')
  })

  it('PG3 — Ungroup on a member removes it from the group via the same client path', async () => {
    seedTwoClassScene()
    listBodyUnions.mockResolvedValue([unionItem('u1', 'gbA', 'gbB')])
    deleteBodyUnion.mockResolvedValue({
      bodies_changed: 1,
      renamed: [],
      suppressed_unions: 0,
      inert_unions: 0,
    })
    render(<UnitListPane />)
    expandToClass13()
    // Wait for the union list to load so the checked body reads as grouped.
    await screen.findByTestId('parameters-node-group-geotech-body:silt-sf:gbA')

    fireEvent.click(screen.getByTestId('parameters-node-check-geotech-body:silt-sf:gbA'))
    fireEvent.click(screen.getByTestId('parameters-ungroup-action'))

    await vi.waitFor(() => expect(deleteBodyUnion).toHaveBeenCalledWith('proj-1', 'geo-1', 'u1'))
    expect(requestBodyRecompute).toHaveBeenCalledWith('geotech')
  })

  it('PG4 — bodies of different class cannot be grouped: the Group action is disabled', () => {
    seedTwoClassScene()
    listBodyUnions.mockResolvedValue([])
    render(<UnitListPane />)
    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-unit:silt'))
    fireEvent.click(screen.getByTestId('parameters-node-expander-litho-body:silt:lb1'))
    fireEvent.click(screen.getByTestId('parameters-node-expander-geotech-class:silt:lb1:13'))
    fireEvent.click(screen.getByTestId('parameters-node-expander-geotech-class:silt:lb1:14'))

    fireEvent.click(screen.getByTestId('parameters-node-check-geotech-body:silt-sf:gbA'))
    fireEvent.click(screen.getByTestId('parameters-node-check-geotech-body:silt-mf:gbMF'))

    const groupBtn = screen.getByTestId('parameters-group-action') as HTMLButtonElement
    expect(groupBtn.disabled).toBe(true)
    fireEvent.click(groupBtn)
    expect(createBodyUnion).not.toHaveBeenCalled()
  })
})
