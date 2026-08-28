// Geology 3D viewer — Cesium-based single-viewport and split-viewport viewer
// for TIN formation surfaces.
//
// Build integration notes (completed G5 probe 2026-05-16):
//
//   - Cesium is bundled via Vite ESM import from ``cesium/Source/Cesium.js``.
//     vite-plugin-cesium is NOT used (Windows path.join bug + absolute URL
//     incompatibility with Electron's file:// protocol).
//   - Static assets (Workers, Assets, ThirdParty, Widgets) are copied by
//     ``scripts/copy-cesium.mjs``, chained in the ``build`` npm script.
//   - CESIUM_BASE_URL is injected by the renderer Vite ``define`` +
//     rollupOptions.output.intro so Cesium's buildModuleUrl.js finds workers
//     before any module code runs.
//   - No Cesium ion token — all basemaps come from basemapSources.ts (XYZ/
//     WMTS tile providers). EllipsoidTerrainProvider gives a flat globe.
//
// Split-viewport notes (G6):
//
//   Two CesiumWidget instances are rendered side by side in split mode.
//   Each widget has its own WebGL context, scene, and ScreenSpaceCameraController
//   — camera independence is free. ClippingPlaneCollection clips each scene to
//   the appropriate half of the split plane.
//
//   The split plane is defined by a user-drawn line segment in the 3D scene
//   (two-click flow). It is session-ephemeral: NOT persisted to the .gmproj
//   bundle, NOT tied to the cross-section model, NOT a formation-contact-edit
//   surface. See docs/geology-stage-architecture.md §4.7 for the rationale.
//
// Offline mode:
//
//   Basemap tiles require live network. When offline, the tile providers return
//   404 errors and the globe background is blank (black). The formation surfaces
//   are still rendered correctly. This is documented known degradation —
//   see docs/debt.md item for 3D viewer offline basemap.

import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  GeologicalFormationResponse,
  FormationSurfaceResponse,
  GroundSurfaceBuildResponse,
} from '../../../api/client'
import type { LithoBodySolidResponse } from '../../../api/clients/geology'
import type { BasemapSource, BasemapId } from '../../../utils/basemapSources'
import { BASEMAP_SOURCES, readBasemapId, writeBasemapId } from '../../../utils/basemapSources'
import { useOnlineStatus } from '../../../hooks/useOnlineStatus'
import { projectedToWgs84, wgs84ToProjected } from '../../../hooks/useWgs84'
import { formationsYoungestFirst } from '../../../utils/formationOrder'
import { lithoDisplayName } from '../../../utils/lithoLabels'
import { isGeotechUnit } from '../../../utils/formationKind'
import { useT } from '../../../i18n/translate'
import { useLanguage } from '../../../i18n/languageSelect'
import { buildGeotechLegendTree } from '../../../utils/geotechLegendTree'
import type { FencePanel } from '../../../utils/fencePanels'
import { BasemapPanel } from './BasemapPanel'
import { CesiumViewport } from './CesiumViewport'
import type { ViewportZoomTuning } from './useViewportZoomTuning'
import { GeotechLayersTree } from './GeotechLayersTree'
import { computeSplitPlane, type DrawState, type SplitLine } from './geology3DPrimitives'
import {
  GROUND_SURFACE_LEGEND,
  computeGroundDaylight,
  formatDaylightCaption,
  summariseDaylight,
} from './groundSurfaceLayer'
import { canCompare, type CompareScene, type SplitMode } from '../shared/splitViewport'

// Re-export for existing consumers (useBody3DViewState) — the type moved to
// geology3DPrimitives in the #201 round-2 split.
export type { SplitLine } from './geology3DPrimitives'

// (Cesium.Ion.defaultAccessToken is disabled once, in geology3DPrimitives.ts —
// the module every Cesium consumer here imports.)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// SplitMode moved to shared/splitViewport.ts alongside the transitions that
// produce it; re-exported here so existing importers keep working.
export type { SplitMode } from '../shared/splitViewport'

