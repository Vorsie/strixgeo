// Behavioral net for GeotechnicalToolbar (Task 4 — geotech 3D Build verb).
//
// Claims pinned here:
//   GT1  No geotech model → toolbar renders nothing (null).
//   GT2  Geotech model + bands → "Build model" button renders, enabled.
//   GT3  Geotech model but NO bands (0 geotech layers) → Build disabled.
//   GT4  Clicking Build calls buildGeotechSolids with the canvas-populated
//        voxel-request callback (the module-ref bridge) — the CONTROL for the
//        2026-08-26 pre-flight: a model with nothing missing builds exactly as
//        it always did, and no dialog appears.
//   GT5  A test in the model with accepted litho and no packing bands stops the
//        press and opens the pre-flight dialog instead.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import type { VoxelBuildState } from '../../../hooks/useVoxelBuildStream'

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
    parent_model_id: 'litho-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/** One accepted layer on ``investigationId``, spanning the whole column. */
function layer(investigationId: string, suffix: string): Record<string, unknown> {
  return {
    id: `${investigationId}-${suffix}`,
    cpt_id: investigationId,
    borehole_id: null,
    formation_id: `f-${suffix}`,
    body_id: null,
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
  }
}

/** Two CPTs on one section — the smallest model that fills anything. */
const CTX_INVESTIGATIONS = [
  { id: 'S1', name: 'S1', location_x: 0, location_y: 0, elevation_m: 5 },
  { id: 'S2', name: 'S2', location_x: 50, location_y: 0, elevation_m: 5 },
]
const CTX_SECTION = {
  id: 'cs1',
  name: 'Cross-section 1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 10,
  excluded_cpt_ids: [],
  excluded_borehole_ids: [],
}
const CTX_LITHO = [layer('S1', 'litho'), layer('S2', 'litho')]
/** Both columns banded — the complete-model control. */
const CTX_GEOTECH_COMPLETE = [layer('S1', 'nad'), layer('S2', 'nad')]

/**
 * Minimal ShellContextValue — only the fields the toolbar and its pre-flight
 * read are meaningful; everything else is cast through unknown.
 */
