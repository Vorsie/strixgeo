// Geotechnical stage canvas — a 2D ⟷ 3D surface that mirrors the Lithology
// stage's 3D body-solid view, scoped to the GEOTECH model.
//
// In 2D mode it renders the shared SectionsCanvas with the axis forced to
// 'geotechnical' (the NAD-coloured band view — the original F4 behaviour).
// In 3D mode it renders the same Geology3DViewer the Lithology stage uses,
// fed the GEOTECH body solids (built by the geotech useLithoSolids instance)
// and NAD-coloured formations.
//
// The litho stage separates 2D (Sections stage) and 3D (Lithology stage); the
// geotech stage is BOTH the 2D edit surface and the 3D view surface, so a
// top-level 2D/3D pill switches between them here. Everything 3D is SHARED
// with LithologyCanvas via useBody3DViewState / BodyViewModePills /
// makeVoxelRequestBuilder (audit FE-SHELL-CLIENTS-10/-11, debt #233), with
// the geotech data swapped in:
//   • formations  → nadColoredFormations(geotechFormations) (NAD colours, not
//     the inherited lithology colour) — the 3D seam documented in nadClasses.ts.
//   • bodySolids  → the geotech model's solids (useLithoSolids on the geotech
//     model id; model-agnostic voxel builder).
//   • Fence + voxel payload → geotech layers + geotech correlation edges
//     (the GEOTECH litho_layer ids + geotech edges feed the SAME model-agnostic
//     assembleLithoSectionInputs / buildVoxelRequest).
//
// Bootstrap requirement (F4): the canvas renders whenever a litho model exists
// (not gated on activeGeotechModel) so "Subdivide all bodies" is reachable
// before the geotech model exists. Only when no litho model exists is an
// EmptyState shown.
//
// The "Build model" button lives in GeotechnicalToolbar (the geotech stage
// toolbar) — co-mounted with this canvas, exactly like LithologyToolbar +
// LithologyCanvas — so the canvas-populated geotechVoxelRequestCallback ref is
// always available when Build is clicked.

import { useEffect, useMemo, useState } from 'react'
import { Box, Layers } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { EmptyState } from '../../EmptyState'
import Geology3DViewer from '../geology/Geology3DViewer'
import SectionsCanvas from '../sections/SectionsCanvas'
import type { VoxelBuildRequest } from '../../../utils/buildVoxelRequest'
import { nadColoredFormations } from '../../../utils/nadClasses'
import {
  useBody3DViewState,
  EMPTY_SURFACES_MAP,
} from '../shared/useBody3DViewState'
import { BodyViewModePills } from '../shared/BodyViewModePills'
import { makeVoxelRequestBuilder } from '../shared/makeVoxelRequestBuilder'
import { buildPackingClassOf } from '../../../utils/geotechHierarchicalFill/packingClassOf'

// ---------------------------------------------------------------------------
// Module-level refs shared with GeotechnicalToolbar — no bus extension.
// Only one GeotechnicalCanvas instance is mounted at a time (race-free).
// Mirror of LithologyCanvas's resetLithoCameraCallback / lithoVoxelRequestCallback.
// ---------------------------------------------------------------------------

/**
 * Ref populated by ``Geology3DViewer`` when mounted as the geotech 3D viewer.
 *
 * ``GeotechnicalToolbar``'s Reset Camera button calls
 * ``resetGeotechCameraCallback.current?.()`` when clicked.
 */
export const resetGeotechCameraCallback: React.MutableRefObject<(() => void) | null> = {
  current: null,
}

/**
 * Reset the geotech split viewport back to single-viewport mode.
 *
 * Populated by ``GeotechnicalCanvas`` while mounted; called by
 * ``GeotechnicalToolbar``'s Reset button (mirrors
 * ``resetLithoSplitViewportCallback``).
 */
export const resetGeotechSplitViewportCallback: React.MutableRefObject<
  (() => void) | null
> = { current: null }

/**
 * Builds the voxel ``VoxelBuildRequest`` for the active GEOTECH model.
 *
 * Populated by ``GeotechnicalCanvas`` while mounted; invoked by
 * ``GeotechnicalToolbar``'s "Build model" button (the same module-ref bridge as
 * ``lithoVoxelRequestCallback``). Async because the geotech correlation edges
 * are section-scoped and fetched fresh at click time. Resolves to ``null`` when
 * there is nothing to build (no geotech model / no sections).
 */