export interface Geology3DViewerProps {
  /**
   * Per-project "show confidence fade" toggle (debt #94 follow-up).
   * When true (default), low-confidence TIN triangles render at the
   * reduced ``LOW_CONFIDENCE_ALPHA_MULTIPLIER``.  When false the
   * effective multiplier is 1.0 — uniform alpha across high/low.
   */
  showConfidenceFade?: boolean
  /** Single-viewport or split-viewport mode. */
  splitMode: SplitMode
  /**
   * The vertical plane that splits the scene in split mode.
   *
   * ``null`` when ``splitMode === 'single'``.  The plane is defined in
   * ECEF space: normal perpendicular to the drawn line in the horizontal
   * plane, infinite vertical extent.
   */
  splitPlane: Cesium.Plane | null
  /** All formations for the active geological model (sorted by display_order). */
  formations: GeologicalFormationResponse[]
  /** Pre-fetched surface data keyed by formation id. */
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  /**
   * DEM ground-surface TIN built by ``POST .../ground-surface/build``.
   *
   * When provided and non-empty, rendered as an earth-tone semi-transparent
   * mesh below the formation surfaces — the terrain base for the 3D scene.
   * ``null`` / ``undefined`` when the build has not completed yet or the
   * model has no investigations.
   */
  groundSurface?: GroundSurfaceBuildResponse | null
  /**
   * Initial basemap to display.  Optional — when omitted the viewer reads
   * the same localStorage key as ``MapView`` so the two views stay in sync
   * with the user's last explicit pick.  When provided, the viewer uses it
   * as its starting state (useful for controlled testing).
   */
  activeBasemap?: BasemapSource
  /** Project's horizontal CRS EPSG code (31370 Lambert72 or 28992 RD New). */
  projectEpsg: number
  /**
   * Called when the user completes the split-line draw interaction.
   *
   * The viewer emits the computed ``Cesium.Plane`` in ECEF space; the caller
   * stores it and passes it back via ``splitPlane``.
   */
  onSplitPlaneDrawn: (plane: Cesium.Plane, line: SplitLine) => void
  /** The drawn split line in projected CRS, echoed back so the cut-face
   * caps can sample the formations along it. */
  splitLine?: SplitLine | null
  /**
   * Ref populated by the viewer so callers (e.g. GeologyToolbar Reset verb)
   * can trigger a camera fly-to without prop drilling.
   *
   * The ref holds a ``() => void`` callback when the viewer is mounted.
   */
  resetCameraRef: React.MutableRefObject<(() => void) | null>
  /** Collapse the split back to a single viewport (the "Single view"
   * button in the viewer). Owned by GeologyCanvas. */
  onExitSplit?: () => void
  /**
   * Fence-diagram wall panels produced by ``buildFencePanels``.
   *
   * When present and non-empty, each panel is rendered as a vertical coloured
   * wall in the 3D scene, coloured by its formation's colour.  The geology
   * callers do NOT pass this prop (default ``undefined``) so geology behaviour
   * is unchanged; LithologyCanvas passes it when it renders the fence diagram.
   */
  fencePanels?: FencePanel[]
  /**
   * Per-body watertight closed solids built by ``LithoSolidBuilder``.
   *
   * When present and non-empty, each solid is rendered as an OPAQUE CLOSED mesh
   * coloured by ``display_color ?? formation colour``.  A solid whose
   * ``formation_id`` is in ``hiddenFormationIds`` is skipped so the legend toggle
   * works.  Solids with empty ``triangles`` (flagged slabs) are also skipped.
   *
   * The CALLER decides whether to show surfaces alongside solids — this component
   * renders solids unconditionally when provided.  Task 8 will suppress the
   * surface sheets in Solid mode and pass this prop.
   *
   * Do not pass a new array literal on every render — a useState value or a
   * memoized value keeps the reference stable; otherwise the rebuild effect
   * re-runs every render.  The current caller satisfies this via useState.
   */
  bodySolids?: LithoBodySolidResponse[]
  /**
   * When true, the body solids render as WIREFRAME (Cesium LINES of each
   * triangle's three edges) instead of filled faces — the in-app equivalent
   * of the dev viewer's "wireframe" checkbox.  Only the body-solid primitives
   * are affected; formation TIN sheets, fence walls and cut-face caps are
   * unchanged.  Defaults to false (filled). */
  bodySolidsWireframe?: boolean
  /**
   * Investigation (borehole / CPT) positions in project CRS, as ``[x, y]``
   * pairs.  When ``showConfidenceFade`` is on, body solids fade by horizontal
   * distance to the nearest one — opaque on top of data, ghosted where the
   * model is interpolated.  Only meaningful on the litho pane (which passes
   * ``bodySolids``); the geology pane fades its TIN surfaces instead and can
   * omit this. */
  investigationXY?: readonly (readonly [number, number])[]
  /**
   * Closed ring of ``[x_m, y_m, elevation_m]`` marking the model's footprint —
   * the alpha hull the build clipped to, fetched from the backend.
   *
   * Without it a hull-trimmed edge is indistinguishable from a gap the
   * interpretation deliberately left open; with it, "the model ends here"
   * reads as an edge. Drawn in EVERY pane including the compare pane, and
   * never clipped by the cut plane.
   */
  footprintRing?: readonly (readonly number[])[]
  /** Basemap lid alpha override — only the fence cutout sets it (owner
   * ruling B6b, 2026-08-27); omitted keeps the shared default. */
  basemapLidAlpha?: number
  /** Lid-footprint override for fence mode (audit F4) — only the fence
   * cutout passes it, so its orthophoto covers the WHOLE model while the
   * walls stay filtered; omitted, the lid reads ``fencePanels``. */
  lidFootprintPanels?: FencePanel[]
  /** Per-viewport wheel-zoom tuning (audit F5) — only the fence cutout
   * passes it; omitted keeps every Cesium default. */
  zoomTuning?: ViewportZoomTuning
  /**
   * The counterpart model shown in the right-hand pane when
   * ``splitMode === 'compare'`` — the litho model beside the geotech
   * subdivision derived from it, or the reverse.
   *
   * Absent on the geology pane, which has no counterpart. When absent the
   * Compare verb is not offered.
   */
  compareScene?: CompareScene | null
  /** Enter the model comparison (the "Compare" button). Omit to hide it. */
  onEnterCompare?: () => void
  /**
   * Hide every overlay control — basemap picker, layer legend, split /
   * compare buttons and the draw hint — leaving only the scene itself.
   *
   * For PASSIVE embeds (owner ruling R4, 2026-08-27: the Parameters stage's
   * fence cutout is "a visual aid what the user selected" — no verbs, no
   * split). The camera still pans/zooms; ``resetCameraRef`` still works, so
   * the host can offer its own reset. Default ``false`` — the stage canvases
   * keep their chrome untouched.
   */
  chromeless?: boolean
}


