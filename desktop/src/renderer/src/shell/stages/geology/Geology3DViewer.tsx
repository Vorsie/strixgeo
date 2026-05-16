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
  onSplitPlaneDrawn: (plane: Cesium.Plane) => void
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

/** Alpha for the DEM ground-surface TIN mesh — semi-transparent so formation
 * surfaces render visibly above the terrain. */
const ALPHA_GROUND_SURFACE = 0.45

/** Earth-tone colour for the DEM ground-surface TIN (warm grey). */
const GROUND_SURFACE_COLOR = new Cesium.Color(0.55, 0.52, 0.48, ALPHA_GROUND_SURFACE)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * WGS84 rectangle enclosing every vertex across a set of surfaces,
 * padded ~8 %. Used to clip the basemap imagery to the model footprint
 * (a "cutout") so Cesium does NOT drape — and tile-flood 400 — the
 * whole ellipsoid. Returns ``null`` when there are no vertices yet.
 */
function surfacesRectangle(
  surfaces: FormationSurfaceResponse[],
  projectEpsg: number,
): Cesium.Rectangle | null {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  let n = 0
  for (const s of surfaces) {
    for (const [x, y] of s.vertices) {
      const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      n++
    }
  }
  if (n === 0) return null
  const padLat = (maxLat - minLat) * 0.08 || 0.001
  const padLng = (maxLng - minLng) * 0.08 || 0.001
  return Cesium.Rectangle.fromDegrees(
    minLng - padLng,
    minLat - padLat,
    maxLng + padLng,
    maxLat + padLat,
  )
}

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
function buildImageryProvider(
  source: BasemapSource,
  rectangle: Cesium.Rectangle,
): Cesium.UrlTemplateImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: source.url,
    subdomains: source.subdomains ? source.subdomains.split('') : undefined,
    credit: new Cesium.Credit(source.attribution, false),
    // Clip to the model footprint so Cesium never drapes/refines the
    // whole ellipsoid (the cause of the thousands of Geopunt 400s and
    // the runaway Level-21 requests). minimumLevel/maximumLevel cap
    // refinement to sane regional zoom.
    rectangle,
    minimumLevel: 11,
    maximumLevel: 19,
  })
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
  // Build a bounding sphere from every surface vertex (ECEF) and let
  // Cesium fit it to the frustum. The previous manual approach put the
  // camera straight over the midpoint at a fixed 2×span height with a
  // -45° pitch, which left the data off-centre and the distance
  // heuristic wrong ("zoom is off"). flyToBoundingSphere with an
  // explicit range scaled to the actual extent frames it correctly.
  const points: Cesium.Cartesian3[] = []
  for (const surface of surfaces) {
    for (const [x, y, z] of surface.vertices) {
      const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
      points.push(Cesium.Cartesian3.fromDegrees(lng, lat, z))
    }
  }
  if (points.length === 0) return

  const sphere = Cesium.BoundingSphere.fromPoints(points)
  // 2.2× radius (min 600 m) keeps the whole model comfortably in view
  // without the camera ending up inside thin/flat geology.
  const range = Math.max(sphere.radius * 2.2, 600)

  camera.flyToBoundingSphere(sphere, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(
      0,
      // Oblique look-down for geological context; straight down is
      // disorienting for surface inspection.
      Cesium.Math.toRadians(-45),
      range,
    ),
  })
}

/**
 * Build a Cesium Primitive from a flat list of ``[x, y, z]`` vertices and
 * ``[i0, i1, i2]`` triangle index triples.
 *
 * Returns ``null`` when ``triangles`` is empty (degenerate or no-data TIN).
 *
 * Parameters
 * ----------
 * vertices
 *     ``[x_m, y_m, elevation_m]`` triples in the project's horizontal CRS.
 * triangles
 *     Vertex-index triples (counter-clockwise winding).
 * color
 *     Cesium.Color (including alpha) for the primitive.
 * projectEpsg
 *     Horizontal CRS EPSG code for the coordinate transform.
 *
 * Returns
 * -------
 * ``Cesium.Primitive`` or ``null``.
 */
