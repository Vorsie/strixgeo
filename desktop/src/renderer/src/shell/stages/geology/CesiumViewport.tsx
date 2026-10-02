/**
 * Single-viewport Cesium widget for ``Geology3DViewer`` (extracted, debt
 * #201 round 2). Owns the per-viewport Cesium lifecycle: viewer creation,
 * basemap layer swap, primitive (re)build, camera sync, and the split-line
 * draw interaction.
 */
import { log } from '../../../utils/log'
import * as Cesium from 'cesium'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  GeologicalFormationResponse,
  FormationSurfaceResponse,
  GroundSurfaceBuildResponse,
} from '../../../api/client'
import type { LithoBodySolidResponse } from '../../../api/clients/geology'
import type { BasemapSource, BasemapId } from '../../../utils/basemapSources'
import type { FencePanel } from '../../../utils/fencePanels'
import {
  BASEMAP_LID_ABOVE_GROUND_M,
  buildBasemapLid,
  flyToBounds,
  flyToCutFace,
  rebuildSurfacePrimitives,
  type SplitLine,
} from './geology3DPrimitives'
import { lidElevationAtInvestigations } from './cesiumGeometry'
import { useCameraLink } from './useCameraLink'
import { useViewportZoomTuning, type ViewportZoomTuning } from './useViewportZoomTuning'
import { useZoomToVerticesRef, type ZoomToVerticesFn } from './useZoomToVerticesRef'
import { REQUEST_RENDER_WIDGET_OPTIONS, requestSceneRender } from './sceneRender'

// Single-viewport Cesium widget
// ---------------------------------------------------------------------------

