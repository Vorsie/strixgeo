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
//
// Design:
//   • When hasLithoSolids is true, render the existing Geology3DViewer.
//     Its props are generic — pass lithoFormations + EMPTY_SURFACES_MAP.
//     Geology3DViewer.tsx is NOT modified.
//   • Split-viewport mirrors GeologyCanvas exactly: local splitMode /
//     splitPlane / splitLine state; resetLithoSplitViewportCallback exposed
//     for LithologyStage's Reset toolbar button.
//   • Ground surface: api.geology.buildGroundSurface(projectId, modelId)
//     scoped to the litho model id (model-id-agnostic call).
//   • resetLithoCameraCallback: module-level ref shared with LithologyStage's
//     Reset Camera toolbar button — same pattern as GeologyCanvas.
//   • viewMode ('solid' | 'fence'): session-ephemeral.  In Solid mode the
//     per-body watertight solids are rendered (TIN sheets always suppressed).
//     In Fence mode the whole-project partition fill is projected to
//     world-space panels and passed to Geology3DViewer via fencePanels.
//
// Solid mode (canvas responsibility):
//   • EMPTY_SURFACES_MAP: stable module-level empty Map always passed to
//     Geology3DViewer as surfacesByFormationId — suppresses the Surfaces
//     legend toggle and TIN sheet rendering on the litho pane.
//   • hasLithoSolids / lithoSolids come from useShell().geoModel (no local
//     state); the canvas just reads + forwards to the viewer.

import * as Cesium from 'cesium'
import { useEffect, useMemo, useState } from 'react'
import { Layers3, Loader2, Network } from 'lucide-react'

import { api } from '../../../api/client'
import type {
  GroundSurfaceBuildResponse,
  LithoContactCorrelationEdge,
} from '../../../api/client'
import { useShell } from '../../ShellContext'
import { EmptyState } from '../../EmptyState'
import Geology3DViewer, {
  type SplitMode,
  type SplitLine,
} from '../geology/Geology3DViewer'
import { investigationsOnSection } from '../../../utils/sectionProjection'
import {
  buildProjectFence,
  type FenceSectionInput,
} from '../../../utils/buildProjectFence'
import type { FenceProjectedColumn, FenceLayerInput } from '../../../utils/sectionFenceData'
import { log } from '../../../utils/log'

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

// ---------------------------------------------------------------------------
// Stable empty surfaces map — always passed to Geology3DViewer on the litho
// pane so TIN sheets are never rendered there.  The Surfaces legend toggle
// and draw loop in Geology3DViewer are both gated on the map having vertices,
// so an empty map suppresses both without touching the shared viewer.  The
// geology pane passes its own real surfaces map and is unaffected.
// Module-level so the reference is identity-stable across renders.
// ---------------------------------------------------------------------------

