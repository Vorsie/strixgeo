// Lithology stage canvas — 3D surface viewer for built litho TINs,
// or a guided EmptyState when none exist yet.
//
// Slice D of #55 litho peer-stage scaffolding. Split-viewport added 2026-06-01
// (resolves debt #64).
// Fence/Solid toggle added 2026-06-10 (Task 6, Litho 3D fence diagram).
// Solid-mode solid fetch + Build + per-body colour picker added 2026-06-10
// (Task 8, Litho 3D milestone 2).
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
//   • viewMode ('solid' | 'fence'): session-ephemeral.  In Solid mode the
//     TIN surfaces render (today's behaviour) when no solids are built, and
//     the per-body watertight solids render (with TIN sheets suppressed) when
//     solids exist.  In Fence mode the whole-project partition fill is
//     projected to world-space panels and passed to Geology3DViewer via
//     fencePanels.  Both viewers get the same fencePanels value; in Solid
//     mode it is undefined so nothing changes.
//
// Solid mode details (Task 8):
//   • solidsRefetchNonce: bumped after Build to trigger re-fetch.
//   • EMPTY_SURFACES_MAP: stable module-level empty Map passed to
//     Geology3DViewer as surfacesByFormationId in Solid mode when solids
//     exist — suppresses TIN sheets so the opaque solids read cleanly.
//   • Build button: overlay top-left (clears the Fence/Solid toggle at
//     bottom-left); amber badge when any solid is_stale.  Mirrors
//     GeologyToolbar's Build 3D model idiom.
//   • Colour picker: legend list in the solid-mode overlay; each row shows
//     a colour swatch + an <input type="color">.  Reversible (fire immediately,
//     Reset to null falls back to formation colour).

import * as Cesium from 'cesium'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Layers3, Loader2, Network, RefreshCw, RotateCcw } from 'lucide-react'

