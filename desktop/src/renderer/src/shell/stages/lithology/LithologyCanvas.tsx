// Lithology stage canvas — 3D solid viewer for built litho body solids,
// or a guided EmptyState when none exist yet.
//
// Slice D of #55 litho peer-stage scaffolding. Split-viewport added 2026-06-01
// (resolves debt #64).
// Fence/Solid toggle added 2026-06-10 (Task 6, Litho 3D fence diagram).
// Solid-mode solid fetch + Build + per-body colour picker added 2026-06-10
// (Task 8, Litho 3D milestone 2).
// Build button + legend LIFTED to toolbar + inspector 2026-06-10 (dogfeed UX):
//   Build → the single "Build model" button in LithologyToolbar.
//   Per-body legend → LithologyInspector (grouped by lithology, collapsible).
// Canvas now reads lithoSolids / hasLithoSolids from useShell().geoModel
// (owned by useLithoSolids called inside useGeologicalModel) — no local
// solid state.
// Mount gate changed to hasLithoSolids (Task 8, litho-3d plan):
//   TIN surfaces are retired from the litho pane; the pane now mounts only
//   when body solids exist.  An always-empty surfaces map is passed to
//   Geology3DViewer so the Surfaces legend + draw loop are suppressed without
//   touching the shared viewer (the geology pane is unaffected).
// Shared 3D plumbing EXTRACTED 2026-07-13 (audit FE-SHELL-CLIENTS-10/-11,
// debt #233): split state, ground-surface fetch, fence-edge fetch and the
// fence memos live in useBody3DViewState; the Solid/Fence/Wireframe pills +
// empty-fence hint in BodyViewModePills; the voxel-request callback in
// makeVoxelRequestBuilder.  GeotechnicalCanvas consumes the same modules.
//
// Design:
//   • When hasLithoSolids is true, render the existing Geology3DViewer.
//     Its props are generic — pass lithoFormations + EMPTY_SURFACES_MAP.
//     Geology3DViewer.tsx is NOT modified.
//   • Split-viewport mirrors GeologyCanvas exactly (via useBody3DViewState);
//     resetLithoSplitViewportCallback is exposed for LithologyStage's Reset
//     toolbar button.
//   • Ground surface: api.geology.buildGroundSurface(projectId, modelId)
//     scoped to the litho model id (model-id-agnostic call).
//   • resetLithoCameraCallback: module-level ref shared with LithologyStage's
//     Reset Camera toolbar button — same pattern as GeologyCanvas.
//   • viewMode ('solid' | 'fence'): session-ephemeral.  In Solid mode the
//     per-body watertight solids are rendered (TIN sheets always suppressed).
//     In Fence mode the whole-project partition fill is projected to
//     world-space panels and passed to Geology3DViewer via fencePanels.

import { useEffect, useMemo, useRef } from 'react'
import { Layers3 } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { useT } from '../../../i18n/translate'
import { EmptyState } from '../../EmptyState'
import Geology3DViewer from '../geology/Geology3DViewer'
import { nadColoredFormations } from '../../../utils/nadClasses'
import type { CompareScene } from '../shared/splitViewport'
import { exportFenceDxf } from '../shared/exportFenceDxf'
import {
  useBody3DViewState,
  EMPTY_SURFACES_MAP,
} from '../shared/useBody3DViewState'
import { BodyViewModePills } from '../shared/BodyViewModePills'
import {
  makeVoxelRequestBuilder,
  type VoxelRequestBuilder,
} from '../shared/makeVoxelRequestBuilder'

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
 * Builds the voxel ``VoxelBuildRequest`` for the active litho model.
 *
 * Populated by ``LithologyCanvas`` while mounted; invoked by
 * ``LithologyStage``'s "Build model" toolbar button so the Build path can reach
 * the per-section partition data that lives in the canvas (the same module-ref
 * bridge as ``resetLithoCameraCallback``).
 *
 * The builder is async because the correlation edges are section-scoped and
 * fetched fresh at click time (Solid mode — the default — does not keep an
 * edges cache, so the build cannot rely on the fence-mode state).  Resolves to
 * ``null`` when there is nothing to build (no model / no sections / no
 * accepted layers), which the Build handler surfaces as a "nothing to build"
 * toast.
 */
export const lithoVoxelRequestCallback: React.MutableRefObject<VoxelRequestBuilder | null> = {
  current: null,
}

/**
 * Export the litho fence diagram as DXF.
 *
 * Populated by ``LithologyCanvas`` while mounted; invoked by
 * ``LithologyStage``'s "Export fence" toolbar button. Same module-ref bridge
 * as ``lithoVoxelRequestCallback`` — the fence walls are canvas-local state
 * that never reaches the shell bus, so the toolbar cannot assemble the export
 * itself. ``null`` when the canvas is not mounted.
 */
