// Lithology stage canvas — 3D surface viewer for built litho TINs,
// or a guided EmptyState when none exist yet.
//
// Slice D of #55 litho peer-stage scaffolding.
//
// Design (system-architect):
//   • Single-viewport only — no split-line draw, no 2D fallback.
//     The split-viewport is a Geology-stage interaction; the litho stage
//     doesn't inherit it until a user-reported need justifies the cost.
//     (Tracked as Tier E debt — see #55 resolution note in debt.md.)
//   • When at least one litho surface has vertices, render the existing
//     Geology3DViewer.  Its props (formations / surfacesByFormationId)
//     are generic arrays — pass lithoFormations + lithoSurfacesByFormationId.
//     Geology3DViewer.tsx is NOT modified.
//   • Ground surface: api.geology.buildGroundSurface(projectId, modelId)
//     scoped to the litho model id (the backend call is model-id-agnostic).
//   • resetLithoCameraCallback: module-level ref shared with LithologyStage's
//     Reset Camera toolbar button — same pattern as GeologyCanvas's
//     resetCameraCallback.

import { useEffect, useState } from 'react'
import { Layers3 } from 'lucide-react'

import { api } from '../../../api/client'
import type { GroundSurfaceBuildResponse } from '../../../api/client'
import { useShell } from '../../ShellContext'
import { EmptyState } from '../../EmptyState'
import Geology3DViewer from '../geology/Geology3DViewer'

// ---------------------------------------------------------------------------
// Module-level ref shared with LithologyStage toolbar — no bus extension needed.
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

// Noop — required by Geology3DViewer.onSplitPlaneDrawn but never called in
// single-viewport mode (the split-line draw interaction is disabled here).
function noopSplitPlaneDrawn(): void {}

/**
 * Center canvas for the Lithology stage.
 *
 * Renders a ``Geology3DViewer`` (Cesium) when at least one litho surface
 * has been built (``vertices.length > 0``).  Falls back to a guided
 * ``EmptyState`` when no surfaces exist yet.
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

  // Ground-surface TIN scoped to the active litho model.
  // Same fire-and-forget pattern as GeologyCanvas — session-local, not
  // persisted to the bundle.  Null when no litho model or DEM unavailable.
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
        splitMode="single"
        splitPlane={null}
        formations={lithoFormations}
        surfacesByFormationId={lithoSurfacesByFormationId}
        projectEpsg={projectEpsg}
        onSplitPlaneDrawn={noopSplitPlaneDrawn}
        splitLine={null}
        resetCameraRef={resetLithoCameraCallback}
        groundSurface={groundSurface}
        showConfidenceFade={showConfidenceFade}
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
