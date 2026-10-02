// Red-first pins for the Parameters tree NAMES (owner findings on
// testproject_dev, 2026-10-02). The scene copies the shape of his project:
// three models side by side — the geological "Default" (Antropogeen /
// Fluviatiel Holoceen / Fluviatiel Pleistoceen, never in this tree), a litho
// model with ZAND (SL:M) / VEEN / SILT / KLEI / ZAND, and a geotech model whose
// units are named "<litho> (NAD n)". Litho bodies are numbered across the ZAND
// naming group, so the lone ZAND (SL:M) body carries body_ordinal 12, and one
// cross-family WELD body (#4) has its home on ZAND while its SL:M ground puts it
// under the ZAND (SL:M) row too (the 2026-09-16 geotech-sourced rule).
//
// DN1 — "the unit rows show the raw DOV admixture token": a unit row reads the
//       same translated name the Lithology roster shows ("ZAND | matig siltig"),
//       and the raw stored name rides along for the row's tooltip.
// DN2 — "a body is named after its OWN home formation, under whichever row it
//       sits": weld body #4 reads "ZAND · #4" under the SL:M row AND under the
//       ZAND row — one body, one name.
// DN3 — ruling A(a): "keep the stored body_ordinal as printed" — #12 stays #12.
// DN4 — "id-like names for a moment before they changed to real names": a tree
//       built before the body rosters (and the geotech formation list) have
//       landed prints NO id text — a loading word instead.
// DN5 — the scope header path reads the same display names as the tree.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerResponse } from '../../../api/client'
import { setLanguage } from '../../../i18n/languageSelect'
import type { BodyRosterEntry } from './parameterUnitBodies'
import {
  buildParameterTree,
  type ParameterTreeInput,
  type ParameterTreeNode,
} from './parameterBodyTree'
import { scopeHeaderLabel } from './parameterScopeHeader'

