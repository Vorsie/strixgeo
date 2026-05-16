// Geology stage canvas.
//
// G2: 2D plan view (MapView, read-only) — shown when no non-stale surfaces
// exist yet (i.e. before the user has run Build model).
//
// G5: Cesium 3D viewer — shown when at least one non-stale formation surface
// exists.  Falls back to the MapView plan view when there are no surfaces.
// The MapView fallback is retained indefinitely (the engineer sees geographic
// context before any surfaces are computed).
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
import { useEffect, useRef, useState } from 'react'

import { api } from '../../../api/client'
import type { GroundSurfaceBuildResponse } from '../../../api/client'
import { useShell } from '../../ShellContext'
import MapView from '../../../components/MapView'
import Geology3DViewer, { type SplitMode } from './Geology3DViewer'

// Exposed to GeologyToolbar (same module boundary — no bus extension needed).
// Populated by Geology3DViewer when the primary viewport mounts.
export const resetCameraCallback: React.MutableRefObject<(() => void) | null> = {
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
    visibleCpts,
    visibleBoreholes,
    sections: { sections },
    geoModel: {
      formations,
      surfacesByFormationId,
      activeGeologicalModel,
    },
    mapState: {
      hiddenCptTypes,
      hiddenBoreholeValues,
      boreholeAxis,
      mapCameraRef,
      handleToggleCptType,
      handleToggleBoreholeValue,
      setBoreholeAxis,
      handleViewportChange,
      handleMapCameraChange,
    },
    overlays: {
      demSource,
      demOverlay,
      handleDemOverlayChange,
    },
  } = useShell()

  // ---------------------------------------------------------------------------
  // Split-viewport state (G6) — session-ephemeral
  // ---------------------------------------------------------------------------

  const [splitMode, setSplitMode] = useState<SplitMode>('single')
  const [splitPlane, setSplitPlane] = useState<Cesium.Plane | null>(null)

  function handleSplitPlaneDrawn(plane: Cesium.Plane): void {
    setSplitPlane(plane)
    setSplitMode('split')
  }

  // Exposed so GeologyToolbar Reset can collapse the split without bus
  // extension.  Populated here; GeologyToolbar imports and calls it.
  resetSplitViewportCallback.current = () => {
    setSplitMode('single')
    setSplitPlane(null)
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

  useEffect(() => {
    if (!project || !activeGeologicalModel) {
      setGroundSurface(null)
      return
    }
    const projectId = project.id
    const modelId = activeGeologicalModel.id
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
  }, [project, activeGeologicalModel])

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
        resetCameraRef={resetCameraCallback}
        groundSurface={groundSurface}
      />
    )
  }

  return (
    <MapView
      cpts={visibleCpts}
      boreholes={visibleBoreholes}
      // Read-only: no investigation selection in the Geology stage.
      // The Geology stage is for model definition, not data inspection.
      // Users switch to the Data stage to view CPT charts / borelogs.
      selectedCptId={null}
      selectedBoreholeId={null}
      onSelectCpt={() => {}}
      onSelectBorehole={() => {}}
      hiddenCptTypes={hiddenCptTypes}
      hiddenBoreholeValues={hiddenBoreholeValues}
      boreholeAxis={boreholeAxis}
      onToggleCptType={handleToggleCptType}
      onToggleBoreholeValue={handleToggleBoreholeValue}
      onChangeBoreholeAxis={setBoreholeAxis}
      // No bbox draw — imports live in the Data stage toolbar.
      drawMode={false}
      onViewportChange={handleViewportChange}
      sections={sections}
      // Persist the map camera so navigating away and back restores
      // the user's last frame (same as Data stage behaviour).
      initialCenter={mapCameraRef.current?.center}
      initialZoom={mapCameraRef.current?.zoom}
      onCameraChange={handleMapCameraChange}
      demSource={demSource}
      demOverlay={demOverlay}
      onDemOverlayChange={handleDemOverlayChange}
    />
  )
}

// ---------------------------------------------------------------------------
// Cross-component callbacks — module-level refs shared between GeologyCanvas
// and GeologyToolbar without routing through the ShellContext bus.
// Only one canvas instance is mounted at a time, so this is race-free.
// ---------------------------------------------------------------------------

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