export interface CesiumViewportProps {
  /** Unique key — React uses this to remount the DOM div on key change. */
  viewportKey: string
  formations: GeologicalFormationResponse[]
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  activeBasemap: BasemapSource
  projectEpsg: number
  /** When provided, a ClippingPlaneCollection is applied to clip this viewport. */
  clippingPlane?: Cesium.Plane | null
  /** Invert the clipping half (right viewport clips the left half). */
  invertClip?: boolean
  /** Projected split line (for the cut-face caps). */
  splitLine?: SplitLine | null
  /** Ref populated with a fly-to-bounds callback. */
  cameraResetRef?: React.MutableRefObject<(() => void) | null>
  /** Ref populated with a fly-to-these-vertices callback (the fence cutout's
   * "Zoom to unit", owner ruling C(a) 2026-10-02); omitted on every stage. */
  zoomToVerticesRef?: React.MutableRefObject<ZoomToVerticesFn | null>
  /**
   * Optional callback for recording click positions during the split-line
   * draw interaction.  Called with the projected [x, y] position of the click
   * in the Cesium scene.
   */
  onSceneClick?: (cartesian: Cesium.Cartesian3) => void
  /** DEM ground-surface TIN — rendered below formation surfaces as terrain base. */
  groundSurface?: GroundSurfaceBuildResponse | null
  /** Formation ids toggled off in the 3D legend — their TIN is not drawn. */
  hiddenFormationIds?: ReadonlySet<string>
  /**
   * Body ids toggled off in the 3D legend's per-body level — their solid is not
   * drawn.  Separate from ``hiddenFormationIds`` because only the solid render
   * carries body identity: fence walls are keyed by formation.
   */
  hiddenBodyIds?: ReadonlySet<string>
  /** When false, no basemap imagery is added (the 3D "Basemap" toggle). */
  basemapEnabled?: boolean
  /** When false, the DEM ground-surface TIN is not drawn (the "Ground surface" toggle). */
  groundSurfaceVisible?: boolean
  /** When false, the formation-surface TIN sheets are not drawn (the "Surfaces" toggle). */
  surfacesVisible?: boolean
  /** Per-project confidence-fade toggle (debt #94 follow-up). */
  showConfidenceFade?: boolean
  /** Fence-diagram wall panels — threaded from Geology3DViewerProps. */
  fencePanels?: FencePanel[]
  /** Per-body closed opaque solids — threaded from Geology3DViewerProps. */
  bodySolids?: LithoBodySolidResponse[]
  /** When true, body solids render as wireframe (LINES) rather than filled
   * faces — threaded from Geology3DViewerProps. Default false. */
  bodySolidsWireframe?: boolean
  /** Investigation (x, y) positions in project CRS — the distance metric for the
   * confidence fade of body solids (threaded from Geology3DViewerProps). */
  investigationXY?: readonly (readonly [number, number])[]
  /** Closed ring of ``[x_m, y_m, elevation_m]`` marking the model footprint —
   * threaded from Geology3DViewerProps, drawn last and never clipped. */
  footprintRing?: readonly (readonly number[])[]
  /** Basemap lid alpha — threaded from Geology3DViewerProps; omitted keeps
   * the shared ``DEFAULT_BASEMAP_LID_ALPHA`` (owner ruling B6b, 2026-08-27:
   * only the fence cutout dials it). */
  basemapLidAlpha?: number
  /**
   * Overrides the panel set the fence-mode basemap-lid FALLBACK reads (audit
   * F4, 2026-08-27). Only the Parameters fence cutout passes it: its rendered
   * walls are the body/unit-FILTERED panels, but the orthophoto footprint and
   * lid elevation must match the other 3-D stages — the WHOLE model's panels.
   * Omitted (every shared stage) the fallback keeps reading ``fencePanels``,
   * byte-identical to before.
   */
  lidFootprintPanels?: FencePanel[]
  /**
   * Wheel-zoom tuning for THIS viewport (audit F5, 2026-08-27). Only the
   * Parameters fence cutout passes it; omitted, the controller keeps every
   * Cesium default and no handler is attached — the shared stages are
   * byte-identical. See ``useViewportZoomTuning`` for the mechanism.
   */
  zoomTuning?: ViewportZoomTuning
  /**
   * Ref this viewport publishes its camera on while mounted, so a sibling
   * viewport can mirror it (compare mode). Null when the viewport unmounts.
   *
   * A ref rather than a prop because the camera is a mutable Cesium object
   * that changes many times per second: routing it through React state would
   * re-render both panes on every mouse move.
   */
  cameraRef?: React.MutableRefObject<Cesium.Camera | null>
  /**
   * When set, this viewport MIRRORS the camera published on that ref instead
   * of being driven independently — the compare panes must show one viewpoint
   * or the two models cannot be compared.
   *
   * The mirroring viewport is the follower: it copies pose every frame and
   * never writes back, so there is no feedback loop.
   */
  followCameraRef?: React.MutableRefObject<Cesium.Camera | null>
}

/**
 * One Cesium WebGL viewport mounting and managing a single ``CesiumWidget``
 * instance.
 *
 * Lifecycle rules:
 *
 * - The widget is created once on mount (the container div ref becomes
 *   non-null) and destroyed on unmount via ``widget.destroy()``.
 * - Surface primitives are rebuilt whenever ``formations``,
 *   ``surfacesByFormationId``, or ``projectEpsg`` change.
 * - The basemap imagery layer is replaced whenever ``activeBasemap`` changes.
 *
 * Parameters
 * ----------
 * viewportKey
 *     Stable string identifier — not a React key. Used for the DOM element
 *     id so multiple viewports coexist without collision.
 * formations
 *     Formations for the active geological model.
 * surfacesByFormationId
 *     Surface data keyed by formation id.
 * activeBasemap
 *     Currently selected basemap source.
 * projectEpsg
 *     Horizontal CRS EPSG code.
 * clippingPlane
 *     Optional plane for split-viewport clipping.
 * invertClip
 *     When true, clips the opposite half of ``clippingPlane``.
 * cameraResetRef
 *     Ref populated with the fly-to callback.
 * onSceneClick
 *     Click handler used during the split-line draw interaction.
 *
 * Returns
 * -------
 * JSX.Element
 *     The Cesium viewport container.
 */
/**
 * Read the diagnostics switch for order-independent translucency.
 *
 * OIT is off by design (the 2026-05-18 shimmer fix); this lets the owner A/B it
 * on the real model without a rebuild. Off unless ``localStorage['strix.3d.oit']``
 * is exactly ``'1'``; any storage error reads as off.
 *
 * @returns Whether the next viewer is created with OIT on.
 */
