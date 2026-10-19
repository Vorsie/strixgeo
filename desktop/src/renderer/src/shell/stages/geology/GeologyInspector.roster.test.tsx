// Owner ruling B(a), 2026-10-02: "the Stratigrafie stage roster ALWAYS lists
// the geological formations, whatever the Sections axis". On testproject_dev
// the litho build switched the Sections axis to lithostratigraphic and the
// roster swapped to the five litho units (ZAND (SL:M) / VEEN / SILT / KLEI /
// ZAND) while the canvas kept drawing Antropogeen / Holoceen / Pleistoceen.
//
// SR1 — with the Sections axis on lithostratigraphic, the roster lists the
//       three geological formations of the "Default" model and no litho unit.
// SR2 — the header count is the number of rows the roster lists (it counted
//       every kind in the visible manifest).
// SR3 — a drag-reorder on that roster can never write display_order on a
//       litho (or geotech) unit, even when the visible manifest holds them.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
} from '../../../api/client'
import { makeLithoModel, makeStubContext } from '../sections/__fixtures__/shellStub'
import GeologyInspector from './GeologyInspector'
import { reorderFormationsCommand } from './reorderFormationsCommand'

const updateFormation = vi.fn()

vi.mock('../../../components/interpretation/FormationDialog', () => ({
  default: () => null,
}))

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('../../../api/client', async importOriginal => {
  const orig = await importOriginal<typeof import('../../../api/client')>()
  const api = (orig as Record<string, unknown>).api as Record<string, unknown>
  return {
    ...orig,
    api: {
      ...api,
      geology: {
        ...(api.geology as object),
        getContactConsistency: vi.fn().mockResolvedValue({ model_id: '', status: 'ready', formations: [] }),
        validateCrossings: () => Promise.resolve({ model_id: '', issues: [] }),
        updateFormation: (...args: unknown[]) => updateFormation(...args),
      },
    },
  }
})

function formation(
  id: string,
  name: string,
  displayOrder: number,
  over: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#888888',
    code: null,
    regional_ref: null,
    description: null,
    display_order: displayOrder,
    pinned_order: false,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

/** testproject_dev's three models side by side, in one project-wide list. */
function threeModelFormations(): GeologicalFormationResponse[] {
  const litho = (id: string, name: string, order: number, code: string) =>
    formation(id, name, order, { litho_main_soil_code: code })
  return [
    // Geological "Default" — oldest first (display_order ascending).
    formation('geo-pleisto', 'Fluviatiel Pleistoceen', 0),
    formation('geo-holo', 'Fluviatiel Holoceen', 1),
    formation('geo-antropo', 'Antropogeen', 2),
    // The litho model's units — each model numbers its own stratigraphic
    // order, so their display_order values INTERLEAVE with the geological ones.
    litho('lu-zand-sl', 'ZAND (SL:M)', 0, 'ZAND'),
    litho('lu-veen', 'VEEN', 1, 'VEEN'),
    litho('lu-silt', 'SILT', 2, 'SILT'),
    litho('lu-klei', 'KLEI', 3, 'KLEI'),
    litho('lu-zand', 'ZAND', 4, 'ZAND'),
    // One geotech unit.
    formation('gt-zand-10', 'ZAND (SL:M) (NAD 10)', 0, {
      litho_main_soil_code: 'ZAND',
      nad_class: 10,
      source_litho_formation_id: 'lu-zand-sl',
    }),
  ]
}

const LITHO_AND_GEOTECH_IDS = [
  'lu-zand-sl',
  'lu-veen',
  'lu-silt',
  'lu-klei',
  'lu-zand',
  'gt-zand-10',
]

function lithoContact(formationId: string): FormationContactResponse {
  return { id: `c-${formationId}`, formation_id: formationId } as FormationContactResponse
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Stratigrafie roster — always the geological formations (owner ruling B(a), 2026-10-02)', () => {
  function mountOnLithoAxis(): void {
    const ctx = makeStubContext({ sectionModelAxis: 'lithostratigraphic' })
    const geoModel: GeologicalModelResponse = {
      ...makeLithoModel('geo-default'),
      name: 'Default',
      kind: 'geological',
      parent_model_id: null,
    }
    ctx.geoModel.activeGeologicalModel = geoModel
    const all = threeModelFormations()
    ctx.geoModel.formations = all
    // The visible manifest admits every row (the .gmproj reload / Fill case).
    ctx.geoModel.visibleFormations = all
    ctx.coordinator.manifestFormationIds = new Set(all.map(f => f.id))
    // Every litho unit has a contact in the active litho model.
    ctx.geoModel.lithoContacts = ['lu-zand-sl', 'lu-veen', 'lu-silt', 'lu-klei', 'lu-zand'].map(
      lithoContact,
    )
    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )
  }

  it('SR1 — on the lithostratigraphic Sections axis the roster still lists Antropogeen / Holoceen / Pleistoceen and no litho unit', () => {
    mountOnLithoAxis()
    for (const id of ['geo-antropo', 'geo-holo', 'geo-pleisto']) {
      expect(screen.getByTestId(`geology-formation-list-item-${id}`)).toBeInTheDocument()
    }
    for (const id of LITHO_AND_GEOTECH_IDS) {
      expect(screen.queryByTestId(`geology-formation-list-item-${id}`)).toBeNull()
    }
  })

  it('SR2 — the header count is the number of geological rows listed', () => {
    mountOnLithoAxis()
    expect(screen.getByTestId('geology-formation-count').textContent).toBe('3')
  })
})

describe('Stratigrafie roster drag-reorder — never writes a litho unit (owner ruling B(a))', () => {
  it('SR3 — dragging Antropogeen below Holoceen PATCHes only geological formations', async () => {
    updateFormation.mockResolvedValue({})
    const all = threeModelFormations()
    await reorderFormationsCommand(
      {
        projectId: 'proj-1',
        formations: all,
        manifestFormationIds: new Set(all.map(f => f.id)),
        setFormations: vi.fn(),
        setReorderBusy: vi.fn(),
        handleFormationUpdated: vi.fn(),
        pushUndoCommand: vi.fn(),
        refetchFormations: vi.fn().mockResolvedValue(undefined),
      },
      'geo-antropo',
      'geo-pleisto',
    )
    const written = updateFormation.mock.calls.map(c => c[1] as string)
    expect(written.length).toBeGreaterThan(0)
    for (const id of written) expect(LITHO_AND_GEOTECH_IDS).not.toContain(id)
  })
})