const EMPTY_SURFACES_MAP: ReadonlyMap<string, never> = new Map<string, never>()

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
 * Split-viewport mode mirrors ``GeologyCanvas`` exactly.  ``splitMode``,
 * ``splitPlane`` and ``splitLine`` are local session-ephemeral state; the
 * user draws the split line in the 3D scene via the ``Geology3DViewer``
 * "Split model" button.  ``resetLithoSplitViewportCallback`` is populated
 * here so ``LithologyStage``'s toolbar Reset verb can collapse the split.
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
    },
    overlays: { showConfidenceFade },
    visibleCpts,
    visibleBoreholes,
    sections: { visibleSections },
  } = useShell()

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

  // ---------------------------------------------------------------------------
  // Fence / Solid view toggle — session-ephemeral, not persisted to the bundle.
  // ---------------------------------------------------------------------------

  const [viewMode, setViewMode] = useState<'solid' | 'fence'>('solid')

  // True while the per-section edge fetches are in flight (Fence mode only).
  // Drives the loading spinner on the Fence button and the disabled state of
  // both toggle buttons so the user cannot switch during an in-flight fetch.
  const [fenceLoading, setFenceLoading] = useState(false)

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

  // ---------------------------------------------------------------------------
  // Per-section correlation edges — fetched lazily when Fence mode is active.
  //
  // WHY: edges are section-scoped (each edge row carries a section_id — owner
  // directive 2026-06-08).  We fetch each section's edges in parallel so the
  // fence build gets only the edges authored on that section.  The fetch fires
  // whenever viewMode switches to 'fence', the litho model changes, or the
  // section list changes.  When viewMode is 'solid' the effect early-returns
  // immediately (guarded by `viewMode !== 'fence'` at the top of the effect),
  // so no fetch fires in Solid mode.
  // ---------------------------------------------------------------------------

  const [edgesBySectionId, setEdgesBySectionId] = useState<
    Map<string, LithoContactCorrelationEdge[]>
  >(new Map())

  useEffect(() => {
    if (!projectId || !lithoModelId || viewMode !== 'fence') {
      return
    }
    if (visibleSections.length === 0) {
      setEdgesBySectionId(new Map())
      return
    }
    let cancelled = false

    setFenceLoading(true)
    Promise.all(
      visibleSections.map(section =>
        api.geology
          .listContactCorrelations(projectId, lithoModelId, section.id)
          .then(edges => [section.id, edges] as const)
          .catch(() => [section.id, [] as LithoContactCorrelationEdge[]] as const),
      ),
    ).then(results => {
      if (cancelled) return
      setEdgesBySectionId(new Map(results))
      setFenceLoading(false)
    })

    return () => {
      cancelled = true
      // Clear the loading flag on cleanup so a stale fetch never leaves
      // the buttons permanently disabled when the effect re-fires.
      setFenceLoading(false)
    }
  }, [projectId, lithoModelId, viewMode, visibleSections])

  // ---------------------------------------------------------------------------
  // Fence inputs — assembled from shell-bus data + fetched edges.
  //
  // lithoLayers already live on the geoModel bus (loaded by useGeologicalModel
  // for the Sections stage); no extra fetch is needed.  Each layer is mapped
  // to a FenceLayerInput keyed by investigationId = cpt_id ?? borehole_id.
  // ---------------------------------------------------------------------------

  const fenceSectionInputs = useMemo<FenceSectionInput[]>(() => {
    if (viewMode !== 'fence') return []
    if (!lithoModelId) return []

    const allItems = [
      ...visibleCpts.map(c => ({
        id: c.id,
        location_x: c.location_x,
        location_y: c.location_y,
        elevation_m: c.elevation_m,
      })),
      ...visibleBoreholes.map(b => ({
        id: b.id,
        location_x: b.location_x,
        location_y: b.location_y,
        elevation_m: b.elevation_m,
      })),
    ]

    // Skip layers that carry neither a cpt_id nor a borehole_id — they have
    // no investigation anchor and cannot be projected onto a section column.
    const layerInputs: FenceLayerInput[] = lithoLayers.flatMap(layer => {
      const invId = layer.cpt_id ?? layer.borehole_id
      if (!invId) return []
      return [
        {
          investigationId: invId,
          layerId: layer.id,
          formationId: layer.formation_id,
          bodyId: layer.body_id ?? null,
          topDepthM: layer.depth_top_m,
          baseDepthM: layer.depth_base_m,
          accepted: layer.status === 'accepted',
        },
      ]
    })

    return visibleSections.map<FenceSectionInput>(section => {
      const excludedIds = new Set([
        ...(section.excluded_cpt_ids ?? []),
        ...(section.excluded_borehole_ids ?? []),
      ])
      const projected = investigationsOnSection(section, allItems, excludedIds)

      const projectedColumns: FenceProjectedColumn[] = projected.map(p => ({
        investigationId: p.item.id,
        alongM: p.along,
        surfaceElevM: p.item.elevation_m,
      }))

      const rawEdges = edgesBySectionId.get(section.id) ?? []
      // Only approved edges drive the band/onlap/lens classification.
      const edges = rawEdges
        .filter(e => e.user_approved)
        .map(e => ({ a: e.contact_a_id, b: e.contact_b_id }))

      return {
        section: {
          start_x: section.start_x,
          start_y: section.start_y,
          end_x: section.end_x,
          end_y: section.end_y,
        },
        projectedColumns,
        layers: layerInputs,
        edges,
      }
    })
  }, [viewMode, lithoModelId, visibleCpts, visibleBoreholes, visibleSections, lithoLayers, edgesBySectionId])

  // ---------------------------------------------------------------------------
  // Fence panels — built only in Fence mode to avoid the CPU cost in Solid mode.
  // ---------------------------------------------------------------------------

  const fencePanels = useMemo(
    () => (viewMode === 'fence' ? buildProjectFence(fenceSectionInputs) : undefined),
    [viewMode, fenceSectionInputs],
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

        {/* Fence / Solid view toggle — bottom-left overlay.
            Positioned bottom-2 left-2 z-20 to stay CLEAR of the Layers
            legend (top-2 left-2 z-10) and the BasemapPanel (top-2 right-2)
            that Geology3DViewer paints.  z-20 wins over any z-10 children
            the viewer renders (Cesium attribution bar is centred, not
            bottom-left, so there is no collision there either).
            title= on the wrapper makes the view-mode concept discoverable
            via browser tooltip (Fix D). */}
        <div
          className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5"
          title="Switch between solid TIN surfaces and fence-diagram walls"
        >
          {/* Small "View" label so first-time users read this as a view-mode
              switch rather than an action button (Fix D). */}
          <span className="text-[10px] text-text-secondary select-none leading-none">View</span>
          <div className="flex rounded overflow-hidden border border-border-default shadow-sm">
            <button
              type="button"
              data-testid="litho-view-mode-solid"
              aria-pressed={viewMode === 'solid'}
              disabled={fenceLoading}
              onClick={() => setViewMode('solid')}
              className={[
                'px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                viewMode === 'solid'
                  ? 'bg-accent text-white'
                  : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
              ].join(' ')}
            >
              Solid
            </button>
            <button
              type="button"
              data-testid="litho-view-mode-fence"
              aria-pressed={viewMode === 'fence'}
              disabled={fenceLoading}
              onClick={() => setViewMode('fence')}
              className={[
                'px-3 py-1 text-xs font-medium transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed',
                viewMode === 'fence'
                  ? 'bg-accent text-white'
                  : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
              ].join(' ')}
            >
              {/* Spinner replaces nothing — it sits beside the label so the
                  button width stays stable and the label stays readable. */}
              {fenceLoading && <Loader2 size={11} className="animate-spin" />}
              Fence
            </button>
          </div>
        </div>

        {/* Empty-fence hint pill (Fix C) — rendered only when Fence mode is
            active, the edge fetch has completed (not loading), and no panels
            were produced. Positioned top-centre so it clears the Layers
            legend (top-2 left-2) and the BasemapPanel (top-2 right-2). */}
        {viewMode === 'fence' && !fenceLoading && fencePanels !== undefined && fencePanels.length === 0 && (
          <div
            data-testid="fence-empty-hint"
            className="absolute top-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] pointer-events-none"
            style={{
              color: 'var(--section-hint-text)',
              background: 'var(--section-hint-bg)',
            }}
          >
            <Network size={12} />
            No fence panels — accept correlations in the Sections stage
          </div>
        )}

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
          onExitSplit={() => {
            setSplitMode('single')
            setSplitPlane(null)
            setSplitLine(null)
          }}
        />
      </div>
    )
  }

  return (
    <EmptyState
      icon={<Layers3 />}
      title="Lithostratigraphic model"
      hint="Select or create a lithology model in the right panel. Draw contacts in the Sections stage, then click Build model on the Lithology toolbar to generate the 3D solid bodies."
    />
  )
}