function formation(
  id: string,
  over: Partial<GeologicalFormationResponse>,
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'p',
    name: id,
    color: '#888',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    parent_extrapolated: false,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function layer(id: string, over: Partial<LithoLayerResponse>): LithoLayerResponse {
  return {
    id,
    model_id: 'm',
    formation_id: 'f',
    borehole_id: null,
    cpt_id: 'c1',
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    parent_litho_layer_id: null,
    notes: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as LithoLayerResponse
}

// uuid-shaped ids, so an id leak is recognisable ("a84343518…" in his report).
const ZAND_SL = 'a8434351-8f00-4c1e-9d2a-000000000001'
const ZAND = 'b1111111-8f00-4c1e-9d2a-000000000002'
const BODY_SL_12 = 'c2222222-8f00-4c1e-9d2a-000000000012'
const BODY_WELD_4 = 'd3333333-8f00-4c1e-9d2a-000000000004'
const BODY_ZAND_0 = 'e4444444-8f00-4c1e-9d2a-000000000000'

const SL_M = [{ soil_code: 'SL', amount: 'M', locally: false }]

function lithoFormations(): GeologicalFormationResponse[] {
  return [
    formation(ZAND_SL, {
      name: 'ZAND (SL:M)',
      display_order: 0,
      litho_main_soil_code: 'ZAND',
      litho_admixtures: SL_M,
    }),
    formation('veen', { name: 'VEEN', display_order: 1, litho_main_soil_code: 'VEEN' }),
    formation('silt', { name: 'SILT', display_order: 2, litho_main_soil_code: 'SILT' }),
    formation('klei', { name: 'KLEI', display_order: 3, litho_main_soil_code: 'KLEI' }),
    formation(ZAND, { name: 'ZAND', display_order: 4, litho_main_soil_code: 'ZAND' }),
  ]
}

function geotechFormations(): GeologicalFormationResponse[] {
  return [
    formation('g-sl-10', {
      name: 'ZAND (SL:M) (NAD 10)',
      nad_class: 10,
      litho_main_soil_code: 'ZAND',
      litho_admixtures: SL_M,
      source_litho_formation_id: ZAND_SL,
    }),
    formation('g-z-7', {
      name: 'ZAND (NAD 7)',
      nad_class: 7,
      litho_main_soil_code: 'ZAND',
      source_litho_formation_id: ZAND,
    }),
  ]
}

function lithoRoster(): ReadonlyMap<string, BodyRosterEntry> {
  return new Map<string, BodyRosterEntry>([
    [BODY_SL_12, { name: null, body_ordinal: 12, formation_id: ZAND_SL }],
    // The weld body: home ZAND (the BodyOrm formation), numbered #4 in ZAND's group.
    [BODY_WELD_4, { name: null, body_ordinal: 4, formation_id: ZAND }],
    [BODY_ZAND_0, { name: null, body_ordinal: 0, formation_id: ZAND }],
  ])
}

function geotechRoster(): ReadonlyMap<string, BodyRosterEntry> {
  return new Map<string, BodyRosterEntry>([
    ['f5555555-gb1', { name: null, body_ordinal: 0, formation_id: 'g-sl-10' }],
    ['f6666666-gb2', { name: null, body_ordinal: 1, formation_id: 'g-sl-10' }],
    ['f7777777-gb3', { name: null, body_ordinal: 0, formation_id: 'g-z-7' }],
  ])
}

function scene(over: Partial<ParameterTreeInput> = {}): ParameterTreeInput {
  return {
    lithoFormations: lithoFormations(),
    geotechFormations: geotechFormations(),
    lithoLayers: [
      layer('L12', { formation_id: ZAND_SL, body_id: BODY_SL_12 }),
      // The weld body spans an SL:M band and a plain ZAND band.
      layer('LW-sl', { formation_id: ZAND_SL, body_id: BODY_WELD_4, cpt_id: 'c2' }),
      layer('LW-z', { formation_id: ZAND, body_id: BODY_WELD_4, cpt_id: 'c2' }),
      layer('L0', { formation_id: ZAND, body_id: BODY_ZAND_0, cpt_id: 'c3' }),
    ],
    geotechLayers: [
      layer('G1', { formation_id: 'g-sl-10', parent_litho_layer_id: 'LW-sl', body_id: 'f5555555-gb1', cpt_id: 'c2' }),
      layer('G2', { formation_id: 'g-sl-10', parent_litho_layer_id: 'L12', body_id: 'f6666666-gb2' }),
      layer('G3', { formation_id: 'g-z-7', parent_litho_layer_id: 'LW-z', body_id: 'f7777777-gb3', cpt_id: 'c2' }),
    ],
    lithoBodies: lithoRoster(),
    geotechBodies: geotechRoster(),
    ...over,
  }
}

function unitNode(tree: ParameterTreeNode[], unitId: string): ParameterTreeNode {
  const node = tree.find(n => n.scope.kind === 'litho-unit' && n.scope.unitId === unitId)
  if (node === undefined) throw new Error(`no unit row ${unitId}`)
  return node
}

function bodyNode(unit: ParameterTreeNode, bodyId: string): ParameterTreeNode {
  const node = unit.children.find(n => n.scope.kind === 'litho-body' && n.scope.bodyId === bodyId)
  if (node === undefined) throw new Error(`no body row ${bodyId}`)
  return node
}

function allLabels(nodes: readonly ParameterTreeNode[]): string[] {
  return nodes.flatMap(n => [n.label, ...allLabels(n.children)])
}

/** True when ``text`` carries any id (or an 8-char id prefix) of the scene. */
function carriesId(text: string): boolean {
  const ids = [
    ZAND_SL,
    ZAND,
    BODY_SL_12,
    BODY_WELD_4,
    BODY_ZAND_0,
    'f5555555-gb1',
    'f6666666-gb2',
    'f7777777-gb3',
  ]
  return ids.some(id => text.includes(id.slice(0, 8)))
}

beforeEach(() => setLanguage('nl'))
afterEach(() => setLanguage('en'))

describe('Parameters tree names — presentation boundary (owner 2026-10-02)', () => {
  it('DN1 — the ZAND (SL:M) row reads the roster name "ZAND | matig siltig"; the raw token rides the tooltip', () => {
    const tree = buildParameterTree(scene())
    const sl = unitNode(tree, ZAND_SL)
    expect(sl.label).toBe('ZAND | matig siltig')
    expect(sl.rawName).toBe('ZAND (SL:M)')
    // No row of the subtree prints the raw DOV admixture token.
    for (const label of allLabels([sl])) expect(label).not.toContain('(SL:M)')
    // A plain unit reads its plain name.
    expect(unitNode(tree, ZAND).label).toBe('ZAND')
  })

  it('DN2 — weld body #4 is named after its OWN home (ZAND), under the SL:M row and under the ZAND row alike', () => {
    const tree = buildParameterTree(scene())
    const underSl = bodyNode(unitNode(tree, ZAND_SL), BODY_WELD_4)
    const underZand = bodyNode(unitNode(tree, ZAND), BODY_WELD_4)
    expect(underSl.label).toBe('ZAND · #4')
    expect(underZand.label).toBe('ZAND · #4')
  })

  it('DN3 — ruling A(a): the stored body_ordinal is printed as stored ("#12" stays "#12")', () => {
    const tree = buildParameterTree(scene())
    expect(bodyNode(unitNode(tree, ZAND_SL), BODY_SL_12).label).toBe('ZAND | matig siltig · #12')
  })

  it('DN4 — a tree built before the rosters and the geotech formation list landed prints no id, only a loading word', () => {
    const tree = buildParameterTree(
      scene({ lithoBodies: new Map(), geotechBodies: new Map(), geotechFormations: [] }),
    )
    const labels = allLabels(tree)
    expect(labels.length).toBeGreaterThan(5)
    for (const label of labels) expect(carriesId(label)).toBe(false)
    expect(labels.some(l => l.includes('Laden…'))).toBe(true)
  })

  it('DN4b — the same holds with the formations known but only the geotech roster missing', () => {
    const tree = buildParameterTree(scene({ geotechBodies: new Map() }))
    for (const label of allLabels(tree)) expect(carriesId(label)).toBe(false)
  })

  it('DN5 — the scope header path reads the display names, never the raw token', () => {
    const input = scene()
    const unitHeader = scopeHeaderLabel({ kind: 'litho-unit', unitId: ZAND_SL }, input)
    expect(unitHeader.startsWith('ZAND | matig siltig')).toBe(true)
    const weldHeader = scopeHeaderLabel(
      { kind: 'litho-body', unitId: ZAND_SL, bodyId: BODY_WELD_4 },
      input,
    )
    expect(weldHeader).toContain('ZAND · #4')
    expect(weldHeader).not.toContain('(SL:M)')
  })
})
