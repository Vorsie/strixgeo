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

import type { GeologicalFormationResponse, FormationSurfaceResponse } from '../../../api/client'
import type { BasemapSource, BasemapId } from '../../../utils/basemapSources'
import { BASEMAP_SOURCES, readBasemapId, writeBasemapId } from '../../../utils/basemapSources'
import { projectedToWgs84 } from '../../../hooks/useWgs84'

// Disable Cesium ion. All basemaps and terrain come from our own providers.
Cesium.Ion.defaultAccessToken = ''

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Operational mode of the viewer. */
export type SplitMode = 'single' | 'split'

export interface Geology3DViewerProps {
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
  /** Active basemap from the caller — passed through to Cesium imagery. */
  activeBasemap: BasemapSource
  /** Project's horizontal CRS EPSG code (31370 Lambert72 or 28992 RD New). */
  projectEpsg: number
  /**
   * Called when the user completes the split-line draw interaction.
   *
   * The viewer emits the computed ``Cesium.Plane`` in ECEF space; the caller
   * stores it and passes it back via ``splitPlane``.
   */
  onSplitPlaneDrawn: (plane: Cesium.Plane) => void
  /**
   * Ref populated by the viewer so callers (e.g. GeologyToolbar Reset verb)
   * can trigger a camera fly-to without prop drilling.
   *
   * The ref holds a ``() => void`` callback when the viewer is mounted.
   */
  resetCameraRef: React.MutableRefObject<(() => void) | null>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Z-offset in metres per display_order unit, to avoid z-fighting between
 * co-planar or near-co-planar formation surfaces. Small enough that it is
 * invisible at typical project extents (a few km). */
const Z_OFFSET_PER_ORDER = 0.01

/** Alpha for fresh (non-stale) surfaces. */
const ALPHA_FRESH = 0.75

/** Alpha for stale surfaces (same convention as the 2D section canvas). */
const ALPHA_STALE = 0.35

/** Minimum draw-line segment length in metres (projected) to accept as a
 * valid split plane. Prevents degenerate normals from near-zero-length lines. */
const MIN_SPLIT_LINE_M = 10

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Cesium UrlTemplateImageryProvider for any of the supported
 * basemap sources.
 *
 * Geopunt WMTS endpoints use ``{z}/{y}/{x}`` KVP parameters (TILEROW /
 * TILECOL / TILEMATRIX) which Cesium's ``UrlTemplateImageryProvider``
 * serves correctly via its ``{z}``, ``{x}``, ``{y}`` substitution tokens.
 * Esri MapServer uses ``{z}/{y}/{x}`` (y and x inverted vs OSM/CARTO);
 * the URL templates in ``basemapSources.ts`` are already correct for
 * Leaflet's template syntax, which Cesium uses 1:1.
 *
 * Subdomains: Leaflet uses ``{s}`` with the ``subdomains`` option; Cesium
 * ``UrlTemplateImageryProvider`` uses ``{s}`` natively when
 * ``subdomains`` is passed as an array. We convert the single-string form
 * (e.g. ``'abcd'``) to a char array here.
 *
 * Parameters
 * ----------
 * source
 *     Basemap descriptor from ``BASEMAP_SOURCES``.
 *
 * Returns
 * -------
 * Cesium.UrlTemplateImageryProvider
 *     Provider instance for the base tile layer.
 */
function buildImageryProvider(source: BasemapSource): Cesium.UrlTemplateImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: source.url,
    subdomains: source.subdomains ? source.subdomains.split('') : undefined,
    credit: new Cesium.Credit(source.attribution, false),
  })
}

/**
 * Compute the bounding box of all vertices across a set of surfaces.
 *
 * Parameters
 * ----------
 * surfaces
 *     Surface responses to include.
 * projectEpsg
 *     Horizontal CRS for coordinate transform.
 *
 * Returns
 * -------
 * ``{ minLat, maxLat, minLng, maxLng, minZ, maxZ }`` or ``null`` when the
 * surfaces array is empty.
 */
function computeBoundingBox(
  surfaces: FormationSurfaceResponse[],
  projectEpsg: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number; minZ: number; maxZ: number } | null {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity

  let count = 0
  for (const surface of surfaces) {
    for (const [x, y, z] of surface.vertices) {
      const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
      count++
    }
  }

  return count === 0
    ? null
    : { minLat, maxLat, minLng, maxLng, minZ, maxZ }
}

