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
// top-level 2D/3D pill switches between them here. Everything 3D mirrors
// LithologyCanvas verbatim with the geotech data swapped in:
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

import * as Cesium from 'cesium'
import { useEffect, useMemo, useState } from 'react'
import { Box, Grid3x3, Layers, Loader2, Network } from 'lucide-react'

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
import SectionsCanvas from '../sections/SectionsCanvas'
import {
  buildProjectFence,
  type FenceSectionInput,
} from '../../../utils/buildProjectFence'
import { assembleLithoSectionInputs } from '../../../utils/assembleLithoSectionInputs'
import { buildVoxelRequest, type VoxelBuildRequest } from '../../../utils/buildVoxelRequest'
import { nadColoredFormations } from '../../../utils/nadClasses'
import { readLithoSegmenterPrefs } from '../../../utils/lithoSegmenterPrefs'
import { log } from '../../../utils/log'

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

// Stable empty surfaces map — always passed to Geology3DViewer on the geotech
// pane so TIN sheets are never rendered there (mirrors LithologyCanvas). The
// Surfaces legend toggle + draw loop are gated on the map having vertices, so
// an empty map suppresses both without touching the shared viewer.
const EMPTY_SURFACES_MAP: ReadonlyMap<string, never> = new Map<string, never>()

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
      activeGeotechModel,
      geotechFormations,
      geotechLayers,
      geotechSolids,
      hasGeotechSolids,
      geotechHideMarkers,
    },
    overlays: { showConfidenceFade },
    visibleCpts,
    visibleBoreholes,
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

  // 3D view sub-mode (Solid / Fence) + wireframe — mirror LithologyCanvas.
  const [viewMode, setViewMode] = useState<'solid' | 'fence'>('solid')
  const [wireframe, setWireframe] = useState(false)
  const [fenceLoading, setFenceLoading] = useState(false)

  // Split-viewport state — session-ephemeral.
  const [splitMode, setSplitMode] = useState<SplitMode>('single')
  const [splitPlane, setSplitPlane] = useState<Cesium.Plane | null>(null)
  const [splitLine, setSplitLine] = useState<SplitLine | null>(null)

  function handleSplitPlaneDrawn(plane: Cesium.Plane, line: SplitLine): void {
    setSplitPlane(plane)
    setSplitLine(line)
    setSplitMode('split')
  }

  resetGeotechSplitViewportCallback.current = () => {
    setSplitMode('single')
    setSplitPlane(null)
    setSplitLine(null)
  }

  // -------------------------------------------------------------------------
  // Marker-filtered solids — MUST be useMemo'd (an inline filter would re-create
  // the array every render and thrash Geology3DViewer's primitive-rebuild effect).
  // -------------------------------------------------------------------------
  const visibleSolids = useMemo(
    () => (geotechHideMarkers ? geotechSolids.filter(s => s.is_flagged !== true) : geotechSolids),
    [geotechSolids, geotechHideMarkers],
  )

  const projectId = project?.id ?? null
  const geotechModelId = activeGeotechModel?.id ?? null

  // -------------------------------------------------------------------------
  // Ground-surface TIN scoped to the active geotech model. Fire-and-forget,
  // session-local. Null when no geotech model or DEM unavailable.
  // -------------------------------------------------------------------------
  const [groundSurface, setGroundSurface] = useState<GroundSurfaceBuildResponse | null>(null)

  useEffect(() => {
    if (!projectId || !geotechModelId) {
      setGroundSurface(null)
      return
    }
    let cancelled = false
    api.geology
      .buildGroundSurface(projectId, geotechModelId)
      .then(result => {
        if (!cancelled) setGroundSurface(result)
      })
      .catch(() => {
        if (!cancelled) setGroundSurface(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, geotechModelId])

  // -------------------------------------------------------------------------
  // Per-section geotech correlation edges — fetched lazily when Fence mode is
  // active (mirrors LithologyCanvas; edges are section-scoped). Off the geotech
  // model id, never the litho model.
  // -------------------------------------------------------------------------
  const [edgesBySectionId, setEdgesBySectionId] = useState<
    Map<string, LithoContactCorrelationEdge[]>
  >(new Map())

  useEffect(() => {
    if (!projectId || !geotechModelId || dimension !== '3d' || viewMode !== 'fence') {
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
          .listContactCorrelations(projectId, geotechModelId, section.id)
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
      setFenceLoading(false)
    }
  }, [projectId, geotechModelId, dimension, viewMode, visibleSections])

  // Null the voxel-build ref on unmount so a stale async callback cannot fire
  // after the canvas unmounts (mirrors LithologyCanvas).
  useEffect(() => () => {
    geotechVoxelRequestCallback.current = null
  }, [])

  // -------------------------------------------------------------------------
  // Investigations + projected positions (shared by fence + voxel + fade).
  // -------------------------------------------------------------------------
  const investigations = useMemo(
    () => [
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
    ],
    [visibleCpts, visibleBoreholes],
  )

  const investigationXY = useMemo<[number, number][]>(
    () => investigations.map(i => [i.location_x, i.location_y]),
    [investigations],
  )

  // Approved geotech edges per section — the partition/fence classifier only
  // consumes user-approved edges.
  const approvedEdgesBySectionId = useMemo(() => {
    const out = new Map<string, { a: string; b: string }[]>()
    for (const [sectionId, edges] of edgesBySectionId) {
      out.set(
        sectionId,
        edges.filter(e => e.user_approved).map(e => ({ a: e.contact_a_id, b: e.contact_b_id })),
      )
    }
    return out
  }, [edgesBySectionId])

  const fenceSectionInputs = useMemo<FenceSectionInput[]>(() => {
    if (dimension !== '3d' || viewMode !== 'fence') return []
    if (!geotechModelId) return []
    return assembleLithoSectionInputs({
      visibleSections,
      investigations,
      // GEOTECH layers (litho_layer rows on the geotech model) feed the SAME
      // model-agnostic assembler — verified by assembleLithoSectionInputs.test.ts.
      lithoLayers: geotechLayers,
      edgesBySectionId: approvedEdgesBySectionId,
    })
  }, [
    dimension,
    viewMode,
    geotechModelId,
    visibleSections,
    investigations,
    geotechLayers,
    approvedEdgesBySectionId,
  ])

  const fencePanels = useMemo(
    () =>
      dimension === '3d' && viewMode === 'fence' ? buildProjectFence(fenceSectionInputs) : undefined,
    [dimension, viewMode, fenceSectionInputs],
  )

  // -------------------------------------------------------------------------
  // Voxel build payload — assembled on demand for the "Build model" toolbar
  // button (module-ref bridge). Assigned every render while the canvas is
  // mounted (in BOTH 2D and 3D mode) so Build works regardless of which view is
  // showing. Returns null when there is no geotech model or no section.
  // -------------------------------------------------------------------------
  geotechVoxelRequestCallback.current = async (): Promise<VoxelBuildRequest | null> => {
    if (!projectId || !geotechModelId || visibleSections.length === 0) return null

    const failedSectionIds: string[] = []
    const edgeResults = await Promise.all(
      visibleSections.map(section =>
        api.geology
          .listContactCorrelations(projectId, geotechModelId, section.id)
          .then(
            edges =>
              [
                section.id,
                edges
                  .filter(e => e.user_approved)
                  .map(e => ({ a: e.contact_a_id, b: e.contact_b_id })),
              ] as const,
          )
          .catch(() => {
            failedSectionIds.push(section.id)
            return [section.id, [] as { a: string; b: string }[]] as const
          }),
      ),
    )
    const edgesMap = new Map(edgeResults)
    const totalApprovedEdges = edgeResults.reduce((sum, [, edges]) => sum + edges.length, 0)
    log.debug(
      'geotech-voxel',
      `assembled ${edgeResults.length} sections, ${totalApprovedEdges} approved geotech edges` +
        (failedSectionIds.length > 0
          ? `; ${failedSectionIds.length} section(s) failed → empty: ${failedSectionIds.join(', ')}`
          : ''),
    )

    const sectionInputs = assembleLithoSectionInputs({
      visibleSections,
      investigations,
      lithoLayers: geotechLayers,
      edgesBySectionId: edgesMap,
    })

    const { voxelHorizontalSpacingM, voxelVerticalSpacingM } = readLithoSegmenterPrefs(
      project?.view_state,
    )
    return buildVoxelRequest(sectionInputs, voxelHorizontalSpacingM, voxelVerticalSpacingM)
  }

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
          {/* Fence / Solid + Wireframe view cluster — bottom-left overlay,
              mirrors LithologyCanvas. */}
          <div
            className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5"
            title="Switch between solid body model and fence-diagram walls"
          >
            <span className="text-[10px] text-text-secondary select-none leading-none">View</span>
            <div className="flex rounded overflow-hidden border border-border-default shadow-sm">
              <button
                type="button"
                data-testid="geotech-view-mode-solid"
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
                data-testid="geotech-view-mode-fence"
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
                {fenceLoading && <Loader2 size={11} className="animate-spin" />}
                Fence
              </button>
            </div>

            {viewMode === 'solid' && (
              <button
                type="button"
                data-testid="geotech-view-wireframe"
                aria-pressed={wireframe}
                title="Show the body model as wireframe"
                onClick={() => setWireframe(w => !w)}
                className={[
                  'px-3 py-1 text-xs font-medium transition-colors inline-flex items-center gap-1 rounded border border-border-default shadow-sm',
                  wireframe
                    ? 'bg-accent text-white'
                    : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
                ].join(' ')}
              >
                <Grid3x3 size={11} />
                Wireframe
              </button>
            )}
          </div>

          {/* Empty-fence hint — fence mode, fetch complete, no panels. */}
          {viewMode === 'fence' &&
            !fenceLoading &&
            fencePanels !== undefined &&
            fencePanels.length === 0 && (
              <div
                data-testid="geotech-fence-empty-hint"
                className="absolute top-10 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] pointer-events-none"
                style={{
                  color: 'var(--section-hint-text)',
                  background: 'var(--section-hint-bg)',
                }}
              >
                <Network size={12} />
                No fence panels — connect packing bands in the 2D view
              </div>
            )}

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
            onExitSplit={() => {
              setSplitMode('single')
              setSplitPlane(null)
              setSplitLine(null)
            }}
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