function buildTinPrimitive(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
  color: Cesium.Color,
  projectEpsg: number,
): Cesium.Primitive | null {
  if (triangles.length === 0) return null

  const positionValues = new Float64Array(vertices.length * 3)
  let i = 0
  for (const [x, y, z] of vertices) {
    const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
    const ecef = Cesium.Cartesian3.fromDegrees(lng, lat, z)
    positionValues[i++] = ecef.x
    positionValues[i++] = ecef.y
    positionValues[i++] = ecef.z
  }

  const indices = new Uint32Array(triangles.length * 3)
  let j = 0
  for (const [i0, i1, i2] of triangles) {
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

  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
      },
    }),
    // flat: true — geological/terrain bands are translucent fills; per-vertex
    // lighting normals are neither wanted nor meaningful for subsurface surfaces.
    // flat: false requires a normal attribute (and Cesium's compressVertices path
    // then demands compressedAttributes that were never computed), which causes
    // the "Appearance/Geometry mismatch … 'compressedAttributes'" crash for every
    // TIN primitive. flat: true uses FLAT_VERTEX_FORMAT (position-only), which
    // matches the geometry we supply.
    appearance: new Cesium.PerInstanceColorAppearance({
      translucent: true,
      flat: true,
    }),
    asynchronous: false,
  })
}

/**
 * Add TIN surface primitives to a Cesium scene for the ground surface and all
 * formations.
 *
 * Existing primitives in the scene are cleared before adding new ones so
 * the caller can call this function on every dependency change without
 * accumulating duplicates.
 *
 * The ground-surface TIN (when present) is added first so it renders below
 * formation surfaces — Cesium's painter's algorithm renders primitives in
 * insertion order.
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
 * groundSurface
 *     Optional DEM ground-surface TIN.  When provided and non-empty, rendered
 *     as an earth-tone semi-transparent mesh below the formation surfaces.
 */