export const lithoFenceExportCallback: React.MutableRefObject<(() => Promise<void>) | null> = {
  current: null,
}

// ---------------------------------------------------------------------------
// LithologyCanvas
// ---------------------------------------------------------------------------

/**
 * Center canvas for the Lithology stage.
 *
 * Renders a ``Geology3DViewer`` (Cesium) when at least one litho body solid
 * has been built (``hasLithoSolids`` is true in the shell bus).  Falls back
 * to a guided ``EmptyState`` when no solids exist yet.
 *
 * TIN surfaces are NEVER shown on the litho pane — an always-empty surfaces
 * map is passed to ``Geology3DViewer`` so the Surfaces legend toggle and TIN
 * sheet rendering are suppressed without modifying the shared viewer (the
 * geology pane passes its own real surfaces and is unaffected).
 *
 * Split-viewport, ground-surface, fence-edge and view-mode state are owned by
 * the shared ``useBody3DViewState`` hook (mirrored by ``GeotechnicalCanvas``);
 * ``resetLithoSplitViewportCallback`` is populated there so
 * ``LithologyStage``'s toolbar Reset verb can collapse the split.
 *
 * Fence/Solid toggle: ``viewMode`` switches between the closed-solid render
 * (Solid) and the whole-project partition fill projected to fence panels
 * (Fence).  The fence build uses ``lithoLayers`` from the shell bus (no
 * extra fetch), ``visibleCpts``/``visibleBoreholes`` for investigation
 * coordinates, ``visibleSections`` for section geometry, and per-section
 * correlation edges fetched lazily when Fence mode is activated.
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
      lithoLayers,
      lithoSolids,
      hasLithoSolids,
      hideMarkers,
      geotechFormations,
      geotechSolids,
    },
    overlays: { showConfidenceFade },
    sections: { visibleSections },
    toasts: { toast },
  } = useShell()
  const t = useT()

  // ---------------------------------------------------------------------------
  // Marker-filtered solids — MUST be useMemo'd.
  //
  // An inline lithoSolids.filter(...) in JSX would produce a new array on
  // every render.  Geology3DViewer's primitive-rebuild effect has bodySolids
  // in its dep array, so an inline filter would tear down and rebuild every
  // Cesium primitive on every render (the S7 infinite-rebuild class).
  // ---------------------------------------------------------------------------

  const visibleSolids = useMemo(
    () => (hideMarkers ? lithoSolids.filter(s => s.is_flagged !== true) : lithoSolids),
    [lithoSolids, hideMarkers],
  )

  const lithoModelId = activeLithoModel?.id ?? null

  // Per-instance record of the callbacks THIS canvas last wrote into the
  // module-level toolbar-bridge refs. The unmount cleanup below surrenders a
  // ref ONLY while it still holds this instance's callback — React can mount a
  // replacement canvas before it runs this one's cleanup (and both stages can
  // be alive at once in the split viewport), so an older instance must never
  // null a ref a newer instance has already claimed (debt #276).
  const ownedFenceExport = useRef<(() => Promise<void>) | null>(null)
  const ownedVoxelRequest = useRef<VoxelRequestBuilder | null>(null)
  const ownedSplitViewport = useRef<(() => void) | null>(null)

  // Shared 3D-view plumbing: view mode, wireframe, split state, ground
  // surface, fence-edge fetch + fence memos (audit FE-SHELL-CLIENTS-10).
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
    enterCompare,
    groundSurface,
    investigations,
    investigationXY,
    fencePanels,
    footprintRing,
  } = useBody3DViewState({
    modelId: lithoModelId,
    layers: lithoLayers,
    bodySolids: lithoSolids,
    resetSplitViewportRef: resetLithoSplitViewportCallback,
  })

  // ``useBody3DViewState`` wrote ``exitSplit`` into resetLithoSplitViewportCallback;
  // record it so the unmount guard can tell whether a newer canvas has since
  // reclaimed the ref.
  ownedSplitViewport.current = exitSplit

  // The comparison pane: the GEOTECH subdivision derived from this model, in
  // its NAD colours (the presentation-boundary recolour — a geotech body must
  // read its packing colour, not the inherited lithology colour). Solid view
  // only; see the mirror comment in GeotechnicalCanvas.
  const geotechCompareScene = useMemo<CompareScene>(
    () => ({
      label: 'Geotechnical',
      formations: nadColoredFormations(geotechFormations),
      bodySolids: geotechSolids,
    }),
    [geotechFormations, geotechSolids],
  )

  // Fence-DXF export bridge. Assigned every render while mounted, ABOVE the
  // early return, so the toolbar button never holds a stale closure over an
  // earlier fence; nulled on unmount so a click after a stage switch is a
  // no-op rather than an export of a destroyed view's geometry.
  lithoFenceExportCallback.current =
    projectId && lithoModelId && fencePanels
      ? () =>
          exportFenceDxf({
            projectId,
            modelId: lithoModelId,
            modelName: activeLithoModel?.name ?? 'lithostratigraphy',
            panels: fencePanels,
            // The SAME array the viewer paints with, so the DXF layer names
            // and colours are what the user is looking at.
            formations: lithoFormations,
            toast,
          })
      : null
  ownedFenceExport.current = lithoFenceExportCallback.current

  // ---------------------------------------------------------------------------
  // Voxel build payload — assembled on demand for the "Build model" toolbar
  // button (module-ref bridge, same pattern as resetLithoCameraCallback).
  //
  // The toolbar lives in LithologyStage and has no access to the per-section
  // partition data that lives here, so the canvas populates this ref every
  // render; the toolbar's Build onClick invokes it.  Assigned ABOVE the early
  // return so the ref is always populated while the canvas is mounted.
  // ---------------------------------------------------------------------------

  lithoVoxelRequestCallback.current = makeVoxelRequestBuilder({
    projectId,
    modelId: lithoModelId,
    visibleSections,
    investigations,
    layers: lithoLayers,
    viewState: project?.view_state,
    logLabel: 'litho-voxel',
  })
  ownedVoxelRequest.current = lithoVoxelRequestCallback.current

  // Null every toolbar-bridge ref this canvas owns when it unmounts, so a
  // toolbar click after a stage switch is a no-op instead of a call against a
  // destroyed view (debt #276). Each null is GUARDED — it fires only while the
  // module ref still points at THIS instance's callback — so an older canvas's
  // unmount cannot wipe a ref a newer canvas has already claimed. Declared
  // ABOVE the early return so the hook order never depends on hasLithoSolids.
  useEffect(
    () => () => {
      if (lithoFenceExportCallback.current === ownedFenceExport.current)
        lithoFenceExportCallback.current = null
      if (lithoVoxelRequestCallback.current === ownedVoxelRequest.current)
        lithoVoxelRequestCallback.current = null
      if (resetLithoSplitViewportCallback.current === ownedSplitViewport.current)
        resetLithoSplitViewportCallback.current = null
    },
    [],
  )

  // ---------------------------------------------------------------------------
  // Solid-mode derived state
  //
  // hasLithoSolids comes from useShell().geoModel (owned by useLithoSolids).
  // surfacesMapForViewer: always pass EMPTY_SURFACES_MAP so TIN sheets are
  // never rendered on the litho pane (the Surfaces legend toggle + draw loop
  // in Geology3DViewer are both gated on the map having vertices — an empty
  // map suppresses both without touching the shared viewer component, leaving
  // the geology pane's Surfaces layer fully intact).
  // ---------------------------------------------------------------------------

  const surfacesMapForViewer = EMPTY_SURFACES_MAP

  const projectEpsg = project.default_horizontal_epsg ?? 31370

  if (hasLithoSolids) {
    return (
      <div className="relative w-full h-full">
        {/* Build button and per-body legend have moved:
            - Build → the single "Build model" button in LithologyToolbar
            - Legend → LithologyInspector (grouped by lithology)
            Both read from useShell().geoModel (useLithoSolids). */}

        <BodyViewModePills
          testIdPrefix="litho"
          title={t('litho.switchSolidFence')}
          viewMode={viewMode}
          setViewMode={setViewMode}
          wireframe={wireframe}
          setWireframe={setWireframe}
          fenceLoading={fenceLoading}
          fencePanels={fencePanels}
          emptyHintTestId="fence-empty-hint"
          emptyHintText={t('litho.fenceEmptyHint')}
          emptyHintTopClassName="top-8"
        />

        <Geology3DViewer
          splitMode={splitMode}
          splitPlane={splitPlane}
          formations={lithoFormations}
          surfacesByFormationId={surfacesMapForViewer}
          projectEpsg={projectEpsg}
          onSplitPlaneDrawn={handleSplitPlaneDrawn}
          splitLine={splitLine}
          resetCameraRef={resetLithoCameraCallback}
          groundSurface={groundSurface}
          showConfidenceFade={showConfidenceFade}
          fencePanels={fencePanels}
          bodySolids={visibleSolids}
          bodySolidsWireframe={wireframe}
          investigationXY={investigationXY}
          onExitSplit={exitSplit}
          footprintRing={footprintRing}
          compareScene={geotechCompareScene}
          onEnterCompare={enterCompare}
        />
      </div>
    )
  }

  return (
    <EmptyState
      icon={<Layers3 />}
      title={t('litho.modelFull')}
      hint={t('litho.emptyCanvas')}
    />
  )
}
