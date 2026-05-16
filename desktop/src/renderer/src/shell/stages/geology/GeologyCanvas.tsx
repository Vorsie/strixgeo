// Geology stage canvas.
//
// G2/G5: Cesium 3D viewer — shown when at least one non-stale formation
// surface exists (i.e. after the user has run "Build 3D model").  Falls back
// to a clean empty-state message (NOT a 2D map) when no surfaces exist yet.
// The 3D viewer is the ONLY canvas content; a plan-view map is absent from
// the Geology stage by design — the Data stage owns geographic context.
//
// G6: split-viewport mode — the user draws a split line in the 3D scene;
// the canvas splits into two independent CesiumWidget viewports.  Reset
// collapses back to a single viewport.  Split state is session-ephemeral:
// not persisted to the .gmproj bundle.
//
// resetCameraCallback — module-level mutable ref shared between this
// canvas and GeologyToolbar without routing through the bus.  GeologyToolbar
// wires its Reset button to call this; Geology3DViewer populates it when
// mounted.  Only one canvas instance is ever mounted at a time, so a
// module-level ref is safe here — it is never a state-race hazard.
//
// Investigation-selection is intentionally absent: the Geology stage is the
// model-definition surface; the Data stage is the inspection surface.

import * as Cesium from 'cesium'
import { useEffect, useState } from 'react'
import { Mountain, Plus } from 'lucide-react'

import { api } from '../../../api/client'
import type { GroundSurfaceBuildResponse } from '../../../api/client'
import { useShell } from '../../ShellContext'
import Geology3DViewer, {
  type SplitMode,
  type SplitLine,
} from './Geology3DViewer'
import { geologyEmptyState } from './geologyEmptyState'

// ---------------------------------------------------------------------------
// Cross-component callbacks — module-level refs shared between GeologyCanvas
// and GeologyToolbar without routing through the ShellContext bus.
// Only one canvas instance is mounted at a time, so this is race-free.
// ---------------------------------------------------------------------------

// Exposed to GeologyToolbar (same module boundary — no bus extension needed).
// Populated by Geology3DViewer when the primary viewport mounts.
export const resetCameraCallback: React.MutableRefObject<(() => void) | null> = {
  current: null,
}

/**
 * Reset the split viewport back to single-viewport mode.
 *
 * Populated by ``GeologyCanvas`` when mounted.  ``GeologyToolbar`` imports
 * and calls ``resetSplitViewportCallback.current?.()`` when the Reset button
 * is clicked.
 */
export const resetSplitViewportCallback: React.MutableRefObject<(() => void) | null> = {
  current: null,
}

/**
 * Center canvas for the Geology stage.
 *
 * Renders a ``Geology3DViewer`` (Cesium) when at least one non-stale
 * formation surface exists, and falls back to a read-only ``MapView``
 * (geographic plan view) otherwise.
 *
 * Split-viewport state is owned here: ``splitMode`` and ``splitPlane``
 * are local to the canvas.  ``GeologyToolbar.resetSplitViewport()``
 * resets them via ``splitResetCallback`` (see below).
 *
 * All data is sourced from ``useShell()`` — no props are accepted directly
 * (matches the ``StageDescriptor.CanvasComponent`` contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The geology canvas element.
 */