import { api } from '../../../api/client'
import type {
  GeologicalFormationResponse,
  GroundSurfaceBuildResponse,
  LithoBodySolidResponse,
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
import { formatLithoDisplayName } from '../../../utils/lithoLabels'
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
// Stable empty surfaces map — passed to Geology3DViewer in Solid mode when
// solids are present so TIN sheets are suppressed.  Module-level so the
// reference is identity-stable across renders (no useMemo needed for this one).
// ---------------------------------------------------------------------------

const EMPTY_SURFACES_MAP: ReadonlyMap<string, never> = new Map<string, never>()

// ---------------------------------------------------------------------------
// LithologyCanvas
// ---------------------------------------------------------------------------

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
 * Fence/Solid toggle: ``viewMode`` switches between the TIN-surface render
 * (Solid) and the whole-project partition fill projected to fence panels
 * (Fence).  The fence build uses ``lithoLayers`` from the shell bus (no
 * extra fetch), ``visibleCpts``/``visibleBoreholes`` for investigation
 * coordinates, ``visibleSections`` for section geometry, and per-section
 * correlation edges fetched lazily when Fence mode is activated.
 *
 * In Solid mode, if at least one litho body solid has been built
 * (``api.geology.listLithoSolids``), the TIN sheets are suppressed and the
 * opaque closed solids are rendered instead.  A Build Solids button (with
 * an amber stale badge) and a per-body colour-picker legend are rendered as
 * overlays in the viewer container.
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
      lithoLayers,
    },
    overlays: { showConfidenceFade },
    visibleCpts,
    visibleBoreholes,
    sections: { visibleSections },
    toasts: { toast },
  } = useShell()

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
  // Litho body solids — fetched lazily when Solid mode is active.
  //
  // solidsRefetchNonce: incremented after a successful Build so the effect
  // re-runs and the viewer picks up the freshly built solids.
  // Keyed on viewMode so switching FROM fence TO solid re-fetches (solids may
  // have been built while the user was in fence mode).
  // ---------------------------------------------------------------------------

  const [solids, setSolids] = useState<LithoBodySolidResponse[]>([])
  const [solidsRefetchNonce, setSolidsRefetchNonce] = useState(0)
  const [solidsLoading, setSolidsLoading] = useState(false)
  const [solidsBuilding, setSolidsBuilding] = useState(false)

  useEffect(() => {
    if (!projectId || !lithoModelId || viewMode !== 'solid') {
      return
    }
    let cancelled = false

    log.debug('litho-canvas', `fetching body solids model=${lithoModelId} nonce=${solidsRefetchNonce}`)
    setSolidsLoading(true)

    api.geology
      .listLithoSolids(projectId, lithoModelId)
      .then(result => {
        if (cancelled) return
        log.info('litho-canvas', `fetched ${result.length} body solid(s)`)
        setSolids(result)
      })
      .catch(err => {
        if (cancelled) return
        log.error('litho-canvas', 'failed to fetch body solids', err)
        setSolids([])
      })
      .finally(() => {
        if (!cancelled) setSolidsLoading(false)
      })

    return () => {
      cancelled = true
      setSolidsLoading(false)
    }
    // viewMode included so switching back to Solid re-fetches.
    // solidsRefetchNonce bumped by Build to force re-fetch.
  }, [projectId, lithoModelId, viewMode, solidsRefetchNonce])

  // Build handler — calls rebuildLithoSolids, updates solids in-place from
  // the response (no second fetch needed), toasts the outcome.
  const handleBuildSolids = useCallback(async (): Promise<void> => {
    if (!projectId || !lithoModelId || solidsBuilding) return
    setSolidsBuilding(true)
    log.info('litho-canvas', `building body solids model=${lithoModelId}`)
    try {
      const result = await api.geology.rebuildLithoSolids(projectId, lithoModelId)
      log.success('litho-canvas', `built ${result.bodies_built} body solid(s), flagged=${result.bodies_flagged}`)
      setSolids(result.solids)
      // Bump nonce so any other consumer (future) also re-fetches; the state
      // is already set above so this is a no-op for the current effect.
      setSolidsRefetchNonce(n => n + 1)

      const builtMsg = `Built ${result.bodies_built} bod${result.bodies_built === 1 ? 'y' : 'ies'}`
      if (result.bodies_flagged > 0) {
        toast(
          'warning',
          `${builtMsg} — ${result.bodies_flagged} under-constrained bod${result.bodies_flagged === 1 ? 'y' : 'ies'} (fewer than 3 CPT/borehole traces — slab approximation)`,
        )
      } else {
        toast('success', builtMsg)
      }
    } catch (err) {
      log.error('litho-canvas', 'build solids failed', err)
      toast('error', 'Could not build body solids — check the connection.')
    } finally {
      setSolidsBuilding(false)
    }
  }, [projectId, lithoModelId, solidsBuilding, toast])

  // Per-body colour change handler — fires immediately (reversible action).
  // null resets to the formation's lithology colour.
  const colorChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleBodyColorChange = useCallback(
    (bodyId: string, color: string | null): void => {
      if (!projectId || !lithoModelId) return

      // Optimistic update — reflect the colour change immediately in the UI
      // without waiting for the server round-trip.
      setSolids(prev =>
        prev.map(s => (s.body_id === bodyId ? { ...s, display_color: color } : s)),
      )

      // Debounce rapid colour-wheel drags — send only the final colour.
      if (colorChangeTimeoutRef.current !== null) {
        clearTimeout(colorChangeTimeoutRef.current)
      }
      colorChangeTimeoutRef.current = setTimeout(() => {
        colorChangeTimeoutRef.current = null
        log.debug('litho-canvas', `setting body colour body=${bodyId} color=${color ?? 'null'}`)
        api.geology
          .setBodyColor(projectId, lithoModelId, bodyId, color)
          .then(() => {
            log.success('litho-canvas', `body colour persisted body=${bodyId}`)
            // Bump nonce so the effect re-fetches if the viewer is remounted.
            setSolidsRefetchNonce(n => n + 1)
          })
          .catch(err => {
            log.error('litho-canvas', 'failed to persist body colour', err)
            toast('error', 'Could not save body colour — try again.')
            // Re-fetch to restore server state on failure.
            setSolidsRefetchNonce(n => n + 1)
          })
      }, 200)
    },
    [projectId, lithoModelId, toast],
  )

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
  // hasSolids: true when at least one solid with triangles exists — used to
  // decide whether to suppress TIN sheets and show the Build badge/legend.
  //
  // hasStaleSolid: amber badge trigger — any solid with is_stale === true.
  //
  // surfacesMapForViewer: in Solid mode when solids are present, pass the
  // stable EMPTY_SURFACES_MAP so TIN sheets are not rendered (the opaque
  // closed solids replace them).  In all other cases pass the real map.
  // ---------------------------------------------------------------------------

  const hasSolids = solids.some(s => s.triangles.length > 0)
  const hasStaleSolid = solids.some(s => s.is_stale === true)

  const surfacesMapForViewer = viewMode === 'solid' && hasSolids
    ? EMPTY_SURFACES_MAP
    : lithoSurfacesByFormationId

  // Formation lookup map for the colour-picker legend — keyed by formation id.
  const formationById = useMemo<Map<string, GeologicalFormationResponse>>(() => {
    const m = new Map<string, GeologicalFormationResponse>()
    for (const f of lithoFormations) m.set(f.id, f)
    return m
  }, [lithoFormations])

  // Show the 3D viewer when at least one litho surface has vertices.
  // Stale surfaces are included (Geology3DViewer renders them at lower alpha).
  const hasLithoSurfaces = Array.from(lithoSurfacesByFormationId.values()).some(
    s => s.vertices.length > 0,
  )

  const projectEpsg = project.default_horizontal_epsg ?? 31370

  if (hasLithoSurfaces) {
    return (
      <div className="relative w-full h-full">
        {/* Build Solids button — top-right overlay, Solid mode only.
            Mirrors GeologyToolbar's Build 3D model pattern: amber tint when
            any solid is stale, spinner while building, toast on completion.
            Positioned top-8 right-2 z-20: stacked directly below the
            BasemapPanel button (absolute top-2 right-2 z-10 inside
            Geology3DViewer) so they share the right column without any
            overlap, regardless of which basemap label is showing. */}
        {viewMode === 'solid' && (
          <div className="absolute top-8 right-2 z-20 flex items-center gap-1.5">
            <button
              type="button"
              data-testid="litho-build-solids-button"
              disabled={solidsBuilding || !lithoModelId}
              onClick={() => void handleBuildSolids()}
              title={
                solidsBuilding
                  ? 'Building body solids…'
                  : hasStaleSolid
                    ? 'One or more body solids are stale — click to rebuild'
                    : 'Build watertight closed body solids from accepted contacts'
              }
              className={[
                'inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                'shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                solidsBuilding
                  ? 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary'
                  : hasStaleSolid
                    ? 'bg-amber-500/90 text-white hover:bg-amber-600/90 backdrop-blur-sm'
                    : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
              ].join(' ')}
            >
              {solidsBuilding
                ? <Loader2 size={11} className="animate-spin" />
                : <RefreshCw size={11} className={solidsBuilding ? 'animate-spin' : ''} />}
              {solidsBuilding
                ? 'Building…'
                : hasStaleSolid
                  ? 'Build solids · stale'
                  : 'Build solids'}
            </button>
          </div>
        )}

        {/* Per-body colour-picker legend — Solid mode only, rendered when
            solids are present.  Top-left, positioned to clear the viewer's
            own Layers panel header (absolute top-2 left-2 z-10 inside
            Geology3DViewer).  Each row: colour swatch input + formation name
            + per-row stale dot + Reset button + flagged glyph.
            Reversible action — fire immediately, no confirm dialog. */}
        {viewMode === 'solid' && hasSolids && (
          <div
            data-testid="litho-solid-legend"
            className="absolute top-10 left-2 z-20 flex flex-col gap-0.5 max-h-[calc(100%-6rem)] overflow-y-auto"
          >
            {/* C1 — section header styled to match the viewer's "Layers" header
                (text-[10px] uppercase tracking-wide text-text-muted, px-2 py-1). */}
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">
              Body solids
            </div>
            {solids
              .filter(s => s.triangles.length > 0)
              .map(solid => {
                const formation = formationById.get(solid.formation_id)
                // Resolved display colour: per-body override wins, then formation fallback.
                const resolvedColor = solid.display_color ?? formation?.color ?? '#888888'
                const displayName = formation
                  ? (formation.litho_main_soil_code != null
                      ? formatLithoDisplayName(formation.litho_main_soil_code, formation.litho_admixtures)
                      : formation.name)
                  : solid.formation_id

                return (
                  <div
                    key={solid.id}
                    data-testid={`solid-legend-row-${solid.body_id}`}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-overlay/80 backdrop-blur-sm text-xs text-text-secondary"
                  >
                    {/* Colour input — click to open native colour picker. */}
                    <input
                      type="color"
                      data-testid={`solid-color-input-${solid.body_id}`}
                      value={resolvedColor.startsWith('#') ? resolvedColor : `#${resolvedColor}`}
                      onChange={e => handleBodyColorChange(solid.body_id, e.target.value)}
                      title="Pick a custom colour for this body solid"
                      className="w-5 h-5 p-0 border border-border-subtle rounded cursor-pointer"
                      aria-label={`Colour for ${displayName}`}
                    />
                    <span className="flex-1 truncate max-w-[8rem]" title={displayName}>
                      {displayName}
                    </span>
                    {/* S4 — per-row stale indicator. Dirty-marker convention:
                        amber-500, never red. Title explains the action needed. */}
                    {solid.is_stale === true && (
                      <span
                        className="text-amber-500 leading-none"
                        title="Stale — rebuild to update"
                        aria-label="Stale"
                      >
                        •
                      </span>
                    )}
                    {/* S2 — Reset to formation colour. p-1 -m-1 grows the hit
                        target to ~20 px without shifting layout. */}
                    {solid.display_color != null && (
                      <button
                        type="button"
                        data-testid={`solid-color-reset-${solid.body_id}`}
                        onClick={() => handleBodyColorChange(solid.body_id, null)}
                        title="Reset to formation lithology colour"
                        className="p-1 -m-1 text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <RotateCcw size={10} />
                      </button>
                    )}
                    {/* S3 — Flagged indicator: AlertTriangle icon replaces the
                        raw 9px "!" glyph; uses a palette token that works on
                        both light and dark themes. Wrapped in a span so the
                        tooltip (title) is reachable via keyboard / pointer. */}
                    {solid.is_flagged === true && (
                      <span
                        className="shrink-0"
                        title="Under-constrained: fewer than 3 CPT/borehole traces — best-effort slab"
                      >
                        <AlertTriangle size={10} className="text-amber-500" />
                      </span>
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {/* Loading spinner while solids are being fetched for the first time
            (Solid mode, no solids rendered yet). The rebuild case is already
            covered by the Build button's own "Building…" spinner, so this
            only shows on the initial fetch when the legend is empty. */}
        {viewMode === 'solid' && solidsLoading && !hasSolids && (
          <div
            data-testid="solids-loading-indicator"
            className="absolute top-10 left-2 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-overlay/80 backdrop-blur-sm text-xs text-text-muted pointer-events-none"
          >
            <Loader2 size={11} className="animate-spin" />
            Loading solids…
          </div>
        )}

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
          bodySolids={solids}
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
      hint="Select or create a lithology model in the right panel. To place contacts, open the Sections stage and draw them there — once placed and built, the 3D surfaces appear here."
    />
  )
}
