// Mount smoke test for LithologyInspector (debt #201 decomposition round).
//
// The #201 round moved five presentational pieces out of the orchestrator
// (LithoFormationRoster, LithoSolidLegend, LithoCommittedPill,
// LithoConfidenceFadeToggle, LithoResolveAction). This test mounts the
// orchestrator against the SHARED shell fixture so a TDZ / hook-order
// regression surfaces at unit level — every orchestrator hook + derivation and
// LithoSolidLegend's own hooks run on mount (its hooks fire even in the
// empty-solids branch), so a "read before declaration" or "rendered more hooks
// than last render" bug fails here rather than only in the app.
//
// The behavioural net lives in LithologyInspector.test.tsx; this only proves
// the component mounts in both the guidance branch and the full-body branch.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import { makeStubContext, makeLithoModel } from '../sections/__fixtures__/shellStub'
import LithologyInspector from './LithologyInspector'

// ModelKindPicker makes api calls internally; stub it as a no-op so the mount
// does no network.
vi.mock('./ModelKindPicker', () => ({
  default: () => <div data-testid="model-kind-picker" />,
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

// api.geology.listLenses fires from a useEffect once a litho model is active —
// stub it so the full-body mount does no network.
vi.mock('../../../api/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../api/client')>()
  return {
    ...orig,
    api: {
      ...((orig as Record<string, unknown>).api as object),
      geology: {
        ...(((orig as Record<string, unknown>).api as Record<string, unknown>).geology as object),
        listLenses: () => Promise.resolve([]),
      },
    },
  }
})

/** A geological-model row (parent of {@link makeLithoModel}). */
function makeGeoModel(): GeologicalModelResponse {
  return { ...makeLithoModel('geo-1'), kind: 'geological', parent_model_id: null }
}

afterEach(cleanup)

describe('LithologyInspector — mount smoke (debt #201)', () => {
  // Guidance branch: no geological model → the create-first prompt, no picker.
  // Every orchestrator hook runs before this early return, so a TDZ in the
  // hook/derivation phase surfaces here.
  it('mounts the no-geological-model guidance branch without throwing', () => {
    const ctx = makeStubContext() // activeGeologicalModel is null in the stub
    render(
      <ShellContext.Provider value={ctx}>
        <LithologyInspector />
      </ShellContext.Provider>,
    )
    expect(screen.getByText(/create a geological model first/i)).toBeInTheDocument()
  })

  // Full-body branch: active geological + litho model → the whole panel renders,
  // mounting the extracted children (LithoConfidenceFadeToggle, LithoResolveAction,
  // LithoSolidLegend). LithoSolidLegend runs all its own hooks even on empty
  // solids, so a hook-order regression in the moved component fails here too.
  it('mounts the full body (active geological + litho model) without throwing', () => {
    const ctx = makeStubContext({ lithoModel: makeLithoModel() })
    ctx.geoModel.activeGeologicalModel = makeGeoModel()
    render(
      <ShellContext.Provider value={ctx}>
        <LithologyInspector />
      </ShellContext.Provider>,
    )
    expect(screen.getByTestId('model-kind-picker')).toBeInTheDocument()
    expect(screen.getByTestId('litho-solid-legend')).toBeInTheDocument()
  })
})