function rebuildSurfacePrimitives(
  scene: Cesium.Scene,
  formations: GeologicalFormationResponse[],
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>,
  projectEpsg: number,
  groundSurface?: GroundSurfaceBuildResponse | null,
  hiddenFormationIds?: ReadonlySet<string>,
): void {
  scene.primitives.removeAll()

  // Ground-surface TIN — rendered first (painter's algorithm: drawn below
  // formation surfaces). Uses a warm-grey earth tone at 45 % alpha so
  // formation bands remain legible above it.
  if (groundSurface && groundSurface.triangles.length > 0) {
    const terrainPrimitive = buildTinPrimitive(
      groundSurface.vertices,
      groundSurface.triangles,
      GROUND_SURFACE_COLOR,
      projectEpsg,
    )
    if (terrainPrimitive) {
      scene.primitives.add(terrainPrimitive)
    }
  }

  for (const formation of formations) {
    // Per-formation visibility toggle (the 3D legend). A hidden
    // formation's TIN is simply not added, so the next-deeper
    // formation shows through where it would have been.
    if (hiddenFormationIds?.has(formation.id)) continue
    const surface = surfacesByFormationId.get(formation.id)
    if (!surface || surface.triangles.length === 0) continue

    const isStale = surface.is_stale === true
    const alpha = isStale ? ALPHA_STALE : ALPHA_FRESH
    const zOffset = formation.display_order * Z_OFFSET_PER_ORDER

    // Parse the formation's hex colour. Fall back to grey when malformed.
    const hexColor = formation.color.startsWith('#')
      ? formation.color
      : `#${formation.color}`
    const csColor = Cesium.Color.fromCssColorString(hexColor) ?? Cesium.Color.GRAY
    csColor.alpha = alpha

    // Apply the per-formation z-offset to vertex elevations before building
    // the primitive so co-planar surfaces don't z-fight.
    const offsetVertices: [number, number, number][] = surface.vertices.map(
      ([x, y, z]) => [x, y, z + zOffset],
    )

    const primitive = buildTinPrimitive(offsetVertices, surface.triangles, csColor, projectEpsg)
    if (primitive) {
      scene.primitives.add(primitive)
    }
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
  /** DEM ground-surface TIN — rendered below formation surfaces as terrain base. */
  groundSurface?: GroundSurfaceBuildResponse | null
  /** Formation ids toggled off in the 3D legend — their TIN is not drawn. */
  hiddenFormationIds?: ReadonlySet<string>
  /** When false, no basemap imagery is added (the 3D "Basemap" toggle). */
  basemapEnabled?: boolean
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
  groundSurface,
  hiddenFormationIds,
  basemapEnabled = true,
}: CesiumViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<Cesium.CesiumWidget | null>(null)
  // Track both imagery layers so we can remove both on basemap swap.
  // Some basemaps have an overlay (e.g. Geopunt hybrid = base + GRB-selectie
  // transparent layer); tracking only the primary layer leaks the overlay on
  // every basemap change.
  const imageryLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const imageryOverlayLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  // Track the active click handler so we can remove it on cleanup.
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null)

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

    rebuildSurfacePrimitives(
      widget.scene,
      formations,
      surfacesByFormationId,
      projectEpsg,
      groundSurface,
      hiddenFormationIds,
    )

    // TODO(post-v1.0): per-primitive clipping for Cesium3DTileset/photogrammetric overlays.
    // ClippingPlaneCollection is not part of the public API for raw Geometry/Primitive;
    // it is supported on Cesium3DTileset and Model. The DOM layout (each widget occupies
    // exactly half the container) provides the visual split for this viewer.

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
    // basemap or clipping-plane change. The dep array includes surfaces and
    // groundSurface but not the camera ref — the ref is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formations, surfacesByFormationId, projectEpsg, groundSurface, hiddenFormationIds])

  // ---------------------------------------------------------------------------
  // Swap imagery layer when basemap changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const widget = widgetRef.current
    if (!widget) return

    // Remove both the previous base layer and overlay layer before swapping
    // to the new basemap. Failing to remove the overlay causes it to
    // accumulate on every swap to a basemap-with-overlay.
    if (imageryOverlayLayerRef.current) {
      widget.scene.imageryLayers.remove(imageryOverlayLayerRef.current, true)
      imageryOverlayLayerRef.current = null
    }
    if (imageryLayerRef.current) {
      widget.scene.imageryLayers.remove(imageryLayerRef.current, true)
      imageryLayerRef.current = null
    }

    // Basemap off, or no model footprint yet → no imagery at all. This
    // is both the user "turn the basemap off" toggle AND the guard that
    // prevents the whole-ellipsoid tile flood before any surface exists.
    if (!basemapEnabled) return
    const surfaces = Array.from(surfacesByFormationId.values())
    const rectSources =
      groundSurface && groundSurface.vertices.length > 0
        ? [...surfaces, { vertices: groundSurface.vertices } as FormationSurfaceResponse]
        : surfaces
    const rect = surfacesRectangle(rectSources, projectEpsg)
    if (!rect) return

    const provider = buildImageryProvider(activeBasemap, rect)
    const layer = widget.scene.imageryLayers.addImageryProvider(provider)
    layer.rectangle = rect
    imageryLayerRef.current = layer

    // If the source has an overlay (e.g. Geopunt hybrid: GRB-selectie
    // transparent layer over orthophoto), add it as a second imagery layer
    // and track it separately so the next swap removes it cleanly.
    if (activeBasemap.overlay) {
      const overlayProvider = buildImageryProvider(
        {
          ...activeBasemap,
          url: activeBasemap.overlay.url,
          subdomains: undefined,
          attribution: activeBasemap.overlay.attribution,
          overlay: undefined,
        },
        rect,
      )
      const overlayLayer = widget.scene.imageryLayers.addImageryProvider(overlayProvider)
      overlayLayer.rectangle = rect
      imageryOverlayLayerRef.current = overlayLayer
    }
    // reason: surfacesByFormationId / groundSurface drive the clip
    // rectangle; basemapEnabled toggles imagery on/off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBasemap, basemapEnabled, surfacesByFormationId, groundSurface, projectEpsg])

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
 * Returns
 * -------
 * ``Cesium.Plane`` or ``null``.
 */
