// Mount smoke test for GeologyInspector (debt #201 decomposition round).
//
// The #201 round moved the formation-roster CRUD + drag-reorder block into the
// useGeologyFormations hook and pulled five presentational pieces out of the
// orchestrator (GeologyInspectorHeader, GeologyConfidenceFadeToggle,
// GeologyCrossingsBanner, GeologyFormationList + its module-scope
// GeologyFormationRow, GeologyBoreholesInModel). This test mounts the
// orchestrator against the SHARED shell fixture so a TDZ / hook-order
// regression surfaces at unit level — every orchestrator hook + derivation and
// the hook's own hooks run on mount, so a "read before declaration" or
// "rendered more hooks than last render" bug fails here rather than only in the
// app.
//
// The behavioural net lives in GeologyStage.test.tsx; this only proves the
// component mounts in both the no-model branch and the full-body branch.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { GeologicalFormationResponse, GeologicalModelResponse } from '../../../api/client'
import { makeStubContext, makeLithoModel, makeBorehole } from '../sections/__fixtures__/shellStub'
import GeologyInspector from './GeologyInspector'

// FormationDialog is a form modal; stub it so the mount does not need the full
// dialog tree.
vi.mock('../../../components/interpretation/FormationDialog', () => ({
  default: () => null,
}))

vi.mock('../../../utils/log', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

// useCrossingsValidation fires api.geology.validateCrossings from a useEffect
// once a geological model is active — stub it so the full-body mount does no
// network.
vi.mock('../../../api/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../api/client')>()
  return {
    ...orig,
    api: {
      ...((orig as Record<string, unknown>).api as object),
      geology: {
        ...(((orig as Record<string, unknown>).api as Record<string, unknown>).geology as object),
        validateCrossings: () => Promise.resolve({ model_id: '', issues: [] }),
      },
    },
  }
})

/** A geological-model row (the active model the inspector reads). */
function makeGeoModel(): GeologicalModelResponse {
  return { ...makeLithoModel('geo-1'), kind: 'geological', parent_model_id: null }
}

/** A minimal geological formation for the roster branch. */
function makeFormation(id = 'form-1'): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: 'Boom Klei',
    color: '#b45309',
    code: null,
    regional_ref: null,
    description: null,
    display_order: 0,
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
  }
}

afterEach(cleanup)

describe('GeologyInspector — mount smoke (debt #201)', () => {
  // No-model branch: activeGeologicalModel is null in the stub, so the
  // crossings validator never fetches. Every orchestrator hook + the
  // useGeologyFormations hook run before this renders, so a TDZ in the
  // hook/derivation phase surfaces here.
  it('mounts the no-model branch without throwing', () => {
    const ctx = makeStubContext()
    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )
    expect(screen.getByTestId('geology-create-formation-button')).toBeInTheDocument()
  })

  // Full-body branch: active geological model + a visible formation + a
  // borehole → the whole panel renders, mounting the extracted children
  // (GeologyFormationList + GeologyFormationRow, GeologyBoreholesInModel,
  // GeologyCrossingsBanner, GeologyConfidenceFadeToggle).
  it('mounts the full body (active model + formation + borehole) without throwing', () => {
    const ctx = makeStubContext({ visibleBoreholes: [makeBorehole()] })
    ctx.geoModel.activeGeologicalModel = makeGeoModel()
    const formation = makeFormation()
    ctx.geoModel.formations = [formation]
    ctx.geoModel.visibleFormations = [formation]
    ctx.coordinator.manifestFormationIds = new Set(['form-1'])
    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )
    expect(screen.getByTestId('geology-create-formation-button')).toBeInTheDocument()
    expect(screen.getByTestId('geology-formation-list-item-form-1')).toBeInTheDocument()
  })
})