export default function GeologyCanvas(): JSX.Element {
  const {
    project,
    visibleBoreholes,
    geoModel: {
      formations,
      surfacesByFormationId,
      activeGeologicalModel,
      handleInlineCreateFormation,
    },
  } = useShell()

  // Debt #33: a CPT-only project has no boreholes, so "Fill from
  // boreholes" is permanently disabled — the empty canvas must not
  // dead-end there. This CTA creates a placeholder formation inline
  // (same one-click-then-refine pattern as the Sections CTA); the
  // user renames / recolours it in the inspector. Busy flag so a
  // double-click can't spawn two rows.
  const [creatingFormation, setCreatingFormation] = useState(false)

  async function handleAddFormation(): Promise<void> {
    if (creatingFormation) return
    setCreatingFormation(true)
    try {
      await handleInlineCreateFormation({ name: 'New formation' })
    } finally {
      setCreatingFormation(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Split-viewport state (G6) — session-ephemeral
  // ---------------------------------------------------------------------------

  const [splitMode, setSplitMode] = useState<SplitMode>('single')
  const [splitPlane, setSplitPlane] = useState<Cesium.Plane | null>(null)
  const [splitLine, setSplitLine] = useState<SplitLine | null>(null)

  function handleSplitPlaneDrawn(plane: Cesium.Plane, line: SplitLine): void {
    setSplitPlane(plane)
    setSplitLine(line)
    setSplitMode('split')
  }

  // Exposed so GeologyToolbar Reset can collapse the split without bus
  // extension.  Populated here; GeologyToolbar imports and calls it.
  resetSplitViewportCallback.current = () => {
    setSplitMode('single')
    setSplitPlane(null)
    setSplitLine(null)
  }

  // ---------------------------------------------------------------------------
  // Ground-surface TIN (G7) — fetch when active model changes
  //
  // The build call is fire-and-forget on model change. The result is session-
  // local (not persisted to the bundle). An empty surface (vertices=[]) is
  // returned when the model has no in-scope investigations or the EPSG has no
  // DEM provider — in both cases the terrain mesh is simply absent and the
  // scene base falls back to the flat ellipsoid.
  // ---------------------------------------------------------------------------

  const [groundSurface, setGroundSurface] = useState<GroundSurfaceBuildResponse | null>(null)

  const projectId = project?.id ?? null
  const modelId = activeGeologicalModel?.id ?? null

  useEffect(() => {
    if (!projectId || !modelId) {
      setGroundSurface(null)
      return
    }
    let cancelled = false

    api.geology
      .buildGroundSurface(projectId, modelId)
      .then(result => {
        if (!cancelled) setGroundSurface(result)
      })
      .catch(() => {
        // DEM provider unavailable or network error — fall back to flat
        // ellipsoid. The viewer renders correctly without terrain.
        if (!cancelled) setGroundSurface(null)
      })

    return () => {
      cancelled = true
    }
    // Key on stable id strings — a server refresh returning a new object
    // with the same id (e.g. after surfaces/rebuild updates is_stale) must
    // not re-fire the DEM fetch. The surface TIN does not depend on staleness.
  }, [projectId, modelId])

  // ---------------------------------------------------------------------------
  // 3D-or-2D decision
  // ---------------------------------------------------------------------------

  // Show the 3D viewer when at least one surface has vertices (is_stale or
  // fresh — the viewer renders stale surfaces at lower alpha).  When no
  // surfaces have been built at all, fall back to the 2D plan view.
  const hasSurfaces = Array.from(surfacesByFormationId.values()).some(
    s => s.vertices.length > 0,
  )

  const projectEpsg = project.default_horizontal_epsg ?? 31370

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (hasSurfaces) {
    return (
      <Geology3DViewer
        splitMode={splitMode}
        splitPlane={splitPlane}
        formations={formations}
        surfacesByFormationId={surfacesByFormationId}
        projectEpsg={projectEpsg}
        onSplitPlaneDrawn={handleSplitPlaneDrawn}
        splitLine={splitLine}
        resetCameraRef={resetCameraCallback}
        groundSurface={groundSurface}
        onExitSplit={() => {
          setSplitMode('single')
          setSplitPlane(null)
          setSplitLine(null)
        }}
      />
    )
  }

  // No built surfaces yet — show a clean guidance message. A 2D plan-view
  // map does NOT appear here (superseded per geology-stage-architecture.md
  // §5 addendum): the Geology canvas is 3D-or-message only; geographic
  // context lives in the Data stage.
  const { guidance, showAddFormation } = geologyEmptyState(
    formations.length > 0,
    visibleBoreholes.length > 0,
  )

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
      <Mountain size={40} className="text-text-muted" />
      <p className="text-sm text-center max-w-sm leading-snug">{guidance}</p>
      {showAddFormation && (
        <button
          type="button"
          onClick={() => void handleAddFormation()}
          disabled={creatingFormation}
          title="Create a placeholder formation — rename and recolour it in the inspector"
          className={[
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            creatingFormation
              ? 'bg-accent/40 text-text-on-accent cursor-not-allowed'
              : 'bg-accent text-text-on-accent hover:bg-accent-muted',
          ].join(' ')}
        >
          <Plus size={13} />
          {creatingFormation ? 'Adding…' : 'Add formation'}
        </button>
      )}
    </div>
  )
}