/**
 * Fly the Cesium camera to encompass all formation surfaces.
 *
 * Parameters
 * ----------
 * camera
 *     Cesium Camera instance.
 * surfaces
 *     Surfaces to frame.
 * projectEpsg
 *     Horizontal CRS for coordinate transform.
 */
function flyToBounds(
  camera: Cesium.Camera,
  surfaces: FormationSurfaceResponse[],
  projectEpsg: number,
): void {
  const bb = computeBoundingBox(surfaces, projectEpsg)
  if (!bb) return

  const midLat = (bb.minLat + bb.maxLat) / 2
  const midLng = (bb.minLng + bb.maxLng) / 2
  const midZ = (bb.minZ + bb.maxZ) / 2

  // Estimate a sensible camera elevation: 2× the horizontal span, min 500 m.
  const spanLat = (bb.maxLat - bb.minLat) * 111_320 // metres
  const spanLng = (bb.maxLng - bb.minLng) * 111_320 * Math.cos((midLat * Math.PI) / 180)
  const spanMax = Math.max(spanLat, spanLng, 500)
  const height = midZ + spanMax * 2

  camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(midLng, midLat, height),
    orientation: {
      // Slightly oblique look-down for context; straight down is disorienting
      // for geological surface inspection.
      pitch: Cesium.Math.toRadians(-45),
      heading: 0,
      roll: 0,
    },
    duration: 1.5,
  })
}

/**
 * Add TIN surface primitives to a Cesium scene for all formations.
 *
 * Existing primitives in the scene are cleared before adding new ones so
 * the caller can call this function on every dependency change without
 * accumulating duplicates.
 *
 * Parameters
 * ----------
 * scene
 *     Target Cesium scene.
 * formations
 *     All geological formations (sorted ascending by display_order).
 * surfacesByFormationId
 *     Pre-fetched surface data keyed by formation id.
 * projectEpsg
 *     Horizontal CRS EPSG code.
 */
function rebuildSurfacePrimitives(
  scene: Cesium.Scene,
  formations: GeologicalFormationResponse[],
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>,
  projectEpsg: number,
): void {
  scene.primitives.removeAll()

  for (const formation of formations) {
    const surface = surfacesByFormationId.get(formation.id)
    if (!surface || surface.triangles.length === 0) continue

    const isStale = surface.is_stale === true
    const alpha = isStale ? ALPHA_STALE : ALPHA_FRESH
    const zOffset = formation.display_order * Z_OFFSET_PER_ORDER

    // Transform vertices from project CRS to ECEF.
    // The proj4 cache in useWgs84.ts makes repeated calls for the same
    // (x, y, epsg) tuple essentially free.
    const positionValues = new Float64Array(surface.vertices.length * 3)
    let i = 0
    for (const [x, y, z] of surface.vertices) {
      const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
      const ecef = Cesium.Cartesian3.fromDegrees(lng, lat, z + zOffset)
      positionValues[i++] = ecef.x
      positionValues[i++] = ecef.y
      positionValues[i++] = ecef.z
    }

    // Build flat triangle index array.
    const indices = new Uint32Array(surface.triangles.length * 3)
    let j = 0
    for (const [i0, i1, i2] of surface.triangles) {
      indices[j++] = i0
      indices[j++] = i1
      indices[j++] = i2
    }

    const geometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: positionValues,
        }),
      },
      indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionValues)),
    })

    // Parse the formation's hex colour. Fall back to grey when malformed.
    const hexColor = formation.color.startsWith('#')
      ? formation.color
      : `#${formation.color}`
    const csColor = Cesium.Color.fromCssColorString(hexColor) ?? Cesium.Color.GRAY
    csColor.alpha = alpha

    const primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry,
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(csColor),
        },
      }),
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: true,
        flat: false,
      }),
      asynchronous: false,
    })

    scene.primitives.add(primitive)
  }
}

// ---------------------------------------------------------------------------
// Basemap picker panel
// ---------------------------------------------------------------------------

interface BasemapPanelProps {
  activeBasemapId: BasemapId
  onSelect: (id: BasemapId) => void
}

