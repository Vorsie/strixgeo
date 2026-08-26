// Geotechnical stage canvas — the 3D room for the GEOTECH model, mirroring
// the Lithology stage's 3D body-solid view.
//
// Stage symmetry (owner ruling 2026-08-26): the litho world splits 2D (Sections
// stage) from 3D (Lithology stage), and the geotech world now does the same.
// This canvas used to carry a top-level 2D ⟷ 3D pill whose 2D half was just
// SectionsCanvas with the axis forced to 'geotechnical' — a second door onto a
// surface that already lives on the Sections stage. The pill is gone: the 2D
// geotech band view is reached by switching the Sections stage's axis picker to
// "Geotech", and this stage is the 3D room. One place per job.
//
// Everything 3D is SHARED with LithologyCanvas via useBody3DViewState /
// BodyViewModePills / makeVoxelRequestBuilder (audit FE-SHELL-CLIENTS-10/-11,
// debt #233), with the geotech data swapped in:
//   • formations  → nadColoredFormations(geotechFormations) (NAD colours, not
//     the inherited lithology colour) — the 3D seam documented in nadClasses.ts.
//   • bodySolids  → the geotech model's solids (useLithoSolids on the geotech
//     model id; model-agnostic voxel builder).
//   • Fence + voxel payload → geotech layers + geotech correlation edges
//     (the GEOTECH litho_layer ids + geotech edges feed the SAME model-agnostic
//     assembleLithoSectionInputs / buildVoxelRequest).
//
// Two guided empty states, mirroring the litho stage's hasLithoSolids gate:
//   • no litho model at all → subdivision has no source; point at Lithology.
//   • litho model but no built geotech solids → point at Build.
// The canvas is NOT gated on activeGeotechModel: "Subdivide all bodies" (the
// Sections-stage geotech verb) is what creates that model, so gating here would
// only hide the Build hint from the user who still has to run it.
//
// The "Build model" button lives in GeotechnicalToolbar (the geotech stage
// toolbar) — co-mounted with this canvas, exactly like LithologyToolbar +
// LithologyCanvas — so the canvas-populated geotechVoxelRequestCallback ref is
// always available when Build is clicked.

import { useMemo } from 'react'
import { Box, Layers } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { EmptyState } from '../../EmptyState'
import Geology3DViewer from '../geology/Geology3DViewer'
import { nadColoredFormations } from '../../../utils/nadClasses'
import {
  useBody3DViewState,
  EMPTY_SURFACES_MAP,
} from '../shared/useBody3DViewState'
import { BodyViewModePills } from '../shared/BodyViewModePills'
import {
  makeVoxelRequestBuilder,
  type VoxelRequestBuilder,
} from '../shared/makeVoxelRequestBuilder'
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
 *
 * It takes the set of investigations to IGNORE for this build — the Build
 * pre-flight's "Build without them" arm (owner ruling 2026-08-26). Omitting the
 * argument is the ordinary whole-model build.
 */
export const geotechVoxelRequestCallback: React.MutableRefObject<VoxelRequestBuilder | null> = {
  current: null,
}

// ---------------------------------------------------------------------------
// GeotechnicalCanvas
// ---------------------------------------------------------------------------

/**
 * Canvas for the Geotechnical stage (S6) — the 3D geotech body model.
 *
 * Renders the geotech body solids in ``Geology3DViewer`` with NAD colours,
 * mirroring the Lithology stage's 3D pane. The 2D geotech band view lives on
 * the Sections stage (axis picker → "Geotech"), not here.
 *
 * Two guided ``EmptyState``s replace the viewer: no lithostratigraphic model
 * (subdivision has no source) and no built geotech solids yet (run Build).
 *
 * Returns
 * -------
 * JSX.Element
 *     The geotech 3D canvas, or a guided placeholder.
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
    sections: { visibleSections },
  } = useShell()

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
  // ``fenceActive`` is left at its default (true) — this stage is 3D-only, so
  // the fence is always reachable; edges are fetched off the geotech model id,
  // never the litho model.
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
    packingClassOf,
  })

  // -------------------------------------------------------------------------
  // Voxel build payload — assembled on demand for the "Build model" toolbar
  // button (module-ref bridge). Assigned every render while the canvas is
  // mounted, ABOVE the early returns, so Build works even while an EmptyState
  // is showing. Returns null when there is no geotech model or no section.
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
        hint="Create a lithostratigraphic model in the Lithology stage and accept litho suggestions, then return here to build the 3D geotechnical model."
      />
    )
  }

  // Litho model present but nothing built yet — guide the user to Build.
  if (!hasGeotechSolids) {
    return (
      <EmptyState
        icon={<Box />}
        title="No geotech body model yet"
        hint="Run 'Subdivide all bodies' on the Sections stage (geotech axis), then click 'Build model' on the Geotechnical toolbar to generate the 3D NAD body solids."
      />
    )
  }

  const projectEpsg = project?.default_horizontal_epsg ?? 31370

  return (
    <div className="relative w-full h-full">
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
        emptyHintText="No fence panels — connect packing bands on the Sections stage"
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
    </div>
  )
}