function computeSplitPlane(
  a: Cesium.Cartesian3,
  b: Cesium.Cartesian3,
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
  activeBasemap: initialBasemap,
  projectEpsg,
  onSplitPlaneDrawn,
  resetCameraRef,
  groundSurface,
  onExitSplit,
}: Geology3DViewerProps): JSX.Element {
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
  // Basemap on/off (the user toggle). Default on.
  const [basemapEnabled, setBasemapEnabled] = useState(true)

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
          onSplitPlaneDrawn(plane)
          setSplitArmed(false)
        }
        // Segment too short → stay armed, idle: the user re-clicks.
      }
    },
    // projectEpsg is intentionally absent: computeSplitPlane works purely
    // in ECEF/WGS84 and never reads the project CRS.
    [splitMode, splitPlane, drawState, onSplitPlaneDrawn],
  )

  // Draw mode is active only while explicitly armed (and we're in single
  // view with no plane yet). Clicks are captured only then.
  const isDrawMode =
    splitMode === 'single' && splitPlane === null && splitArmed
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
          groundSurface={groundSurface}
          hiddenFormationIds={hiddenFormationIds}
          basemapEnabled={basemapEnabled}
        />

        {/* Basemap picker — only on the primary viewport */}
        <BasemapPanel activeBasemapId={basemapId} onSelect={handleBasemapSelect} />

        {/* Layer legend — basemap on/off + per-formation 3D visibility.
            Click a row to hide/show that layer in the model. */}
        {
          <div className="absolute top-2 left-2 z-10 bg-surface-overlay/95 border border-border-default rounded shadow-lg max-w-[15rem] py-1 text-xs">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">
              Layers
            </div>
            <ul>
              <li>
                <button
                  type="button"
                  onClick={() => setBasemapEnabled(v => !v)}
                  className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-page transition-colors ${!basemapEnabled ? 'opacity-50' : ''}`}
                  title={basemapEnabled ? 'Hide basemap' : 'Show basemap'}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0 border border-border-default bg-text-secondary"
                  />
                  <span
                    className={`truncate ${!basemapEnabled ? 'line-through text-text-muted' : 'text-text-primary'}`}
                  >
                    Basemap
                  </span>
                </button>
              </li>
              {formations.map(f => {
                const hidden = hiddenFormationIds.has(f.id)
                const hex = f.color.startsWith('#') ? f.color : `#${f.color}`
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => toggleFormation(f.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-page transition-colors ${hidden ? 'opacity-50' : ''}`}
                      title={hidden ? 'Show in 3D' : 'Hide in 3D'}
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-sm shrink-0 border border-border-default"
                        style={hidden ? { borderColor: hex } : { backgroundColor: hex }}
                      />
                      <span
                        className={`truncate ${hidden ? 'line-through text-text-muted' : 'text-text-primary'}`}
                      >
                        {f.name}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        }

        {/* Split control — explicit free-draw arm + collapse. */}
        <div className="absolute bottom-9 left-1/2 -translate-x-1/2 z-10">
          {splitMode === 'split' ? (
            <button
              type="button"
              onClick={() => onExitSplit?.()}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-overlay/95 border border-border-default text-text-primary hover:bg-surface-page transition-colors shadow-lg"
              title="Collapse the split back to a single view"
            >
              Single view
            </button>
          ) : splitArmed ? (
            <button
              type="button"
              onClick={() => {
                setSplitArmed(false)
                setDrawState({ phase: 'idle' })
              }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-overlay/95 border border-border-default text-text-secondary hover:bg-surface-page transition-colors shadow-lg"
              title="Cancel the split-line draw"
            >
              Cancel split
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSplitArmed(true)
                setDrawState({ phase: 'idle' })
              }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-accent text-text-on-accent hover:bg-accent-muted transition-colors shadow-lg"
              title="Draw a line across the model to split it into two independently-panned views"
            >
              ✂ Split model
            </button>
          )}
        </div>

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
              groundSurface={groundSurface}
              hiddenFormationIds={hiddenFormationIds}
          basemapEnabled={basemapEnabled}
            />
          </div>
        </>
      )}
    </div>
  )
}