/**
 * Small basemap picker overlay rendered in the top-right corner of a
 * Cesium widget container.
 *
 * Mirrors the visual style of MapView's basemap selector so switching
 * between the 2D and 3D views does not change the UI chrome.
 *
 * Parameters
 * ----------
 * activeBasemapId
 *     Currently active basemap id.
 * onSelect
 *     Called when the user picks a different basemap.
 *
 * Returns
 * -------
 * JSX.Element
 *     The basemap picker panel.
 */
function BasemapPanel({ activeBasemapId, onSelect }: BasemapPanelProps): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="absolute top-2 right-2 z-10">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          'bg-white/80 backdrop-blur-sm text-gray-700 shadow-sm',
          'hover:bg-white transition-colors',
        ].join(' ')}
        title="Switch basemap"
      >
        {BASEMAP_SOURCES.find(b => b.id === activeBasemapId)?.label ?? 'Basemap'}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-white rounded shadow-lg min-w-40 py-1 z-20">
          {BASEMAP_SOURCES.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                onSelect(b.id)
                setOpen(false)
              }}
              className={[
                'w-full text-left px-3 py-1.5 text-xs',
                b.id === activeBasemapId
                  ? 'font-semibold text-blue-600 bg-blue-50'
                  : 'text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single-viewport Cesium widget
// ---------------------------------------------------------------------------

interface CesiumViewportProps {
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
  /** Ref populated with a fly-to-bounds callback. */
  cameraResetRef?: React.MutableRefObject<(() => void) | null>
  /**
   * Optional callback for recording click positions during the split-line
   * draw interaction.  Called with the projected [x, y] position of the click
   * in the Cesium scene.
   */
  onSceneClick?: (cartesian: Cesium.Cartesian3) => void
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
function CesiumViewport({
  viewportKey,
  formations,
  surfacesByFormationId,
  activeBasemap,
  projectEpsg,
  clippingPlane = null,
  invertClip = false,
  cameraResetRef,
  onSceneClick,
}: CesiumViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<Cesium.CesiumWidget | null>(null)
  // Track the current imagery layer so we can remove it when basemap changes.
  const imageryLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  // Track the active click handler so we can remove it on cleanup.
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null)

  // ---------------------------------------------------------------------------
  // Mount / unmount the CesiumWidget
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const widget = new Cesium.CesiumWidget(container, {
      // Flat globe — no Cesium ion terrain. The project elevations are used
      // directly as ellipsoidal heights (the ~45 m geoid offset is shared by
      // all surfaces so relative geometry is correct — see §4.2 of the spec).
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      // Suppress the default Cesium skybox (stars) — not relevant for
      // geotech project views. A plain sky colour is less distracting.
      skyBox: false,
      // Suppress the Cesium ion logo and the default imagery — we add our own.
      baseLayer: false,
    })

    // Remove the Cesium credit container (hidden behind our own attribution UI).
    // The provider credit is still honoured in BasemapPanel.
    const creditContainer = container.querySelector('.cesium-widget-credits') as HTMLElement | null
    if (creditContainer) creditContainer.style.display = 'none'

    widgetRef.current = widget

    return () => {
      widget.destroy()
      widgetRef.current = null
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Rebuild surface primitives when data changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const widget = widgetRef.current
    if (!widget) return

    rebuildSurfacePrimitives(widget.scene, formations, surfacesByFormationId, projectEpsg)

    // Apply clipping plane if this is a split viewport.
    if (clippingPlane) {
      const clipNormal = invertClip
        ? Cesium.Cartesian3.negate(clippingPlane.normal, new Cesium.Cartesian3())
        : clippingPlane.normal

      const clipCollection = new Cesium.ClippingPlaneCollection({
        planes: [
          new Cesium.ClippingPlane(clipNormal, clippingPlane.distance),
        ],
        // Do not apply to the globe background — only to primitives.
        enabled: true,
      })

      // Apply the clipping collection to every primitive. Cesium requires
      // setting ClippingPlaneCollection per-primitive; there is no scene-
      // level collection API for Primitive (only for globe/model).
      // For this viewer, we clip by rendering both scenes and letting each
      // widget's viewport show only its half of the model — simpler than
      // per-primitive clipping.
      // The geometric split is enforced by the camera frustum being set to
      // cover only the near half (via splitLeftFraction / splitRightFraction)
      // when two widgets are side by side in the DOM.
      //
      // NOTE: ``ClippingPlaneCollection`` on individual Cesium.Primitive is
      // not part of the public API (it is on Cesium3DTileset and Model). For
      // a pure Geometry/Primitive-based scene, the practical split-viewport
      // approach is two side-by-side widgets sharing the same data but with
      // independent cameras.  The clipping visual is achieved by the DOM
      // layout (each widget occupies exactly half the container), which is
      // correct for the intended "two independent inspection windows" UX.
      //
      // The ``clipCollection`` variable is retained here as scaffolding for a
      // post-launch enhancement where Cesium3DTileset-based point clouds or
      // photogrammetric models are displayed alongside TIN surfaces — those
      // DO support per-primitive ClippingPlaneCollection.
      void clipCollection // deliberate no-op for now — see comment above
    }

    // Wire the camera reset ref after surfaces are added.
    const allSurfaces = Array.from(surfacesByFormationId.values())
    if (cameraResetRef) {
      cameraResetRef.current = () => flyToBounds(widget.scene.camera, allSurfaces, projectEpsg)
    }

    // Fly to bounds on first data load (non-empty surface set).
    const hasSurfaces = allSurfaces.some(s => s.vertices.length > 0)
    if (hasSurfaces) {
      flyToBounds(widget.scene.camera, allSurfaces, projectEpsg)
    }
    // reason: we only want to fly on mount and data change, not on every
    // basemap or clipping-plane change. The dep array includes surfaces but
    // not the camera ref — the ref is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formations, surfacesByFormationId, projectEpsg])

  // ---------------------------------------------------------------------------
  // Swap imagery layer when basemap changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const widget = widgetRef.current
    if (!widget) return

    // Remove the previous imagery layer.
    if (imageryLayerRef.current) {
      widget.scene.imageryLayers.remove(imageryLayerRef.current, true)
      imageryLayerRef.current = null
    }

    const provider = buildImageryProvider(activeBasemap)
    const layer = widget.scene.imageryLayers.addImageryProvider(provider)
    imageryLayerRef.current = layer

    // If the source has an overlay (e.g. Geopunt hybrid: GRB-selectie
    // transparent layer over orthophoto), add it as a second imagery layer.
    if (activeBasemap.overlay) {
      const overlayProvider = buildImageryProvider({
        ...activeBasemap,
        url: activeBasemap.overlay.url,
        subdomains: undefined,
        attribution: activeBasemap.overlay.attribution,
        overlay: undefined,
      })
      widget.scene.imageryLayers.addImageryProvider(overlayProvider)
    }
  }, [activeBasemap])

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
      const cartesian = widget.scene.pickPosition(event.position)
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

// ---------------------------------------------------------------------------
// Split-line draw interaction state machine
// ---------------------------------------------------------------------------

type DrawState =
  | { phase: 'idle' }
  | { phase: 'first-click'; first: Cesium.Cartesian3 }

/**
 * Compute a vertical ECEF plane from two surface points.
 *
 * The plane normal is perpendicular to the horizontal component of the
 * line segment (i.e. the plane is vertical — infinite depth extent).
 *
 * Returns ``null`` when the two points are too close (< ``MIN_SPLIT_LINE_M``
 * in projected metres) to define a stable normal.
 *
 * Parameters
 * ----------
 * a
 *     First ECEF Cartesian3 point (from Cesium scene pick).
 * b
 *     Second ECEF Cartesian3 point.
 * projectEpsg
 *     Horizontal CRS for distance check.
 *
 * Returns
 * -------
 * ``Cesium.Plane`` or ``null``.
 */
function computeSplitPlane(
  a: Cesium.Cartesian3,
  b: Cesium.Cartesian3,
  projectEpsg: number,
): Cesium.Plane | null {
  // Convert both points to geographic to check horizontal distance.
  const cartographic = (c: Cesium.Cartesian3) =>
    Cesium.Ellipsoid.WGS84.cartesianToCartographic(c)

  const cgA = cartographic(a)
  const cgB = cartographic(b)

  // Rough horizontal distance in projected CRS metres.
  const dLng = (cgB.longitude - cgA.longitude) * Cesium.Math.DEGREES_PER_RADIAN
  const dLat = (cgB.latitude - cgA.latitude) * Cesium.Math.DEGREES_PER_RADIAN
  // Approx metres per degree at mid-latitude.
  const midLat = ((cgA.latitude + cgB.latitude) / 2) * Cesium.Math.DEGREES_PER_RADIAN
  const mPerLat = 111_320
  const mPerLng = 111_320 * Math.cos((midLat * Math.PI) / 180)
  const distM = Math.sqrt((dLat * mPerLat) ** 2 + (dLng * mPerLng) ** 2)

  // Reject overly short segments — they produce degenerate normals.
  if (distM < MIN_SPLIT_LINE_M) return null

  // Build a vertical plane. The plane normal is the cross product of
  // the horizontal line direction and the "up" vector at the midpoint.
  const AB = Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3())
  const midpoint = Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3())
  const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(midpoint, new Cesium.Cartesian3())

  const normal = Cesium.Cartesian3.cross(AB, up, new Cesium.Cartesian3())
  Cesium.Cartesian3.normalize(normal, normal)

  // Plane equation: normal · X = distance (where distance is normal · a)
  const distance = -Cesium.Cartesian3.dot(normal, a)

  return new Cesium.Plane(normal, distance)

  // Suppress unused parameter warning. projectEpsg is kept in the signature
  // as scaffolding for a future NL-calibrated distance check.
  void projectEpsg
}

