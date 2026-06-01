// Lithology stage canvas — 3D surface viewer for built litho TINs,
// or a guided EmptyState when none exist yet.
//
// Slice D of #55 litho peer-stage scaffolding. Split-viewport added 2026-06-01
// (resolves debt #64).
//
// Design:
//   • When at least one litho surface has vertices, render the existing
//     Geology3DViewer.  Its props (formations / surfacesByFormationId)
//     are generic arrays — pass lithoFormations + lithoSurfacesByFormationId.
//     Geology3DViewer.tsx is NOT modified.
//   • Split-viewport mirrors GeologyCanvas exactly: local splitMode /
//     splitPlane / splitLine state; resetLithoSplitViewportCallback exposed
//     for LithologyStage's Reset toolbar button.
//   • Ground surface: api.geology.buildGroundSurface(projectId, modelId)
//     scoped to the litho model id (model-id-agnostic call).
//   • resetLithoCameraCallback: module-level ref shared with LithologyStage's
//     Reset Camera toolbar button — same pattern as GeologyCanvas.

import * as Cesium from 'cesium'
import { useEffect, useState } from 'react'
import { Layers3 } from 'lucide-react'

import { api } from '../../../api/client'
import type { GroundSurfaceBuildResponse } from '../../../api/client'
import { useShell } from '../../ShellContext'
import { EmptyState } from '../../EmptyState'
import Geology3DViewer, {
  type SplitMode,
  type SplitLine,
} from '../geology/Geology3DViewer'

// ---------------------------------------------------------------------------
// Module-level refs shared with LithologyStage toolbar — no bus extension.
// Only one LithologyCanvas instance is mounted at a time (race-free).
// ---------------------------------------------------------------------------

/**
 * Ref populated by ``Geology3DViewer`` when mounted as the litho 3D viewer.
 *
 * ``LithologyStage``'s Reset Camera toolbar button calls
 * ``resetLithoCameraCallback.current?.()`` when clicked.
 */
export const resetLithoCameraCallback: React.MutableRefObject<(() => void) | null> = {
  current: null,
}

/**
 * Reset the split viewport back to single-viewport mode.
 *
 * Populated by ``LithologyCanvas`` when mounted.  ``LithologyStage`` imports
 * and calls ``resetLithoSplitViewportCallback.current?.()`` when the Reset
 * button is clicked (same pattern as ``GeologyCanvas``'s
 * ``resetSplitViewportCallback``).
 */
export const resetLithoSplitViewportCallback: React.MutableRefObject<
  (() => void) | null
> = { current: null }

/**
 * Center canvas for the Lithology stage.
 *
 * Renders a ``Geology3DViewer`` (Cesium) when at least one litho surface
 * has been built (``vertices.length > 0``).  Falls back to a guided
 * ``EmptyState`` when no surfaces exist yet.
 *
 * Split-viewport mode mirrors ``GeologyCanvas`` exactly.  ``splitMode``,
 * ``splitPlane`` and ``splitLine`` are local session-ephemeral state; the
 * user draws the split line in the 3D scene via the ``Geology3DViewer``
 * "Split model" button.  ``resetLithoSplitViewportCallback`` is populated
 * here so ``LithologyStage``'s toolbar Reset verb can collapse the split.
 *
 * All data is sourced from ``useShell()`` — no props accepted (matches
 * the ``StageDescriptor.CanvasComponent`` contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The lithology canvas element.
 */
export default function LithologyCanvas(): JSX.Element {
  const {
    project,
    geoModel: {
      activeLithoModel,
      lithoFormations,
      lithoSurfacesByFormationId,
    },
    overlays: { showConfidenceFade },
  } = useShell()

  // ---------------------------------------------------------------------------
  // Split-viewport state — session-ephemeral, not persisted to the bundle.
  // Mirrors GeologyCanvas's splitMode / splitPlane / splitLine pattern.
  // ---------------------------------------------------------------------------

  const [splitMode, setSplitMode] = useState<SplitMode>('single')
  const [splitPlane, setSplitPlane] = useState<Cesium.Plane | null>(null)
  const [splitLine, setSplitLine] = useState<SplitLine | null>(null)

  function handleSplitPlaneDrawn(plane: Cesium.Plane, line: SplitLine): void {
    setSplitPlane(plane)
    setSplitLine(line)
    setSplitMode('split')
  }

  // Exposed so LithologyStage toolbar Reset can collapse the split without
  // bus extension — same pattern as GeologyCanvas.
  resetLithoSplitViewportCallback.current = () => {
    setSplitMode('single')
    setSplitPlane(null)
    setSplitLine(null)
  }

  // ---------------------------------------------------------------------------
  // Ground-surface TIN scoped to the active litho model.
  // Same fire-and-forget pattern as GeologyCanvas — session-local, not
  // persisted to the bundle.  Null when no litho model or DEM unavailable.
  // ---------------------------------------------------------------------------

  const [groundSurface, setGroundSurface] = useState<GroundSurfaceBuildResponse | null>(null)

  const projectId = project?.id ?? null
  const lithoModelId = activeLithoModel?.id ?? null

  useEffect(() => {
    if (!projectId || !lithoModelId) {
      setGroundSurface(null)
      return
    }
    let cancelled = false

    api.geology
      .buildGroundSurface(projectId, lithoModelId)
      .then(result => {
        if (!cancelled) setGroundSurface(result)
      })
      .catch(() => {
        // DEM provider unavailable or network error — flat ellipsoid fallback.
        if (!cancelled) setGroundSurface(null)
      })

    return () => {
      cancelled = true
    }
    // Key on stable id strings; DEM fetch does not depend on surface staleness.
  }, [projectId, lithoModelId])

  // Show the 3D viewer when at least one litho surface has vertices.
  // Stale surfaces are included (Geology3DViewer renders them at lower alpha).
  const hasLithoSurfaces = Array.from(lithoSurfacesByFormationId.values()).some(
    s => s.vertices.length > 0,
  )

  const projectEpsg = project.default_horizontal_epsg ?? 31370

  if (hasLithoSurfaces) {
    return (
      <Geology3DViewer
        splitMode={splitMode}
        splitPlane={splitPlane}
        formations={lithoFormations}
        surfacesByFormationId={lithoSurfacesByFormationId}
        projectEpsg={projectEpsg}
        onSplitPlaneDrawn={handleSplitPlaneDrawn}
        splitLine={splitLine}
        resetCameraRef={resetLithoCameraCallback}
        groundSurface={groundSurface}
        showConfidenceFade={showConfidenceFade}
        onExitSplit={() => {
          setSplitMode('single')
          setSplitPlane(null)
          setSplitLine(null)
        }}
      />
    )
  }

  return (
    <EmptyState
      icon={<Layers3 />}
      title="Lithostratigraphic model"
      hint="Select or create a lithology model in the right panel. To place contacts, open the Sections stage and draw them there — once placed and built, the 3D surfaces appear here."
    />
  )
}