function makeCtx(overrides: {
  activeGeotechModel?: GeologicalModelResponse | null
  geotechLayers?: unknown[]
  lithoLayers?: unknown[]
  buildGeotechSolids?: (builder?: () => Promise<unknown>) => Promise<void>
  geotechSolidsBuilding?: boolean
  hasStaleGeotechSolid?: boolean
  hasGeotechSolids?: boolean
  staleLithoGeotechColumns?: { investigation_id: string; label: string }[]
  columnsNeedingRederive?: string[]
  // debt #282 — the geotech streaming-build state + cancel the toolbar reads to
  // swap the Build button for inline progress while a job runs.
  geotechVoxelBuildState?: VoxelBuildState
  cancelGeotechBuild?: () => void
} = {}): ShellContextValue {
  return {
    visibleCpts: CTX_INVESTIGATIONS,
    visibleBoreholes: [],
    sections: { visibleSections: [CTX_SECTION] },
    coordinator: { setSectionsDeepLinkTarget: () => {} },
    toasts: { toast: () => {} },
    geoModel: {
      activeGeotechModel:
        overrides.activeGeotechModel === undefined ? makeGeotechModel() : overrides.activeGeotechModel,
      lithoLayers: overrides.lithoLayers ?? CTX_LITHO,
      geotechLayers: overrides.geotechLayers ?? CTX_GEOTECH_COMPLETE,
      geotechSolidsBuilding: overrides.geotechSolidsBuilding ?? false,
      hasStaleGeotechSolid: overrides.hasStaleGeotechSolid ?? false,
      hasGeotechSolids: overrides.hasGeotechSolids ?? false,
      buildGeotechSolids: overrides.buildGeotechSolids ?? noopAsync,
      geotechVoxelBuildState: overrides.geotechVoxelBuildState ?? { status: 'idle' },
      cancelGeotechBuild: overrides.cancelGeotechBuild ?? (() => {}),
      handleSubdivideAllBodies: noopAsync,
      handleDivideBoreholes: noopAsync,
      // Debt #266 — the two "these bands are out of date" signals the toolbar
      // merges into its amber chip. Both default to "nothing stale".
      staleLithoGeotechColumns: overrides.staleLithoGeotechColumns ?? [],
      columnsNeedingRederive: overrides.columnsNeedingRederive ?? [],
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

  it('GT4 — a complete model builds exactly as it did before the pre-flight', () => {
    const buildGeotechSolids = vi.fn().mockResolvedValue(undefined)
    renderToolbar(makeCtx({ buildGeotechSolids }))
    fireEvent.click(screen.getByTestId('geotech-build-model-button'))
    expect(buildGeotechSolids).toHaveBeenCalledTimes(1)
    // The canvas-populated voxel-request callback is forwarded as the builder,
    // unwrapped — nothing about the payload can have changed.
    expect(buildGeotechSolids).toHaveBeenCalledWith(voxelBuilderSentinel)
    // ...and the engineer is asked nothing.
    expect(screen.queryByTestId('geotech-build-preflight-dialog')).toBeNull()
    expect(screen.queryByTestId('geotech-excluded-tests-chip')).toBeNull()
  })

  it('GT5 — a test with no packing bands stops the press and asks instead', () => {
    const buildGeotechSolids = vi.fn().mockResolvedValue(undefined)
    renderToolbar(
      makeCtx({
        buildGeotechSolids,
        // S2 was imported after the subdivision: accepted litho, no bands.
        geotechLayers: [layer('S1', 'nad')],
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-build-model-button'))
    expect(buildGeotechSolids).not.toHaveBeenCalled()
    expect(screen.getByTestId('geotech-build-preflight-dialog')).toBeTruthy()
    expect(screen.getByTestId('geotech-preflight-visit-S2').textContent).toContain('S2')
  })

  it('GT6 — "Build without them" builds and leaves a chip naming what was left out', () => {
    const buildGeotechSolids = vi.fn().mockResolvedValue(undefined)
    renderToolbar(makeCtx({ buildGeotechSolids, geotechLayers: [layer('S1', 'nad')] }))
    fireEvent.click(screen.getByTestId('geotech-build-model-button'))
    fireEvent.click(screen.getByTestId('geotech-preflight-build-without'))

    expect(buildGeotechSolids).toHaveBeenCalledTimes(1)
    // Wrapped this time — the exclusion set has to travel with the build, so it
    // is NOT the bare canvas callback.
    expect(buildGeotechSolids).not.toHaveBeenCalledWith(voxelBuilderSentinel)
    const chip = screen.getByTestId('geotech-excluded-tests-chip')
    expect(chip.textContent).toBe('1 test excluded')
    // A real button, so it can be walked by keyboard like the pending chip.
    expect(chip.tagName).toBe('BUTTON')
  })

  // Debt #266 — this button bakes the packing bands into a 3-D model an export
  // ships. If the lithology under a column moved after its bands were made, the
  // last place to notice is here, before the staleness stops being visible.
  it('GT7 — packing standing on edited lithology is named before the model is built', () => {
    renderToolbar(
      makeCtx({
        staleLithoGeotechColumns: [
          { investigation_id: 'inv-s17', label: 'GEO-23/125-S17' },
        ],
      }),
    )

    const chip = screen.getByTestId('geotech-stale-litho-chip')
    expect(chip.textContent).toContain('1')
    expect(chip.getAttribute('title')).toContain('GEO-23/125-S17')
  })

  it('GT8 — with every column matching its lithology there is no chip to ignore', () => {
    renderToolbar(makeCtx())

    expect(screen.queryByTestId('geotech-stale-litho-chip')).toBeNull()
  })

  // debt #282 — the geotech Build gets the same treatment the litho Build got:
  // while a background build job runs, the Build button is REPLACED by inline
  // progress + a Cancel, and Cancel asks the streaming build to stop.
  it('GT10 — a running build replaces Build with inline progress + Cancel', () => {
    const cancelGeotechBuild = vi.fn()
    renderToolbar(
      makeCtx({
        geotechVoxelBuildState: {
          status: 'running',
          latest: { phase: 'label', done: 3, total: 12 },
          highestPhaseIndex: 0,
          cancelRequested: false,
        },
        cancelGeotechBuild,
      }),
    )

    // The Build button is gone while running; the Cancel button is present.
    expect(screen.queryByTestId('geotech-build-model-button')).toBeNull()
    fireEvent.click(screen.getByTestId('geotech-build-cancel-button'))
    expect(cancelGeotechBuild).toHaveBeenCalledOnce()
  })

  it('GT11 — a running build shows the current phase text in the inline progress', () => {
    renderToolbar(
      makeCtx({
        geotechVoxelBuildState: {
          status: 'running',
          latest: { phase: 'extract', done: 1, total: 1 },
          highestPhaseIndex: 2,
          cancelRequested: false,
        },
      }),
    )
    expect(screen.getByRole('status')).toHaveTextContent(/extract/i)
  })

  it('GT9 — the geometric and provenance signals make ONE count, not two', () => {
    // Both notice S17. His action is the same either way — re-run the
    // subdivision on that column — so he is told once.
    renderToolbar(
      makeCtx({
        staleLithoGeotechColumns: [
          { investigation_id: 'inv-s17', label: 'GEO-23/125-S17' },
        ],
        columnsNeedingRederive: ['inv-s17'],
      }),
    )

    expect(screen.getByTestId('geotech-stale-litho-chip').textContent).toContain('1')
  })
})


describe('GeotechnicalToolbar waits for the section list (owner 2026-09-26)', () => {
  it('GT12 — Build model is disabled with a loading hint while the section list has not landed', () => {
    const ctx = makeCtx()
    ctx.sections = { ...ctx.sections, sectionsLoaded: false }
    renderToolbar(ctx)
    const btn = screen.getByTestId('geotech-build-model-button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/loading/i)
  })
})