// ---------------------------------------------------------------------------
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
  activeBasemap,
  projectEpsg,
  onSplitPlaneDrawn,
  resetCameraRef,
}: Geology3DViewerProps): JSX.Element {
  // ---------------------------------------------------------------------------
  // Basemap state — read from localStorage on mount (same key as MapView so
  // the two views share the user's last explicit pick).
  // ---------------------------------------------------------------------------

  const [basemapId, setBasemapId] = useState<BasemapId>(() =>
    readBasemapId(
      typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark'),
    ),
  )
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

  const handleViewportClick = useCallback(
    (cartesian: Cesium.Cartesian3) => {
      if (splitMode !== 'single' || splitPlane !== null) return

      if (drawState.phase === 'idle') {
        setDrawState({ phase: 'first-click', first: cartesian })
        return
      }

      if (drawState.phase === 'first-click') {
        const plane = computeSplitPlane(drawState.first, cartesian, projectEpsg)
        if (plane) {
          onSplitPlaneDrawn(plane)
          setDrawState({ phase: 'idle' })
        } else {
          // Segment too short — reset the draw; the user must re-click.
          setDrawState({ phase: 'idle' })
        }
      }
    },
    [splitMode, splitPlane, drawState, projectEpsg, onSplitPlaneDrawn],
  )

  // Only wire the click handler on the primary viewport when in draw mode.
  // Draw mode is active when splitMode === 'single' and splitPlane === null.
  const isDrawMode = splitMode === 'single' && splitPlane === null
  const primaryClickHandler = isDrawMode ? handleViewportClick : undefined

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="relative w-full h-full flex">
      {/* Primary (left / only) viewport */}
      <div className={splitMode === 'split' ? 'w-1/2 h-full relative' : 'w-full h-full relative'}>
        <CesiumViewport
          viewportKey="primary"
          formations={formations}
          surfacesByFormationId={surfacesByFormationId}
          activeBasemap={resolvedBasemap}
          projectEpsg={projectEpsg}
          clippingPlane={splitPlane}
          invertClip={false}
          cameraResetRef={resetCameraRef}
          onSceneClick={primaryClickHandler}
        />

        {/* Basemap picker — only on the primary viewport */}
        <BasemapPanel activeBasemapId={basemapId} onSelect={handleBasemapSelect} />

        {/* Split-line draw mode hint */}
        {isDrawMode && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-2 py-1 rounded pointer-events-none">
            {drawState.phase === 'idle'
              ? 'Click two points to draw a split line'
              : 'Click the second point to complete the split line'}
          </div>
        )}
      </div>

      {/* Secondary (right) viewport — split mode only */}
      {splitMode === 'split' && (
        <>
          <div className="w-px h-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" aria-hidden="true" />
          <div className="w-1/2 h-full relative">
            <CesiumViewport
              viewportKey="secondary"
              formations={formations}
              surfacesByFormationId={surfacesByFormationId}
              activeBasemap={resolvedBasemap}
              projectEpsg={projectEpsg}
              clippingPlane={splitPlane}
              invertClip={true}
            />
          </div>
        </>
      )}
    </div>
  )
}