function oitDiagnosticsSwitch(): boolean {
  try {
    return window.localStorage.getItem('strix.3d.oit') === '1'
  } catch {
    return false
  }
}

export function CesiumViewport({
  viewportKey,
  formations,
  surfacesByFormationId,
  projectEpsg,
  clippingPlane = null,
  invertClip = false,
  splitLine = null,
  cameraResetRef,
  zoomToVerticesRef,
  onSceneClick,
  groundSurface,
  hiddenFormationIds,
  hiddenBodyIds,
  basemapEnabled = true,
  groundSurfaceVisible = true,
  surfacesVisible = true,
  showConfidenceFade = true,
  fencePanels,
  bodySolids,
  bodySolidsWireframe = false,
  investigationXY,
  footprintRing,
  basemapLidAlpha,
  lidFootprintPanels,
  zoomTuning,
  cameraRef,
  followCameraRef,
}: CesiumViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<Cesium.CesiumWidget | null>(null)
  // Track the active click handler so we can remove it on cleanup.
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null)
  // Last surface-set signature the camera was framed to — gates
  // flyToBounds so re-clipping / toggles don't re-frame the view.
  const lastFitKeyRef = useRef<string | null>(null)
  // Last split plane the cut-face camera framed — re-frame once per
  // newly-drawn plane, not on every basemap/visibility toggle.
  const lastSplitPlaneRef = useRef<Cesium.Plane | null>(null)
  // Tracks whether the split-view camera has already been framed with
  // content for the current clipping plane. Cleared alongside
  // lastSplitPlaneRef so a new plane OR first-content arrival both
  // trigger a fly-to (fixes solid-mode secondary viewport staying on
  // the bare globe when surfaces are empty but bodySolids arrive).
  const lastSplitHadContentRef = useRef<boolean>(false)
  // The mounted widget's scene, as STATE rather than only ``widgetRef``: the
  // camera-link effects must re-run once the widget exists, and a ref write
  // does not re-render. Every other effect here reads ``widgetRef`` inside its
  // own body and re-runs on its data deps, so only the link needs this.
  const [mountedScene, setMountedScene] = useState<Cesium.Scene | null>(null)

  // ---------------------------------------------------------------------------
  // Mount / unmount the CesiumWidget
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // StrictMode fires this effect twice (mount → cleanup → re-mount). The
    // cleanup destroys the widget and nulls widgetRef/cameraResetRef; the
    // subsequent effects guard via `if (!widget) return`, so no explicit
    // double-init guard is needed — the null checks are sufficient.
    const widget = new Cesium.CesiumWidget(container, {
      // On-demand rendering (M7c): a static geological model must not redraw
      // every frame. Every scene mutation below explicitly requestSceneRender()s.
      ...REQUEST_RENDER_WIDGET_OPTIONS,
      // Flat globe — no Cesium ion terrain. The project elevations are used
      // directly as ellipsoidal heights (the ~45 m geoid offset is shared by
      // all surfaces so relative geometry is correct — see §4.2 of the spec).
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      // Suppress the default Cesium skybox (stars) — not relevant for
      // geotech project views. A plain sky colour is less distracting.
      skyBox: false,
      // Suppress the Cesium ion logo and the default imagery — we add our own.
      baseLayer: false,
      // Anti-aliasing. The half-space clip emits a triangle SOUP (many thin
      // slivers); without multisampling their edges crawl/sparkle as the
      // camera moves — the "ragged band edges" symptom. 4x MSAA (WebGL2)
      // smooths the cut faces and the clipped TIN borders.
      msaaSamples: 4,
      // Deterministic translucency. Cesium's default Order-Independent
      // Translucency uses weighted-blended accumulation whose weight is a
      // numerically sensitive function of fragment depth. Our scene stacks
      // many near-parallel TRANSLUCENT layers (ground TIN + every formation
      // TIN + the basemap lid) along the view ray — maximal where you look
      // straight into the cut face (the split view). Under continuous render
      // the accumulation textures vary frame-to-frame → the bands SHIMMER.
      // Disabling OIT falls back to distance-sorted back-to-front alpha
      // blending — which sorts by the distance to each bounding-sphere
      // SURFACE, so the widest sheet sorts nearest from every direction and
      // the 0.2 m per-order z-offset cannot outweigh a footprint difference.
      // The formation sheets therefore WRITE depth
      // (geology3DPrimitives.withDepthWrites, 2026-09-22).
      // (Both are construct-time-only: scene.msaaSamples /
      // .orderIndependentTranslucency are read-only after creation.)
      // Diagnostics switch (owner 2026-09-22, the wrong sheet on top): set
      // ``localStorage['strix.3d.oit'] = '1'`` in DevTools and reload to try
      // order-independent translucency on the real model; remove to go back.
      orderIndependentTranslucency: oitDiagnosticsSwitch(),
    })

    // FXAA on top of MSAA — cheap extra smoothing of the shader-aliased
    // translucent band edges that MSAA's geometric coverage alone misses.
    widget.scene.postProcessStages.fxaa.enabled = true

    // Remove the Cesium credit container (hidden behind our own attribution UI).
    // The provider credit is still honoured in BasemapPanel.
    const creditContainer = container.querySelector('.cesium-widget-credits') as HTMLElement | null
    if (creditContainer) creditContainer.style.display = 'none'

    widgetRef.current = widget
    log.info(
      'geology3d',
      `viewer created: OIT=${widget.scene.orderIndependentTranslucency} msaa=${widget.scene.msaaSamples}`,
    )
    // A freshly created widget has the default whole-Earth camera —
    // it must be re-framed. Clearing the fit guard here is what makes
    // the StrictMode-recreated (and secondary) viewport actually fly
    // to the model instead of staying on the bare globe.
    lastFitKeyRef.current = null
    lastSplitPlaneRef.current = null
    lastSplitHadContentRef.current = false
    setMountedScene(widget.scene)

    return () => {
      widget.destroy()
      widgetRef.current = null
      setMountedScene(null)
      // Null the camera reset ref so callers get null rather than a stale
      // callback pointing at the destroyed widget's scene.camera.
      if (cameraResetRef) cameraResetRef.current = null
    }
    // reason: cameraResetRef is a stable module-level object literal — its
    // identity never changes, so it is safe to omit from the dep array.
    // Including it would cause spurious widget remounts on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Rebuild surface primitives when data changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const widget = widgetRef.current
    if (!widget) return

    // Basemap lid: one Geopunt ortho GetMap over the model footprint,
    // placed flat at the model top. Off when the user toggled the
    // basemap off, or no model yet, or non-Belgian CRS.
    const lidSurfaces: { vertices: readonly (readonly [number, number, number])[] }[] =
      [...surfacesByFormationId.values()]
    if (groundSurface && groundSurface.vertices.length > 0) {
      lidSurfaces.push({ vertices: groundSurface.vertices })
    }
    // Fence-cutout fallback (owner ruling B6a, 2026-08-27): with no surfaces
    // and no ground surface — the cutout passes neither — the wall panels are
    // the only geometry, so they supply the lid footprint. Strictly additive:
    // whenever ANY surface or ground TIN exists (every 3-D stage), this arm
    // never fires and the lid rect is byte-identical to before.
    // ``lidFootprintPanels`` (audit F4) lets the cutout feed the FULL model's
    // panels here while rendering only the filtered walls, so the orthophoto
    // footprint + elevation match the other 3-D stages; shared stages never
    // pass it and keep reading ``fencePanels``.
    const lidPanels = lidFootprintPanels ?? fencePanels
    if (lidSurfaces.length === 0 && lidPanels !== undefined) {
      for (const panel of lidPanels) lidSurfaces.push({ vertices: panel.vertices })
    }
    // The lid sits just above the ground AT THE INVESTIGATIONS (owner
    // 2026-09-13: a DEM hull-edge spike had lifted it 14 m above the collars);
    // with no ground or no investigations the highest-vertex rule stays.
    const lidElevation = lidElevationAtInvestigations(
      groundSurface ?? null,
      investigationXY ?? [],
      BASEMAP_LID_ABOVE_GROUND_M,
    )
    const lid = basemapEnabled ? buildBasemapLid(lidSurfaces, projectEpsg, lidElevation) : null

    rebuildSurfacePrimitives(
      widget.scene,
      formations,
      surfacesByFormationId,
      projectEpsg,
      groundSurface,
      hiddenFormationIds,
      lid,
      clippingPlane,
      invertClip,
      splitLine,
      showConfidenceFade,
      fencePanels,
      groundSurfaceVisible,
      surfacesVisible,
      bodySolids,
      bodySolidsWireframe,
      investigationXY,
      hiddenBodyIds,
      footprintRing,
      basemapLidAlpha,
    )

    const allSurfaces = Array.from(surfacesByFormationId.values())
    const hasSurfaces = allSurfaces.some(s => s.vertices.length > 0)

    // In Solid mode the caller passes an empty surfacesByFormationId (surface
    // sheets are suppressed) and fills bodySolids instead. Frame to the solids
    // when there are no surfaces so the camera lands on the geometry rather
    // than the bare globe. Both helpers accept FormationSurfaceResponse[] for
    // their vertex source; LithoBodySolidResponse carries the same
    // { vertices: [number,number,number][] } shape, so a cast suffices.
    const frameTargets: FormationSurfaceResponse[] = hasSurfaces
      ? allSurfaces
      : ((bodySolids?.filter(b => b.vertices.length > 0) ?? []) as unknown as FormationSurfaceResponse[])
    const hasContent = frameTargets.length > 0

    // Camera. Split active → look at the cut FACE head-on (step 3);
    // single → oblique bounds fit. Reset verb mirrors the active mode.
    if (cameraResetRef) {
      cameraResetRef.current = clippingPlane
        ? () =>
            flyToCutFace(
              widget.scene.camera,
              frameTargets,
              projectEpsg,
              clippingPlane,
              !invertClip,
            )
        : () => flyToBounds(widget.scene.camera, frameTargets, projectEpsg)
    }

    if (clippingPlane) {
      // Re-frame to the cut when:
      //   (a) a new plane was drawn (object identity changes), OR
      //   (b) content first appeared for the current plane (e.g. Solid
      //       mode: Build completes after the plane was already drawn,
      //       so the secondary viewport was sitting on the bare globe).
      // Guard: don't re-frame on every basemap/visibility/colour toggle.
      const planeChanged = lastSplitPlaneRef.current !== clippingPlane
      const contentJustAppeared = hasContent && !lastSplitHadContentRef.current
      if (hasContent && (planeChanged || contentJustAppeared)) {
        lastSplitPlaneRef.current = clippingPlane
        lastSplitHadContentRef.current = true
        flyToCutFace(
          widget.scene.camera,
          frameTargets,
          projectEpsg,
          clippingPlane,
          !invertClip,
        )
      }
    } else {
      lastSplitPlaneRef.current = null
      lastSplitHadContentRef.current = false
      // Single view: fly only when the content SET changes.
      // Include solid vertex counts so switching surfaces→solids re-frames.
      const fitKey = `${projectEpsg}|${allSurfaces
        .map(s => s.vertices.length)
        .join(',')}|${groundSurface?.vertices.length ?? 0}|${bodySolids?.map(b => b.vertices.length).join(',') ?? ''}`
      if (hasContent && lastFitKeyRef.current !== fitKey) {
        lastFitKeyRef.current = fitKey
        flyToBounds(widget.scene.camera, frameTargets, projectEpsg)
      }
    }

    // On-demand rendering (M7c): the primitives were just rebuilt, so ask for a
    // redraw. Camera flights above animate on their own (Cesium keeps rendering
    // while a flight or a user-driven camera change is in progress), but the
    // static rebuild needs this or the new geometry is invisible until the next
    // interaction.
    requestSceneRender(widget.scene)
    // reason: clippingPlane/invertClip/splitLine drive the per-half
    // clip + cut-face caps + camera; the refs gate re-framing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formations,
    surfacesByFormationId,
    projectEpsg,
    groundSurface,
    hiddenFormationIds,
    // Per-body legend toggles: rebuild so a hidden body's solid disappears.
    // Deliberately NOT part of the camera fitKey below — hiding a body must
    // not re-fly the camera.
    hiddenBodyIds,
    basemapEnabled,
    clippingPlane,
    invertClip,
    splitLine,
    // Debt #94 follow-up: include the confidence-fade toggle so
    // primitives rebuild when the user flips it.  Without this,
    // changing the toggle has no visual effect because the existing
    // alpha-baked primitives stay in place.
    showConfidenceFade,
    // Fence panels: rebuild when the lithology canvas passes new wall panels
    // (new section, new correlations, or section deselected).
    fencePanels,
    // Ground-surface visibility toggle — rebuild so the DEM appears/disappears.
    groundSurfaceVisible,
    // Surfaces visibility toggle — rebuild so the formation TIN sheets appear/disappear.
    surfacesVisible,
    // Body solids: rebuild when the lithology canvas passes new solid meshes
    // (after a rebuild or when the model changes).  The caller passes a useState
    // value so the reference is stable — no useMemo needed; any new array literal
    // would re-trigger this effect every render (same dep-array rule as fencePanels).
    bodySolids,
    // Wireframe toggle: rebuild the body-solid primitives as LINES vs filled
    // faces when the user flips the in-app wireframe view toggle.
    bodySolidsWireframe,
    // Investigation positions: rebuild so the confidence fade of body solids
    // re-evaluates when the in-corridor investigation set changes.
    investigationXY,
    // Footprint ring: rebuild when the backend answers with the hull, when the
    // model changes, or when the ring elevation moves because the ground
    // surface / solids finished loading.
    footprintRing,
    // Lid alpha: a scalar; only the fence cutout ever sets it (B6b).
    basemapLidAlpha,
    // Lid footprint override: only the fence cutout passes it (F4); its
    // identity is a caller-memoised array.
    lidFootprintPanels,
  ])

  // (Basemap is no longer a Cesium ImageryLayer — it's a single
  // georeferenced "lid" primitive built inside rebuildSurfacePrimitives;
  // see buildBasemapLid. The old whole-ellipsoid tiled-imagery effect
  // was removed: the Geopunt GoogleMapsVL matrixset never tiled right
  // under Cesium → 400-storm + edge-on smear instead of a cutout.)

  // Camera link (compare mode) — see useCameraLink for why the follower
  // mirrors in preRender rather than on the camera's `changed` event.
  useCameraLink(mountedScene, cameraRef, followCameraRef)

  // Cutout-only wheel-zoom tuning (F5) — a no-op unless ``zoomTuning`` is set.
  useViewportZoomTuning(mountedScene, zoomTuning)
  useZoomToVerticesRef(mountedScene, projectEpsg, zoomToVerticesRef)

  // ---------------------------------------------------------------------------
  // Wire click handler for split-line draw interaction
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const widget = widgetRef.current
    if (!widget || !onSceneClick) return

    // Remove any previous handler.
    if (clickHandlerRef.current) {
      clickHandlerRef.current.destroy()
      clickHandlerRef.current = null
    }

    const handler = new Cesium.ScreenSpaceEventHandler(widget.scene.canvas)
    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // pickPosition needs a depth buffer / something pickable under the
      // cursor. On the flat ellipsoid (no Cesium terrain) it returns
      // undefined for clicks off the TIN — which is why the split never
      // registered. Fall back to the ellipsoid intersection so any
      // click on the scene yields a world point.
      const cartesian =
        widget.scene.pickPosition(event.position) ??
        widget.camera.pickEllipsoid(
          event.position,
          widget.scene.globe.ellipsoid,
        )
      if (cartesian) {
        onSceneClick(cartesian)
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    clickHandlerRef.current = handler

    return () => {
      handler.destroy()
      clickHandlerRef.current = null
    }
  }, [onSceneClick])

  return (
    <div
      ref={containerRef}
      id={`cesium-viewport-${viewportKey}`}
      className="relative w-full h-full"
      style={{ background: '#000' }}
    />
  )
}
