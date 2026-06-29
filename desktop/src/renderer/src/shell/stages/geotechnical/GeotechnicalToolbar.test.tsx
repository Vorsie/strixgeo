// Behavioral net for GeotechnicalToolbar (Task 4 — geotech 3D Build verb).
//
// Claims pinned here:
//   GT1  No geotech model → toolbar renders nothing (null).
//   GT2  Geotech model + bands → "Build model" button renders, enabled.
//   GT3  Geotech model but NO bands (0 geotech layers) → Build disabled.
//   GT4  Clicking Build calls buildGeotechSolids with the canvas-populated
//        voxel-request callback (the module-ref bridge).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'

// Mock GeotechnicalCanvas — importing it pulls Cesium/WebGL via Geology3DViewer.
// The toolbar only needs the three module-ref bridges it exports; the voxel
// callback ref carries a sentinel so GT4 can assert it is forwarded to Build.
// vi.hoisted so the sentinel exists when the hoisted vi.mock factory runs.
const { voxelBuilderSentinel } = vi.hoisted(() => ({ voxelBuilderSentinel: vi.fn() }))
vi.mock('./GeotechnicalCanvas', () => ({
  resetGeotechCameraCallback: { current: null },
  resetGeotechSplitViewportCallback: { current: null },
  geotechVoxelRequestCallback: { current: voxelBuilderSentinel },
}))

import GeotechnicalToolbar from './GeotechnicalToolbar'

const noopAsync = (): Promise<void> => Promise.resolve()

function makeGeotechModel(): GeologicalModelResponse {
  return {
    id: 'geotech-1',
    app_project_id: 'proj-1',
    name: 'Geotech model',
    description: null,
    kind: 'geotechnical',
    parent_geological_model_id: 'litho-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * Minimal ShellContextValue — only the geoModel fields the toolbar reads are
 * meaningful; everything else is cast through unknown.
 */
function makeCtx(overrides: {
  activeGeotechModel?: GeologicalModelResponse | null
  geotechLayers?: unknown[]
  buildGeotechSolids?: (builder?: () => Promise<unknown>) => Promise<void>
  geotechSolidsBuilding?: boolean
  hasStaleGeotechSolid?: boolean
  hasGeotechSolids?: boolean
} = {}): ShellContextValue {
  return {
    geoModel: {
      activeGeotechModel:
        overrides.activeGeotechModel === undefined ? makeGeotechModel() : overrides.activeGeotechModel,
      geotechLayers: overrides.geotechLayers ?? [{ id: 'gl-1' }],
      geotechSolidsBuilding: overrides.geotechSolidsBuilding ?? false,
      hasStaleGeotechSolid: overrides.hasStaleGeotechSolid ?? false,
      hasGeotechSolids: overrides.hasGeotechSolids ?? false,
      buildGeotechSolids: overrides.buildGeotechSolids ?? noopAsync,
    },
  } as unknown as ShellContextValue
}

function renderToolbar(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <GeotechnicalToolbar />
    </ShellContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GeotechnicalToolbar (Task 4 — geotech 3D Build verb)', () => {
  it('GT1 — no geotech model: renders nothing', () => {
    const { container } = renderToolbar(makeCtx({ activeGeotechModel: null }))
    expect(container.firstChild).toBeNull()
  })

  it('GT2 — geotech model + bands: Build model renders enabled', () => {
    renderToolbar(makeCtx({ geotechLayers: [{ id: 'gl-1' }] }))
    const btn = screen.getByTestId('geotech-build-model-button')
    expect(btn).toBeTruthy()
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it('GT3 — geotech model but no bands: Build is disabled', () => {
    renderToolbar(makeCtx({ geotechLayers: [] }))
    const btn = screen.getByTestId('geotech-build-model-button')
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('GT4 — clicking Build calls buildGeotechSolids with the voxel-request callback', () => {
    const buildGeotechSolids = vi.fn().mockResolvedValue(undefined)
    renderToolbar(makeCtx({ buildGeotechSolids }))
    fireEvent.click(screen.getByTestId('geotech-build-model-button'))
    expect(buildGeotechSolids).toHaveBeenCalledTimes(1)
    // The canvas-populated voxel-request callback is forwarded as the builder.
    expect(buildGeotechSolids).toHaveBeenCalledWith(voxelBuilderSentinel)
  })
})