// Main component
// ---------------------------------------------------------------------------

/**
 * Cesium-based 3D geological model viewer.
 *
 * Renders TIN formation surfaces in a single viewport (default) or two
 * side-by-side viewports (split mode, G6).  A basemap tile layer is draped
 * on the globe for geographic context.
 *
 * This component is intentionally imperative — Cesium's API is DOM-based
 * and lifecycle-driven.  React state drives the configuration (which
 * formations/surfaces/basemap are active); the Cesium widget is created in
 * ``useEffect`` and mutated in response to state changes.
 *
 * No props are tunnelled from the ``StageDescriptor`` chain — this component
 * is called directly by ``GeologyCanvas`` with explicit props.
 *
 * Parameters
 * ----------
 * splitMode
 *     ``'single'`` or ``'split'``.
 * splitPlane
 *     ECEF plane for split mode; ``null`` in single mode.
 * formations
 *     All geological formations, sorted ascending by ``display_order``.
 * surfacesByFormationId
 *     Pre-fetched surface data keyed by formation id.
 * activeBasemap
 *     Currently active basemap source.
 * projectEpsg
 *     Horizontal CRS EPSG code (31370 or 28992).
 * onSplitPlaneDrawn
 *     Callback emitted when the user completes the split-line draw.
 * resetCameraRef
 *     Ref populated with a fly-to-bounds callback for the GeologyToolbar
 *     Reset verb.
 *
 * Returns
 * -------
 * JSX.Element
 *     The viewer container element.
 */
