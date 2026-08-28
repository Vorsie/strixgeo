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

import { useMemo, useState } from 'react'
import { Mountain, Plus } from 'lucide-react'

import { isGeologicalFormation } from '../../../utils/formationKind'
import { useShell } from '../../ShellContext'
import { useT } from '../../../i18n/translate'
import Geology3DViewer from './Geology3DViewer'
import { useBody3DViewState } from '../shared/useBody3DViewState'
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
    overlays: { showConfidenceFade },
  } = useShell()

  const t = useT()

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
      // 'New formation' is a STORED placeholder name (written to the DB and
      // carried into exports), not a rendered label — it stays English by the
      // "never translate a stored/transported token" rule. The user renames it
      // in the inspector.
      await handleInlineCreateFormation({ name: 'New formation' })
    } finally {
      setCreatingFormation(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Split-viewport state (G6) + ground-surface TIN (G7) — shared plumbing.
  //
  // Both blocks live in useBody3DViewState (audit FE-SHELL-CLIENTS-10 — the
  // Lithology / Geotechnical canvases carry the same state).  The Geology
  // stage has no fence machinery, so fenceActive is false and the hook's
  // fence effect / memos stay inert.  The hook populates
  // resetSplitViewportCallback so GeologyToolbar Reset can collapse the
  // split without a bus extension.
  //
  // Ground-surface: the build call is fire-and-forget on model change; the
  // result is session-local (not persisted to the bundle).  An empty surface
  // (vertices=[]) is returned when the model has no in-scope investigations
  // or the EPSG has no DEM provider — in both cases the terrain mesh is
  // simply absent and the scene base falls back to the flat ellipsoid.
  // ---------------------------------------------------------------------------

  const modelId = activeGeologicalModel?.id ?? null

  const {
    splitMode,
    splitPlane,
    splitLine,
    handleSplitPlaneDrawn,
    exitSplit,
    groundSurface,
  } = useBody3DViewState({
    modelId,
    resetSplitViewportRef: resetSplitViewportCallback,
    fenceActive: false,
    // The footprint ring is the hull of a VOXEL build; a geological model has
    // none, so the fetch could only ever answer "never built".
    footprintActive: false,
  })

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

  // The geoModel bus exposes EVERY formation in the project —
  // geological, lithostratigraphic, and geotech. The Geology stage
  // must only show the geological vocabulary; litho / geotech units
  // belong in their own stages. Filter here so the 3D viewer's
  // Layers panel + body rendering both honour the boundary.
  //
  // The earlier naive predicate (``parent_formation_id === null``)
  // leaked orphan litho units (dogfeed bug 2026-05-21:
  // SILT / KLEI / ZAND showing in the Geology Layers panel for
  // investigations where the litho ghost was accepted above the
  // shallowest geo contact, leaving ``parent_formation_id=null``).
  // ``isGeologicalFormation`` discriminates on ``litho_main_soil_code``
  // + ``nad_class`` — see utils/formationKind.ts for the rationale.
  //
  // Surfaces map stays unfiltered — Geology3DViewer iterates
  // ``formations``, so any litho surfaces without a matching formation
  // are silently ignored.
  const geologicalFormations = useMemo(
    () => formations.filter(isGeologicalFormation),
    [formations],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (hasSurfaces) {
    return (
      <Geology3DViewer
        splitMode={splitMode}
        splitPlane={splitPlane}
        formations={geologicalFormations}
        surfacesByFormationId={surfacesByFormationId}
        projectEpsg={projectEpsg}
        onSplitPlaneDrawn={handleSplitPlaneDrawn}
        splitLine={splitLine}
        resetCameraRef={resetCameraCallback}
        groundSurface={groundSurface}
        showConfidenceFade={showConfidenceFade}
        onExitSplit={exitSplit}
      />
    )
  }

  // No built surfaces yet — show a clean guidance message. A 2D plan-view
  // map does NOT appear here (superseded per geology-stage-architecture.md
  // §5 addendum): the Geology canvas is 3D-or-message only; geographic
  // context lives in the Data stage.
  const { guidance, showAddFormation } = geologyEmptyState(
    t,
    geologicalFormations.length > 0,
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
          title={t('geology.newFormationHint')}
          className={[
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            creatingFormation
              ? 'bg-accent/40 text-text-on-accent cursor-not-allowed'
              : 'bg-accent text-text-on-accent hover:bg-accent-muted',
          ].join(' ')}
        >
          <Plus size={13} />
          {creatingFormation ? t('geology.adding') : t('geology.addFormation')}
        </button>
      )}
    </div>
  )
}