export const geotechVoxelRequestCallback: React.MutableRefObject<
  (() => Promise<VoxelBuildRequest | null>) | null
> = { current: null }

// ---------------------------------------------------------------------------
// GeotechnicalCanvas
// ---------------------------------------------------------------------------

/**
 * Canvas for the Geotechnical stage (S6).
 *
 * A 2D ⟷ 3D surface: the 2D mode reuses ``SectionsCanvas`` with the section
 * axis forced to ``'geotechnical'`` (NAD-coloured band view); the 3D mode
 * renders the geotech body solids in ``Geology3DViewer`` with NAD colours,
 * mirroring the Lithology stage's 3D pane.
 *
 * An ``EmptyState`` is shown ONLY when no lithostratigraphic model exists,
 * because subdivision requires a litho model as its source.
 *
 * Returns
 * -------
 * JSX.Element
 *     The geotech 2D/3D canvas, or a guided placeholder when no litho model.
 */
export default function GeotechnicalCanvas(): JSX.Element {
  const {
    project,
    geoModel: {
      activeLithoModel,
      lithoLayers,
      activeGeotechModel,
      geotechFormations,
      geotechLayers,
      geotechSolids,
      hasGeotechSolids,
      geotechHideMarkers,
    },
    overlays: { showConfidenceFade },
    sections: { visibleSections, sectionModelAxis, setSectionModelAxis },
  } = useShell()

  // -------------------------------------------------------------------------
  // Force the section axis to 'geotechnical' on mount (and whenever it has
  // drifted). Guarded to avoid a spurious re-render / loop. The 2D SectionsCanvas
  // reads this axis; 3D mode ignores it but keeping it set is harmless.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (sectionModelAxis !== 'geotechnical') {
      setSectionModelAxis('geotechnical')
    }
  }, [sectionModelAxis, setSectionModelAxis])

  // -------------------------------------------------------------------------
  // Top-level 2D / 3D dimension toggle — session-ephemeral. Default 2D so the
  // user lands on the editable band view (the original F4 surface).
  // -------------------------------------------------------------------------
  const [dimension, setDimension] = useState<'2d' | '3d'>('2d')

  // -------------------------------------------------------------------------
  // Marker-filtered solids — MUST be useMemo'd (an inline filter would re-create
  // the array every render and thrash Geology3DViewer's primitive-rebuild effect).
  // -------------------------------------------------------------------------
  const visibleSolids = useMemo(
    () => (geotechHideMarkers ? geotechSolids.filter(s => s.is_flagged !== true) : geotechSolids),
    [geotechSolids, geotechHideMarkers],
  )

  const geotechModelId = activeGeotechModel?.id ?? null

  // Formation row → canonical class key: the fill's mass identity (owner
  // 2026-08-21, one mass one body). Same map the geotech axis renders with, so
  // the 3-D build and the fence weld exactly what the 2-D fill welds.
  const packingClassOf = useMemo(
    () =>
      buildPackingClassOf(
        geotechFormations.map(
          f => [f.id, { nadClass: f.nad_class ?? null, soilCode: f.litho_main_soil_code ?? null }] as const,
        ),
      ),
    [geotechFormations],
  )

  // Shared 3D-view plumbing: view mode, wireframe, split state, ground
  // surface, fence-edge fetch + fence memos (audit FE-SHELL-CLIENTS-10).
  // The geotech fence only exists in 3D mode, so the fence gate carries the
  // dimension; edges are fetched off the geotech model id, never the litho
  // model.
  const {
    projectId,
    viewMode,
    setViewMode,
    wireframe,
    setWireframe,
    fenceLoading,
    splitMode,
    splitPlane,
    splitLine,
    handleSplitPlaneDrawn,
    exitSplit,
    groundSurface,
    investigations,
    investigationXY,
    fencePanels,
  } = useBody3DViewState({
    modelId: geotechModelId,
    layers: geotechLayers,
    // The litho model frames the geotech fence, exactly as it frames the
    // geotech 2-D render and the geotech build (owner ruling 2026-08-18).
    frameModelId: activeLithoModel?.id ?? null,
    frameLayers: lithoLayers,
    resetSplitViewportRef: resetGeotechSplitViewportCallback,
    voxelRequestRef: geotechVoxelRequestCallback,
    fenceActive: dimension === '3d',
    packingClassOf,
  })

  // -------------------------------------------------------------------------
  // Voxel build payload — assembled on demand for the "Build model" toolbar
  // button (module-ref bridge). Assigned every render while the canvas is
  // mounted (in BOTH 2D and 3D mode) so Build works regardless of which view is
  // showing. Returns null when there is no geotech model or no section.
  // -------------------------------------------------------------------------
  geotechVoxelRequestCallback.current = makeVoxelRequestBuilder({
    projectId,
    modelId: geotechModelId,
    visibleSections,
    investigations,
    layers: geotechLayers,
    viewState: project?.view_state,
    logLabel: 'geotech-voxel',
    // The litho model frames the geotech build, exactly as it frames the
    // geotech 2-D render (owner ruling 2026-08-18) — one path for both.
    frameModelId: activeLithoModel?.id ?? null,
    frameLayers: lithoLayers,
    packingClassOf,
  })

  // NAD-coloured formations for the 3D viewer (presentation-boundary recolour;
  // a geotech body must read its NAD packing colour, not the inherited litho
  // colour). Memoised so the viewer's rebuild effect does not re-fire.
  const nadFormations = useMemo(
    () => nadColoredFormations(geotechFormations),
    [geotechFormations],
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Without a litho model there is nothing to subdivide — guide the user.
  if (activeLithoModel === null) {
    return (
      <EmptyState
        icon={<Layers />}
        title="No lithostratigraphic model yet"
        hint="Create a lithostratigraphic model in the Lithology stage and accept litho suggestions, then return here to run 'Subdivide all bodies'."
      />
    )
  }

  const projectEpsg = project?.default_horizontal_epsg ?? 31370

  return (
    <div className="relative w-full h-full">
      {/* 2D / 3D dimension toggle — top-centre overlay so it clears the Layers
          legend (top-left) and BasemapPanel (top-right) that the 3D viewer
          paints. pointer-events only on the buttons. */}
      <div
        className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5"
        title="Switch between the 2D section band view and the 3D body model"
      >
        <div className="flex rounded overflow-hidden border border-border-default shadow-sm">
          <button
            type="button"
            data-testid="geotech-view-2d"
            aria-pressed={dimension === '2d'}
            onClick={() => setDimension('2d')}
            className={[
              'px-3 py-1 text-xs font-medium transition-colors',
              dimension === '2d'
                ? 'bg-accent text-white'
                : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
            ].join(' ')}
          >
            2D
          </button>
          <button
            type="button"
            data-testid="geotech-view-3d"
            aria-pressed={dimension === '3d'}
            onClick={() => setDimension('3d')}
            className={[
              'px-3 py-1 text-xs font-medium transition-colors',
              dimension === '3d'
                ? 'bg-accent text-white'
                : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
            ].join(' ')}
          >
            3D
          </button>
        </div>
      </div>

      {dimension === '2d' ? (
        // 2D band view — the shared SectionsCanvas (axis forced above).
        <SectionsCanvas />
      ) : hasGeotechSolids ? (
        <>
          <BodyViewModePills
            testIdPrefix="geotech"
            title="Switch between solid body model and fence-diagram walls"
            viewMode={viewMode}
            setViewMode={setViewMode}
            wireframe={wireframe}
            setWireframe={setWireframe}
            fenceLoading={fenceLoading}
            fencePanels={fencePanels}
            emptyHintTestId="geotech-fence-empty-hint"
            emptyHintText="No fence panels — connect packing bands in the 2D view"
            emptyHintTopClassName="top-10"
          />

          <Geology3DViewer
            splitMode={splitMode}
            splitPlane={splitPlane}
            formations={nadFormations}
            surfacesByFormationId={EMPTY_SURFACES_MAP}
            projectEpsg={projectEpsg}
            onSplitPlaneDrawn={handleSplitPlaneDrawn}
            splitLine={splitLine}
            resetCameraRef={resetGeotechCameraCallback}
            groundSurface={groundSurface}
            showConfidenceFade={showConfidenceFade}
            fencePanels={fencePanels}
            bodySolids={visibleSolids}
            bodySolidsWireframe={wireframe}
            investigationXY={investigationXY}
            onExitSplit={exitSplit}
          />
        </>
      ) : (
        // 3D mode with no built solids yet — guide the user to Build.
        <EmptyState
          icon={<Box />}
          title="No geotech body model yet"
          hint="Run 'Subdivide all bodies' on the 2D section view, then click 'Build model' on the Geotechnical toolbar to generate the 3D NAD body solids."
        />
      )}
    </div>
  )
}