export default function Geology3DViewer({
  splitMode,
  splitPlane,
  formations,
  surfacesByFormationId,
  activeBasemap: initialBasemap,
  projectEpsg,
  onSplitPlaneDrawn,
  splitLine = null,
  resetCameraRef,
  groundSurface,
  onExitSplit,
  showConfidenceFade = true,
  fencePanels,
  bodySolids,
  bodySolidsWireframe = false,
  investigationXY,
  footprintRing,
  basemapLidAlpha,
  lidFootprintPanels,
  zoomTuning,
  compareScene,
  onEnterCompare,
  chromeless = false,
}: Geology3DViewerProps): JSX.Element {
  const t = useT()
  // Subscribe to the interface language so the legend re-renders — and the
  // domain-label memos below recompute — the instant the Settings toggle flips.
  const lang = useLanguage()
  // Camera link for compare mode: the primary pane leads, the compare pane
  // follows. Refs, not state — the camera moves many times per second and
  // routing it through React would re-render both panes on every mouse move.
  const primaryCameraRef = useRef<Cesium.Camera | null>(null)
  // ---------------------------------------------------------------------------
  // Basemap state — read from localStorage on mount (same key as MapView so
  // the two views share the user's last explicit pick).
  //
  // When ``initialBasemap`` is provided (e.g. in tests), it seeds the state;
  // otherwise the localStorage key is consulted on the lazy initialiser so
  // the viewer starts in sync with MapView's last pick.
  // ---------------------------------------------------------------------------

  const [basemapId, setBasemapId] = useState<BasemapId>(() => {
    if (initialBasemap) return initialBasemap.id
    return readBasemapId(
      typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark'),
    )
  })
  const resolvedBasemap: BasemapSource = useMemo(
    () => BASEMAP_SOURCES.find(b => b.id === basemapId) ?? BASEMAP_SOURCES[0],
    [basemapId],
  )

  function handleBasemapSelect(id: BasemapId): void {
    writeBasemapId(id)
    setBasemapId(id)
  }

  // ---------------------------------------------------------------------------
  // Split-line draw state (G6 — session-ephemeral, not persisted)
  // ---------------------------------------------------------------------------

  const [drawState, setDrawState] = useState<DrawState>({ phase: 'idle' })

  // ---------------------------------------------------------------------------
  // Per-formation 3D visibility (the legend). Session-ephemeral, not
  // persisted — view chrome like the basemap pick. Hiding a formation
  // drops its TIN so the next-deeper formation shows through.
  // ---------------------------------------------------------------------------
  const [hiddenFormationIds, setHiddenFormationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const toggleFormation = useCallback((id: string) => {
    setHiddenFormationIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Bulk variant for the grouped geotech legend: a family / class row hides or
  // shows every formation beneath it in ONE state write (a per-id loop would
  // queue N updates and, worse, read a stale set inside the loop).
  const toggleFormations = useCallback((ids: readonly string[], hide: boolean) => {
    setHiddenFormationIds(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (hide) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Per-BODY 3D visibility — the geotech legend's third level. Session-
  // ephemeral like hiddenFormationIds. Only the solid render honours it (fence
  // walls carry no body identity), which is why it is a separate set rather
  // than more entries in hiddenFormationIds.
  // ---------------------------------------------------------------------------
  const [hiddenBodyIds, setHiddenBodyIds] = useState<ReadonlySet<string>>(() => new Set())
  const toggleBody = useCallback((bodyId: string, hide: boolean) => {
    setHiddenBodyIds(prev => {
      const next = new Set(prev)
      if (hide) next.add(bodyId)
      else next.delete(bodyId)
      return next
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Legend shape. A geotech model subdivides every litho unit into packing
  // classes, so the flat list degenerates into dozens of identical-text rows —
  // it gets the nested soil ▸ class ▸ body tree instead (owner 2026-08-26).
  // The geological + litho panes keep the flat list: their formation names are
  // already distinct, so grouping would only add clicks.
  //
  // ``isGeotechUnit`` (source_litho_formation_id) is the canonical
  // discriminator — a nad_class probe would miss the borehole-only skeletons,
  // whose rows are as real as any other once the scene paints them.
  //
  // ``fencePanels`` is passed straight through: the builder lists only what the
  // CURRENT mode paints (owner ruling 2026-08-26 — "why are there suboptions
  // like this ... not yet classified?"), and in fence mode that is the walls,
  // not the solids the fence render skips. Undefined = solid mode, which is the
  // same signal ``isFenceMode`` below reads.
  // ---------------------------------------------------------------------------
  const geotechLegendTree = useMemo(
    () =>
      formations.some(isGeotechUnit)
        ? buildGeotechLegendTree(formations, bodySolids ?? [], fencePanels)
        : null,
    // ``lang`` is a dep because the tree's labels come from language-aware
    // helpers (``buildGeotechLegendTree`` reads the active language internally);
    // without it the legend would keep its old-language labels after a flip.
    [formations, bodySolids, fencePanels, lang],
  )
  // Basemap on/off (the user toggle). Default on.
  const [basemapEnabled, setBasemapEnabled] = useState(true)
  // DEM ground-surface on/off (the "Ground surface" legend toggle). Default on.
  const [groundSurfaceVisible, setGroundSurfaceVisible] = useState(true)
  // G7 daylight reading — the gap between the DEM ground and the model's
  // interpreted top, summarised for the legend caption (owner ballot
  // 2026-08-26; the H17 affordance: 47/58 tests sit below their collar).
  const daylightCaption = useMemo(() => {
    if (!groundSurface || groundSurface.triangles.length === 0) return null
    const columns = (investigationXY ?? []).map(([x, y]) => ({ x, y }))
    return formatDaylightCaption(
      summariseDaylight(
        computeGroundDaylight(groundSurface, [...surfacesByFormationId.values()], columns),
      ),
    )
  }, [groundSurface, surfacesByFormationId, investigationXY])
  // Formation-surface TIN sheets on/off (the "Surfaces" legend toggle).
  // Default OFF in Fence mode (walls-only) and ON in Solid mode — reset on each
  // mode switch by the effect below; a manual toggle still persists WITHIN a
  // mode (the effect only fires when the mode itself flips). Fence mode is
  // signalled by ``fencePanels`` being defined (undefined = Solid / geology pane).
  const isFenceMode = fencePanels !== undefined
  const [surfacesVisible, setSurfacesVisible] = useState(!isFenceMode)
  useEffect(() => {
    setSurfacesVisible(!isFenceMode)
  }, [isFenceMode])

  // Debt #26: when offline, the basemap "lid" texture fetch fails and
  // the canvas shows formation surfaces against a black globe — users
  // read that as "viewer broken". The banner below explains it's a
  // network issue, not a bug. ``useOnlineStatus`` reacts to
  // ``navigator.onLine`` transitions; the banner only shows when
  // both offline AND the user actually expected to see the basemap.
  const online = useOnlineStatus()
  const showOfflineBanner = !online && basemapEnabled

  // Split-line free-draw is EXPLICIT: armed by the "Split model" button,
  // not always-on. Without this every click in single view tried to
  // start a split (and silently failed on the flat ellipsoid).
  const [splitArmed, setSplitArmed] = useState(false)

  const handleViewportClick = useCallback(
    (cartesian: Cesium.Cartesian3) => {
      if (splitMode !== 'single' || splitPlane !== null) return

      if (drawState.phase === 'idle') {
        setDrawState({ phase: 'first-click', first: cartesian })
        return
      }

      if (drawState.phase === 'first-click') {
        const plane = computeSplitPlane(drawState.first, cartesian)
        setDrawState({ phase: 'idle' })
        if (plane) {
          // Project both ECEF endpoints back to the project CRS so the
          // cut-face caps can sample formation TINs along the line.
          const toProjected = (c: Cesium.Cartesian3): [number, number] => {
            const cg = Cesium.Cartographic.fromCartesian(c)
            return wgs84ToProjected(
              Cesium.Math.toDegrees(cg.latitude),
              Cesium.Math.toDegrees(cg.longitude),
              projectEpsg,
            )
          }
          const [x0, y0] = toProjected(drawState.first)
          const [x1, y1] = toProjected(cartesian)
          onSplitPlaneDrawn(plane, { x0, y0, x1, y1 })
          setSplitArmed(false)
        }
        // Segment too short → stay armed, idle: the user re-clicks.
      }
    },
    [splitMode, splitPlane, drawState, onSplitPlaneDrawn, projectEpsg],
  )

  // Draw mode is active only while explicitly armed (and we're in single
  // view with no plane yet). Clicks are captured only then.
  const isDrawMode =
    splitMode === 'single' && splitPlane === null && splitArmed
  const primaryClickHandler = isDrawMode ? handleViewportClick : undefined

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Both split kinds lay out two half-width panes; only the CUT split clips.
  const isTwoPane = splitMode === 'split' || splitMode === 'compare'
  // A comparison shows both models WHOLE, in BOTH panes. The mode is the
  // authority here, not the plane prop: the state machine already clears the
  // plane on entering compare, but a viewer that renders a half model whenever
  // a caller passes both would put the invariant in the caller's hands, and a
  // half model reads as a modelling gap rather than as a cut.
  const activeClipPlane = splitMode === 'compare' ? null : splitPlane
  const activeSplitLine = splitMode === 'compare' ? null : splitLine
  const canOfferCompare =
    splitMode === 'single' && onEnterCompare !== undefined && canCompare(compareScene)

  return (
    <div className="relative w-full h-full flex">
      {/* Primary (left / only) viewport */}
      <div className={isTwoPane ? 'w-1/2 h-full relative' : 'w-full h-full relative'}>
        <CesiumViewport
          viewportKey="primary"
          formations={formations}
          surfacesByFormationId={surfacesByFormationId}
          activeBasemap={resolvedBasemap}
          projectEpsg={projectEpsg}
          clippingPlane={activeClipPlane}
          invertClip={false}
          splitLine={activeSplitLine}
          cameraResetRef={resetCameraRef}
          onSceneClick={primaryClickHandler}
          groundSurface={groundSurface}
          hiddenFormationIds={hiddenFormationIds}
          hiddenBodyIds={hiddenBodyIds}
          basemapEnabled={basemapEnabled}
          groundSurfaceVisible={groundSurfaceVisible}
          surfacesVisible={surfacesVisible}
          showConfidenceFade={showConfidenceFade}
          fencePanels={fencePanels}
          bodySolids={bodySolids}
          bodySolidsWireframe={bodySolidsWireframe}
          investigationXY={investigationXY}
          footprintRing={footprintRing}
          basemapLidAlpha={basemapLidAlpha}
          lidFootprintPanels={lidFootprintPanels}
          zoomTuning={zoomTuning}
          cameraRef={primaryCameraRef}
        />

        {/* Compare pane caption — names which model the LEFT pane holds, so
            the two halves are never guessed at. Only in compare mode: in
            single / cut view the stage itself names the model. */}
        {splitMode === 'compare' && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-surface-overlay/95 border border-border-default rounded shadow-lg px-2 py-0.5 text-[11px] font-semibold text-text-primary pointer-events-none"
            data-testid="geology3d-compare-label-primary"
          >
            {t('geology.thisModel')}
          </div>
        )}

        {/* Debt #26 offline banner — overlays the primary viewport when
            the browser reports no network connectivity AND the user
            expected a basemap. Bottom-center so it doesn't collide
            with the top-corner basemap picker / layer legend.
            Pointer-events-none so the user can still drag the camera
            through it. */}
        {showOfflineBanner && (
          <div
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 bg-amber-50/95 dark:bg-amber-950/80 border border-status-amber rounded shadow-lg px-3 py-1.5 text-[11px] text-text-primary pointer-events-none flex items-center gap-2"
            role="status"
            data-testid="geology3d-offline-banner"
          >
            <span aria-hidden="true">⚠</span>
            <span>{t('geology.offlineBasemap')}</span>
          </div>
        )}

        {/* Basemap picker — only on the primary viewport */}
        {!chromeless && (
          <BasemapPanel activeBasemapId={basemapId} onSelect={handleBasemapSelect} />
        )}

        {/* Layer legend — basemap on/off + per-layer 3D visibility.
            Click a row to hide/show that layer in the model. The list is height-
            capped + scrollable: a subdivided geotech model expands to more rows
            than the viewport is tall, and a legend that runs off the bottom of
            the screen takes its own toggles with it. */}
        {!chromeless && (
          <div className="absolute top-2 left-2 z-10 bg-surface-overlay/95 border border-border-default rounded shadow-lg max-w-[16rem] py-1 text-xs">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">
              {t('geology.layers')}
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              <li>
                <button
                  type="button"
                  onClick={() => setBasemapEnabled(v => !v)}
                  className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-page transition-colors ${!basemapEnabled ? 'opacity-50' : ''}`}
                  title={basemapEnabled ? t('geology.hideBasemap') : t('geology.showBasemap')}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0 border border-border-default bg-text-secondary"
                  />
                  <span
                    className={`truncate ${!basemapEnabled ? 'line-through text-text-muted' : 'text-text-primary'}`}
                  >
                    {t('geology.basemap')}
                  </span>
                </button>
              </li>
              {/* Ground surface (DEM) on/off — only shown when a terrain TIN
                  exists. The flat DEM plane reads as a "basemap backdrop" the
                  user couldn't switch off otherwise (dogfeed 2026-06-10). */}
              {groundSurface && groundSurface.vertices.length > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setGroundSurfaceVisible(v => !v)}
                    className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-page transition-colors ${!groundSurfaceVisible ? 'opacity-50' : ''}`}
                    title={
                      groundSurfaceVisible
                        ? t('geology.hideGroundSurface')
                        : t('geology.showGroundSurface')
                    }
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-sm shrink-0 border border-border-default"
                      style={
                        groundSurfaceVisible
                          ? { backgroundColor: GROUND_SURFACE_LEGEND.swatchCss }
                          : { borderColor: GROUND_SURFACE_LEGEND.swatchCss }
                      }
                    />
                    <span
                      className={`truncate ${!groundSurfaceVisible ? 'line-through text-text-muted' : 'text-text-primary'}`}
                    >
                      {t('geology.groundSurface')}
                    </span>
                  </button>
                  {groundSurfaceVisible && daylightCaption && (
                    <div className="pl-7 pr-2 pb-1 text-[10px] leading-tight text-text-muted">
                      {daylightCaption}
                    </div>
                  )}
                </li>
              )}
              {/* The master "Surfaces" toggle was removed from the legend
                  (dogfeed 2026-06-16 — owner doesn't want it). ``surfacesVisible``
                  is still driven by fence mode (auto-off in fence) + read by the
                  render; per-formation rows below toggle individual sheets. */}
              {/* Geotech pane: the nested soil ▸ NAD class ▸ body tree. */}
              {geotechLegendTree !== null && (
                <GeotechLayersTree
                  tree={geotechLegendTree}
                  hiddenFormationIds={hiddenFormationIds}
                  hiddenBodyIds={hiddenBodyIds}
                  onToggleFormations={toggleFormations}
                  onToggleBody={toggleBody}
                />
              )}
              {/* Geological / litho panes: the flat per-formation list.
                  Youngest-first (surface at top) so the legend reads like the
                  GeologyInspector list / a borehole log. The TIN paint order
                  (ascending display_order) is unaffected — this reverses the
                  legend list only. */}
              {geotechLegendTree === null && formationsYoungestFirst(formations).map(f => {
                const hidden = hiddenFormationIds.has(f.id)
                const hex = f.color.startsWith('#') ? f.color : `#${f.color}`
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => toggleFormation(f.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-page transition-colors ${hidden ? 'opacity-50' : ''}`}
                      title={hidden ? t('geology.showIn3d') : t('geology.hideIn3d')}
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-sm shrink-0 border border-border-default"
                        style={hidden ? { borderColor: hex } : { backgroundColor: hex }}
                      />
                      <span
                        className={`truncate ${hidden ? 'line-through text-text-muted' : 'text-text-primary'}`}
                      >
                        {/* Litho formations carry litho_main_soil_code — translate
                            at the presentation boundary (debt #96 class fix). Geological
                            formations have null litho_main_soil_code and fall back to
                            their plain name. */}
                        {f.litho_main_soil_code != null
                          ? lithoDisplayName(
                              f.litho_main_soil_code,
                              f.litho_admixtures ?? [],
                            )
                          : f.name}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Split control — explicit free-draw arm + collapse. One "Single
            view" button closes BOTH split kinds, so the user never has to
            know which one is open to get out of it. */}
        {!chromeless && (
        <div className="absolute bottom-9 left-1/2 -translate-x-1/2 z-10 flex gap-2">
          {isTwoPane ? (
            <button
              type="button"
              onClick={() => onExitSplit?.()}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-overlay/95 border border-border-default text-text-primary hover:bg-surface-page transition-colors shadow-lg"
              title={t('geology.singleViewHint')}
              data-testid="geology3d-single-view-button"
            >
              {t('geology.singleView')}
            </button>
          ) : splitArmed ? (
            <button
              type="button"
              onClick={() => {
                setSplitArmed(false)
                setDrawState({ phase: 'idle' })
              }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-overlay/95 border border-border-default text-text-secondary hover:bg-surface-page transition-colors shadow-lg"
              title={t('geology.cancelSplitHint')}
            >
              {t('geology.cancelSplit')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSplitArmed(true)
                setDrawState({ phase: 'idle' })
              }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-accent text-text-on-accent hover:bg-accent-muted transition-colors shadow-lg"
              title={t('geology.drawSplitLine')}
            >
              ✂ {t('geology.splitModel')}
            </button>
          )}
          {/* Compare — the OTHER kind of two-pane view: two different models,
              whole, at one viewpoint. Only offered when the counterpart model
              would actually paint something; a button that opens a blank pane
              reads as a broken viewer. */}
          {canOfferCompare && (
            <button
              type="button"
              onClick={() => onEnterCompare?.()}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-overlay/95 border border-border-default text-text-primary hover:bg-surface-page transition-colors shadow-lg"
              title={t('geology.compareWithHint', { label: compareScene?.label ?? '' })}
              data-testid="geology3d-compare-button"
            >
              ⇹ {t('geology.compareWith', { label: compareScene?.label ?? '' })}
            </button>
          )}
        </div>
        )}

        {/* Split-line draw mode hint */}
        {!chromeless && isDrawMode && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-2 py-1 rounded pointer-events-none">
            {drawState.phase === 'idle'
              ? t('geology.drawSplitFirst')
              : t('geology.drawSplitSecond')}
          </div>
        )}
      </div>

      {/* Secondary (right) viewport — the OTHER half of a cut split, or the
          counterpart model in a comparison. */}
      {isTwoPane && (
        <>
          <div className="w-px h-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" aria-hidden="true" />
          <div className="w-1/2 h-full relative">
            <CesiumViewport
              // Remount on mode change: the two modes hand this pane a
              // different model AND a different camera regime, and reusing the
              // widget would carry the cut pane's camera into the comparison
              // before the first mirrored frame lands.
              viewportKey={splitMode === 'compare' ? 'compare' : 'secondary'}
              formations={splitMode === 'compare' && compareScene ? compareScene.formations : formations}
              surfacesByFormationId={surfacesByFormationId}
              activeBasemap={resolvedBasemap}
              projectEpsg={projectEpsg}
              clippingPlane={activeClipPlane}
              invertClip={splitMode !== 'compare'}
              splitLine={activeSplitLine}
              groundSurface={groundSurface}
              hiddenFormationIds={hiddenFormationIds}
              hiddenBodyIds={hiddenBodyIds}
              basemapEnabled={basemapEnabled}
              groundSurfaceVisible={groundSurfaceVisible}
              surfacesVisible={surfacesVisible}
              showConfidenceFade={showConfidenceFade}
              fencePanels={
                splitMode === 'compare' && compareScene ? compareScene.fencePanels : fencePanels
              }
              bodySolids={
                splitMode === 'compare' && compareScene ? compareScene.bodySolids : bodySolids
              }
              bodySolidsWireframe={bodySolidsWireframe}
              investigationXY={investigationXY}
              footprintRing={footprintRing}
              basemapLidAlpha={basemapLidAlpha}
              // Only the comparison links cameras. The cut split keeps them
              // independent on purpose: each pane is half of ONE model and the
              // user wants to inspect each half on its own.
              followCameraRef={splitMode === 'compare' ? primaryCameraRef : undefined}
            />
            {splitMode === 'compare' && compareScene && (
              <div
                className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-surface-overlay/95 border border-border-default rounded shadow-lg px-2 py-0.5 text-[11px] font-semibold text-text-primary pointer-events-none"
                data-testid="geology3d-compare-label-secondary"
              >
                {compareScene.label}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
