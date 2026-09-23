# Geology Stage + 3D Viewer Architecture

**Status:** Design document — pre-implementation (§10 addendum 2026-05-15).
**Date:** 2026-05-15
**Scope:** Geology stage (functional core + 3D viewer canvas) replacing the
GeologyStage stub introduced in S6. Supersedes the S6/S7 sketches in
`ui-shell-architecture.md`.
**Prerequisites:** S1–S5 shipped, S6 stub registered, `useGeologicalModel`
extracted, ShellContext bus live.

---

## Contents

1. What we are deciding
2. The corrected contract: what Geology owns vs Sections owns
3. Functional Geology stage (MVP-gate-critical core)
4. 3D viewer subsystem
5. Phased build plan
6. The v1.0 scope fork — owner decision required
7. Genuine decision forks — owner must resolve before build commits
8. Risks and explicit non-goals
9. Debt updates

---

## 1. What we are deciding

The Geology stage is the third spine button. Its stub (`GeologyCanvas.tsx`)
currently renders "coming soon". This document specifies what replaces it:

- A **functional Geology stage** (inspector + toolbar + 2D map canvas) that
  owns formation definition, "Fill from boreholes", reorder, delete, and the
  Build verb. This unblocks the Sections "Seed from stratigraphy" action that
  is currently explicitly disabled and waiting on Geology to own model
  definition.
- A **3D viewer canvas** showing TIN surfaces draped with a basemap cutout,
  with orbit/pan/zoom, and an optional split-viewport mode.

The two are **independently shippable.** The functional core is MVP-gate-
critical and lower-risk. The 3D viewer is a launch differentiator and
higher-risk. The phasing treats them accordingly.

---

## 2. The corrected contract: what Geology owns vs Sections owns

This is load-bearing and drives every component boundary below.

### Geology stage owns

| Action | Where | Notes |
|---|---|---|
| Define formations ("Fill from boreholes") | Geology toolbar | Repurposes `handleAutoPopulateFromStratigraphy` |
| Create formation manually | Geology inspector | FormationDialog, already exists |
| Delete formation | Geology inspector | Cascades contacts — confirm dialog required |
| Reorder formations | Geology inspector | Drag-and-drop, display_order axis |
| Choose which formations to keep | Geology inspector | **(superseded by §10 — Fork E)** No hide toggle. "Fill from boreholes" is a curated selection dialog; unselected formations are DB-deleted. |
| Build model (Delaunay/TIN rebuild) | Geology toolbar | `handleRebuildSurfaces`; also stays in Sections |
| Delete geological model | Geology toolbar | Irreversible — confirm dialog |
| View TIN surfaces in 3D | Geology canvas | Cesium viewer |

### Sections stage owns (unchanged)

| Action | Where | Notes |
|---|---|---|
| Seed from stratigraphy | Sections toolbar | **Now un-gated** once Geology owns Fill. Calls `handleAutoPopulateFromStratigraphy` but contacts-only — places contacts at borehole observation boundaries for formations that already exist in the model |
| Place / edit / delete contacts | Section canvas | SectionPanel, no change |
| Export DXF | Sections toolbar | Unchanged |
| Export Plaxis 3D | Sections toolbar | Unchanged |
| Build model (also here) | Sections toolbar | Identical `handleRebuildSurfaces` call; the verb lives in both stages because engineers rebuild from wherever they are working |

### Model membership — only tests a section draws feed a model

Owner ruling 2026-09-23 ("you don't need to drop subdivision on tests, only
don't use tests not on sections for the model"): a test that projects onto no
cross-section is not a model input, in ANY model. The picks stay on the test;
its contribution stops while no section draws it, and resumes when one does.
One rule, one place: `application/section_membership.py` (the geotech
membership invariant since 2026-08-15) — corridor of any section of the
project, minus the tests that section excludes. Consumers: the formation TIN
rebuild (`contact_feeds_surface`, next to the hidden-from-project and
excluded-from-model filters), the ground hull, and through the built
surfaces the crossing check. A project with no section has an empty model.

Because membership moves with the sections, every route that can move a test
on or off one — create, delete, batch create, companion create, and a PATCH of
the endpoints, CRS, corridor or exclusion lists — flags every built surface of
the project stale (`GeologyRepository.mark_project_surfaces_stale`); the next
Build re-filters. A rename or a view-state change does not. The desktop
mirrors it: `useSections` fires `onSectionsChanged`, `App` bumps
`sectionsStaleNonce`, and `useGeologicalModel` re-reads the surfaces so the
"rebuild" badge turns amber without a reopen (the bed-change pattern).

### The Seed action closure

Seed is currently no-op disabled in `SectionsToolbar.tsx` with an explicit
comment. Once the Geology stage ships and owns formation definition, the Seed
button un-gates: it calls `handleAutoPopulateFromStratigraphy` with the same
bus action, but the distinction is that **Geology creates the formation rows
from scratch** (the "Fill from boreholes" source of truth), while **Sections
Seed only creates contacts** — it requires formations to already exist. The
comment in `SectionsToolbar.tsx` must be updated when Geology ships.

**(superseded by §10 — Fork E)** The Geology "Fill from boreholes" action is
NOT a direct call to `handleAutoPopulateFromStratigraphy`. It opens a
curated selection dialog (`FormationSelectionDialog`) via a new bus action
`discoverBoreholeFormations`, and only calls the backend on confirm via
`applyBoreholeFormationSelection`. The Sections "Seed" action continues to
call `handleAutoPopulateFromStratigraphy` directly — that is unaffected.
See §10 for the full design.

---

## 3. Functional Geology stage

### 3.1 File layout

All new files under `desktop/src/renderer/src/shell/stages/geology/`. Existing
`GeologyCanvas.tsx` and `GeologyStage.ts` are replaced/extended in place.

```
shell/stages/geology/
├── GeologyStage.ts          StageDescriptor — replaces stub
├── GeologyCanvas.tsx        Canvas component — replaces "coming soon" placeholder
│                            Phase G1: 2D plan view (MapView + formation-contact
│                            overlay). Phase G2+: Cesium 3D viewer.
├── GeologyToolbar.tsx       Toolbar verbs: Fill from boreholes, Build model,
│                            Reset view, Delete model
├── GeologyInspector.tsx     Formation/unit selector — the migrated
│                            InterpretationPane content
└── Geology3DViewer.tsx      Cesium widget — Phase G2 (new file, added then)
```

### 3.2 GeologyStage descriptor

Replaces the current stub. Same `StageDescriptor` interface as SectionsStage.

```typescript
// GeologyStage.ts
const GeologyStage: StageDescriptor = {
  id: 'geology',
  icon: Mountain,
  spineLabel: 'Geology',
  useStageSummary: useGeologyStageSummary,  // existing summary hook — keep as-is
  CanvasComponent: GeologyCanvas,
  ToolbarComponent: GeologyToolbar,
  InspectorComponent: GeologyInspector,
}
```

`useStageSummary` already exists in the stub and is correct — no change needed
there.

### 3.3 GeologyInspector — InterpretationPane migration

The `InterpretationPane.tsx` component holds all the state and handlers for
formation list, drag-reorder, borehole scope section, crossings banner, and
the per-formation delete confirm. The migration plan is:

**What moves into GeologyInspector:**

- Formation list with drag-reorder (all state, `reorderFormations`, drag
  handlers, `visibleFormations` memo)
- Per-formation delete confirm modal
- Borehole scope sub-section ("Boreholes in model" checkbox list)
- Crossings banner (refetched here via `geoModel.crossingsRefreshCounter`)
- "Add formation" entry (opens FormationDialog in create mode)
- Per-formation click-to-edit (opens FormationDialog in edit mode)
- `FormationDialog` remains unchanged — it is a self-contained modal

**What moves to GeologyToolbar (not inspector):**

- Fill from boreholes button
- Build model button (with stale badge)
- Delete geological model button (new — not in InterpretationPane today)

**What stays in Sidebar.tsx for now (and retires when Sidebar.tsx is deleted):**

- The `InterpretationPane` component itself remains mounted in Sidebar.tsx
  until S7-final is complete. The pattern follows how Sections content
  migrated: the new Geology inspector is the *correct* home; the old Sidebar
  tab is a graceful-degradation fallback during the migration window.

**What does NOT move:**

- Plaxis 3D export button — moves to ExportStage (not yet built); stays in
  InterpretationPane/Sidebar until then.
- Dedupe contacts — moves to GeologyToolbar (it's a model-maintenance verb,
  not a formation-definition action; belongs near Build).

**GeologyInspector prop contract:**

`GeologyInspector` takes no props (StageDescriptor contract). It reads
everything from `useShell()`:

```typescript
const {
  project,
  geoModel: {
    activeGeologicalModel,
    formations,
    contacts,
    formationsRefreshCounter,
    crossingsRefreshCounter,
    staleSurfaceCount,
    surfacesByFormationId,
    handleFormationCreated,
    handleFormationUpdated,
    handleFormationDeleted,
    handleInlineCreateFormation,
    handleToggleBoreholeInModel,
    refetchFormations,
  },
  lifecycle: {
    manifestFormationIds,
    sessionImports: { formationIds: sessionImportFormationIds },
  },
  visibleBoreholes,
  geoModel: { excludedBoreholeIds },   // see note below
  sections: { handleFocusContacts },
  undo: { push: pushUndoCommand },
} = useShell()
```

Note: `excludedBoreholeIds` is not currently on `UseGeologicalModelResult`.
The active geological model carries `excluded_borehole_ids` in the API
response. `GeologyInspector` can derive this from
`geoModel.activeGeologicalModel?.excluded_borehole_ids ?? []`. No bus
extension needed.

**Crossings banner:** already exists in InterpretationPane. GeologyInspector
owns it. When the user clicks a crossing item, it calls `handleFocusContacts`
from `sections` — the Sections stage highlights the contacts on the section
canvas. This cross-stage navigation is the intended pattern (section is the
editing surface; the banner is a quality indicator in the Geology inspector).

**No schema change, no .gmproj change:** all formation/contact/surface data
already lives in `geological_formations`, `formation_contacts`,
`formation_surfaces` — those are unchanged. The UI migration is purely a
matter of which component renders the data, not what the data is.

### 3.4 GeologyToolbar

Toolbar verbs, left to right:

1. **Fill from boreholes** (primary accent button) — **(superseded by §10 —
   Fork E)** Does NOT call `handleAutoPopulateFromStratigraphy` directly.
   Opens `FormationSelectionDialog` via `discoverBoreholeFormations()`. The
   dialog shows candidate formation names discovered from borehole observation
   stratigraphy; the user selects which to keep; confirm calls
   `applyBoreholeFormationSelection`. See §10 for the full contract.

2. Separator.

3. **Build model** — calls `handleRebuildSurfaces`. Identical to the Sections
   stage Build button. Amber tint + stale count badge when `staleSurfaceCount
   > 0`. The on-click-build rule applies: mutations flag `is_stale`, Build
   clears it.

4. **Dedupe** — calls `handleDedupeContacts`. Maintenance verb; lives in
   Geology because it operates on the model definition, not on a specific
   section.

5. Separator.

6. **Reset to single 3D view** — collapses split-viewport back to single
   Cesium widget. Disabled when already in single-view mode. Only relevant
   once the 3D viewer lands.

7. **Delete model** — irreversible; confirm dialog with "Delete geological
   model" button, default focus on Cancel. Calls a new `handleDeleteModel`
   action on `useGeologicalModel` (see section 3.5). Danger styling.

The pattern for `GeologyToolbar` exactly mirrors `SectionsToolbar.tsx` — same
`PrimaryToolbarButton` / `ToolbarButton` internal components (extract shared
`ToolbarButton` primitives to `shell/ToolbarPrimitives.tsx` on the third copy,
per the extraction rule — we are at copy two with Sections having the first).

### 3.5 Bus extension required: `handleDeleteModel`

`useGeologicalModel` currently has no `handleDeleteModel` action. The delete
model verb requires a new action. This is the only bus extension for the
functional core.

Shape: `handleDeleteModel: () => Promise<void>` — calls `DELETE
/projects/{pid}/geology/models/{mid}`, then sets `activeGeologicalModel` to
`null`, clears `formations`, `contacts`, `surfacesByFormationId`. On success,
fires `removeFromManifest` for all formation ids. The backend endpoint already
exists per `docs/api.md`.

This is a contained addition to `useGeologicalModel.ts`. No other hook is
affected.

### 3.6 GeologyCanvas — Phase G1 (2D plan view)

The Phase G1 canvas is a **2D plan view using the existing MapView** — exactly
the same pattern as the Sections stage falling back to MapView when no section
is selected.

`GeologyCanvas` for G1 renders `<MapView ... />` with:
- All the existing props from `useShell()` (cpts, boreholes, sections,
  basemap, bbox draw, section line draw — the full existing prop surface).
- No additional Geology-specific overlay needed for G1 (formation contacts are
  only visible on the section canvas; the plan view is a geographic context
  for the model, not a contact editor).

This is intentionally minimal for G1. The plan view is useful as-is: the
engineer can see where their investigations are, select a section, switch to
Sections to edit contacts, switch back. The 3D viewer (G2) replaces this
canvas with a Cesium-based view.

**No duplication with DataStage:** the DataStage canvas (DataCanvas) renders
MapView with investigation selection (CPT click → chart, borehole click →
borelog). The GeologyCanvas renders MapView in a read-only context (no
investigation selection, no CPT/borehole detail loading). The difference is
the absence of `handleSelect` / `handleSelectBorehole` wiring — the map shows
all points but clicking them does nothing (or could navigate to the Data
stage, but that is a UX decision deferred to the owner's feedback).

### 3.7 InterpretationPane → GeologyInspector migration and debt #14

**Debt #14 (Sidebar UI overhaul)** is resolved when the Geology stage
inspector replaces InterpretationPane as the home for formation management.
The resolution is:

1. **GeologyInspector ships** — formation list, drag-reorder, crossings
   banner, borehole scope, FormationDialog all live here.
2. **InterpretationPane** remains mounted in Sidebar.tsx's Interpretation tab
   during the transition. It becomes a read-only duplicate that the user may
   see only if they navigate to the old Sidebar tab.
3. **Sidebar.tsx's Interpretation tab is hidden** (but not deleted) once
   GeologyInspector ships — the tab becomes the fallback-only path.
4. **Sidebar.tsx Interpretation tab is deleted** in the debt #14 cleanup
   commit, which also removes the InterpretationPane prop wiring in App.tsx.

The Sidebar.tsx section list (SectionList component) can be retired at the
same time, since the SectionsInspector already hosts the section list. The
Sidebar.tsx Tests + Visualisation tabs retire when the DataStage inspector
fully replaces them (S4 work, already shipped).

**After the migration, `InterpretationPane.tsx` itself is deleted.** It is not
a shared component; it is an implementation of a UI that has moved.

### 3.8 .gmproj / schema impact — none

The functional Geology stage requires:

- No `.gmproj` format change. All formation/contact/surface data already
  persists in the v3 bundle's `geological_formations`, `geological_models`
  arrays.
- No DB schema migration. `handleDeleteModel` calls an existing endpoint.
- No new API endpoints. All verbs use existing bus actions.

The only addition is `handleDeleteModel` on `UseGeologicalModelResult` — an
internal TypeScript type, not a public artefact. Internal types are explicitly
excluded from the backwards-compatibility rules in CLAUDE.md.

---

## 4. 3D viewer subsystem

### 4.1 Engine decision: CesiumJS vs alternatives

**Decision: CesiumJS.**

The requirements drive this unambiguously:

| Requirement | Cesium | Three.js | Deck.gl | Potree |
|---|---|---|---|---|
| Geospatial basemap raster drape | Native (imagery layers) | DIY only | Tile-based only | No |
| WGS84/ECEF globe with correct geoid | Native (core model) | DIY | DIY | No |
| Multiple independent cameras | Two `CesiumWidget` instances | Doable | Not native | No |
| Clipping planes for split-line | `ClippingPlaneCollection` — built-in | DIY | No | No |
| Lambert72 / RD input → ECEF | `Ellipsoid.WGS84.cartesianToCartographic` + proj4 | Same | Same | N/A |
| Orbit/pan/zoom on terrain | `ScreenSpaceCameraController` | Orbit controls | 3D orbit | No |
| TIN mesh from vertices/triangles | `Geometry` + `Primitive` | Three.js `BufferGeometry` | No | No |
| Electron renderer (no Node APIs) | Supported | Supported | Supported | Needs fork |

Three.js is the credible alternative for pure mesh rendering, but the basemap
drape requirement rules it out: getting geospatial tile layers aligned to a
Three.js scene with correct CRS is a non-trivial custom implementation (build
a tile fetch/display pipeline from scratch, or integrate a third-party tile
layer library). Cesium handles this natively with its `ImageryLayer` API.

The split-viewport requirement (two independent cameras, clipping planes)
further favours Cesium: `CesiumWidget` instances are designed to be
instantiated multiple times in one page, and `ClippingPlaneCollection` is a
first-class API. In Three.js this would require two `WebGLRenderer` instances
with carefully managed context sharing — workable, but a higher implementation
cost.

**Cesium licensing:** Cesium for Unreal / Unity / ion are commercial, but the
core `cesium` npm package (`cesiumjs`) is Apache-2.0. Usage of the Cesium ion
cloud (basemap tiles from Cesium's servers, terrain from their CDN) requires
an ion token — but we do NOT need Cesium ion at all. Our basemaps come from
the existing `basemapSources.ts` providers (Geopunt, CARTO, Esri, OSM), and
our terrain is the flat model footprint, not global terrain data. The
`CesiumWidget` can be configured with `imageryProvider: false` and
`terrainProvider: false` when we supply our own. **No Cesium ion token
required; no ongoing cost.**

**Bundle size:** `cesium` is a large package (~6 MB gzipped for the full
distribution). This is acceptable for a desktop Electron app where bundle size
has zero network cost — the app is served from the local file system.
However, Cesium requires copying its static assets (`/Build/Cesium/`) into
the Electron build. This is a one-time build configuration step (add a
`vite-plugin-cesium` or manual asset copy). Flag as a build-configuration
task in the phased plan.

### 4.2 CRS transform path

**Input:** TIN surfaces from the backend carry `vertices` as a flat array of
`[x_projected, y_projected, z_elevation_m]` triples in the project's native
CRS (Lambert72 EPSG:31370 for Belgium; RD New EPSG:28992 for Netherlands; set
by `project.default_horizontal_epsg` and `project.default_vertical_epsg`).

**Output needed by Cesium:** Cartesian3 ECEF positions (WGS84 ellipsoid).

**Transform path:**

```
[x_proj, y_proj, z_m]
  ↓ proj4 (existing `projectedToWgs84` in useWgs84.ts, cached)
[lat_wgs84, lng_wgs84]    (z stays in metres, no proj4 needed — z is ellipsoidal height
                           approximation: we use z directly as metres above ellipsoid;
                           the error vs geoid height is small for the elevation ranges
                           in typical geotech projects — a few metres over a few km)
  ↓ Cesium.Cartesian3.fromDegrees(lng, lat, z)
Cartesian3 ECEF
```

**Key details:**

- `projectedToWgs84` already handles both Lambert72 and RD New, is memoised
  per (epsg, x, y) pair, and is the exact same function used by MapView
  markers. Reuse it; do not write a parallel transform.
- Elevation: `z_m` from the TIN vertices is the project's vertical datum
  (typically Belgian Reference Datum TAW / EPSG:5710 for Belgium). The
  difference between TAW orthometric height and WGS84 ellipsoidal height over
  Belgium is approximately 42–47 m (geoid undulation N). For a 3D *visual
  viewer* where the goal is to see relative layer geometry, the offset does
  not matter — all formations shift together. A perfect geoid correction
  requires a geoid grid file (e.g. `BE2008.gtx`) and would add complexity
  with no visual benefit. **Decision: use `z_m` directly as ellipsoidal
  height.** The absolute elevation will be ~45 m too low in global terms, but
  all surfaces share the same offset so relative geometry is correct.
- For a future version where Cesium global terrain is draped (post-v1.0), the
  geoid correction becomes load-bearing and should be revisited then.

### 4.3 TIN surface rendering

`formation_surface` rows persist `vertices` (flat Float64 array, `[x, y, z,
x, y, z, ...]`) and `triangles` (flat Int32 array, `[i0, i1, i2, ...]`). This
is exactly the shape Cesium's `Geometry` API needs.

The render path:

1. For each formation with a non-stale surface, transform vertices via
   `projectedToWgs84` + `Cesium.Cartesian3.fromDegrees`.
2. Build a `Cesium.Geometry` with `attributes: { position: new
   GeometryAttribute({ componentDatatype: Float64, componentsPerAttribute: 3,
   values: transformedVertices }) }` and `indices: triangleArray`.
3. Wrap in a `Cesium.Primitive` with a `Cesium.MaterialAppearance` coloured by
   the formation's `color` (from `hashHexColor` or the stored formation
   colour). Set `translucent: true`, `alpha: 0.75` so overlapping surfaces
   are distinguishable.
4. Add to `viewer.scene.primitives`.

Stale surfaces: render at `alpha: 0.35` with a visual indicator (same
convention as the section canvas — the formation colour desaturated, a dashed
outline in 2D; in 3D, lower alpha suffices).

Formation rendering order: ascending `display_order` (older first, younger
on top). In 3D this is z-fighting territory for nearly-horizontal co-planar
surfaces. Offset each formation's vertices by a tiny `display_order * 0.01 m`
in the z direction to avoid z-fighting without visual distortion. This is a
well-known Cesium pattern for co-planar polygon stacks.

### 4.4 Basemap drape (current state)

Cesium ion is disabled (`Cesium.Ion.defaultAccessToken = ''`) — no globe tiles,
no terrain CDN. The basemap is **one** Geopunt orthophoto `GetMap` image for the
model footprint (WMS 1.1.1, `EPSG:31370`, long side capped at 2048 px), rendered
as a translucent textured mesh (`DEFAULT_BASEMAP_LID_ALPHA = 0.65`) so the
geology reads through it. Only Belgian Lambert-72 (`EPSG:31370`) projects get a
basemap; other CRSs get none. The footprint math + one-shot URL are the pure,
unit-tested `computeBasemapBounds` (`cesiumGeometry.ts`); `buildBasemapLid`
(`geology3DPrimitives.ts`) wraps it; `rebuildSurfacePrimitives` builds the
primitive.

**The image drapes on the ground surface so it follows the terrain**
(owner 2026-09-16, installer #41: "can't we make the basemap follow that
slope?"). When a DEM ground-surface TIN exists, `buildBasemapDrape` lifts every
ground vertex by `BASEMAP_LID_ABOVE_GROUND_M` (0.5 m — clear of the translucent
ground sheet and the subsurface formation tops without floating) and textures it
by each vertex's position inside the WMS footprint (`u` west→east, `v`
south→north). On a sloped site the aerial follows the relief instead of floating
above the low end and cutting through the high end. The ground TIN carries bed
overrides (dredged areas) in its z, so the drape follows those too (the aerial
shows the water surface there, which is correct).

**No DEM → flat-lid fallback.** With no ground surface the basemap is a flat
textured quad at the ground level at the investigations
(`lidElevationAtInvestigations`, the highest ground sampled under any
investigation + 0.5 m; a fallback to the highest surface vertex when no
investigation lands on the TIN). The fence cutout (`UnitFenceScene`) passes
`groundSurface={null}` deliberately (B6a) and always renders the flat lid from
the wall-panel footprint.

Both forms are one textured triangle soup, so the **split view** clips them the
same way — `clipTexTrisToHalfSpace` slices the aerial into each half along the
user's split plane (st lerped by the same `t` as the position, so the image
stays georeferenced across the cut).

### 4.5 Orbit/pan/zoom

`CesiumWidget` (and `Viewer`) provide orbit/pan/zoom out of the box via
`ScreenSpaceCameraController`. No custom implementation needed. The default
controls (left-drag orbit, right-drag pan, scroll wheel zoom) match typical
3D tool conventions (Plaxis 3D, AutoCAD 3D).

One Cesium default to suppress: `Cesium.Ion.defaultAccessToken = ''` and
`terrainProvider: new Cesium.EllipsoidTerrainProvider()` (flat earth, no
Cesium ion terrain). Set these at widget construction time.

### 4.6 Split-viewport mechanic

**The requirement:** the user draws a line; the canvas splits into two
independent 3D viewports, each showing the model sliced along that line; each
viewport pans/orbits independently; Reset collapses back to one viewport.

**Options:**

**Option S1: Two CesiumWidget instances, shared scene primitives, clipping planes.**

Two separate `CesiumWidget` instances rendered side by side in the React DOM.
Each widget gets its own `Scene` and `Camera`. The TIN surface primitives are
added to both scenes. A `ClippingPlaneCollection` is applied to each scene's
primitives: left viewer clips away everything on the right of the split line;
right viewer clips away everything on the left.

The split line is drawn by the user in the 3D scene (click two points →
defines a vertical plane through those two points in world coordinates →
`Cesium.Plane` from normal + point → `ClippingPlane`).

Independent cameras: each `CesiumWidget` has its own `ScreenSpaceCameraController`
— they are already independent by construction.

Pros: Cesium's intended multi-view pattern. `ClippingPlaneCollection` is a
first-class API with good documentation. Camera independence is automatic.

Cons: Two Cesium WebGL contexts in one Electron window. The Electron GPU
process shares one GPU; two WebGL contexts is standard (any web app with two
canvas elements does this) but it doubles the texture memory budget for the
tile layers. At typical project scale (hundreds of investigations, TIN surfaces
of a few hundred KB), this is not a concern — but it should be stated as a
trigger to revisit if users hit memory pressure.

**Option S2: Single CesiumWidget, two synthetic "cameras" via scissor rect.**

One Cesium scene; the renderer scissor-rects the viewport into two halves;
two cameras orbit independently within each scissor region. This is a
documented Cesium multi-view pattern (`scene.useDepthPicking` + scissor API)
but it requires lower-level Cesium scene manipulation and is harder to
implement correctly with independent ScreenSpaceCameraController instances.

Pros: One WebGL context, lower memory.

Cons: Significantly higher implementation complexity. Cesium does not expose a
clean "two cameras, one scene" API — the scissor approach is a workaround that
requires hacking the render loop. The documented example in Cesium's codebase
(the "Multiple Views" demo) is not production-stable.

**Recommendation: Option S1 (two CesiumWidget instances).**

The implementation complexity of Option S2 is disproportionate to the memory
savings. For a typical geotech project (a few dozen CPT/borehole locations, TIN
surfaces in the hundreds of KB range), two WebGL contexts is perfectly safe
on any modern Windows laptop. The performance posture (no premature
optimisation) supports this: profile only if users report memory pressure.

The component structure for the split mode:

```tsx
// Geology3DViewer.tsx

interface Geology3DViewerProps {
  splitMode: 'single' | 'split'
  splitPlane: Cesium.Plane | null     // null when splitMode === 'single'
  formations: GeologicalFormationResponse[]
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  activeBasemap: BasemapSource
  projectEpsg: number
}

// Single mode: renders one CesiumWidget, full-width canvas.
// Split mode: renders two CesiumWidget instances side by side,
//             each with a ClippingPlaneCollection for the opposite half.
```

The split plane is defined by the user drawing a line segment in the 3D scene.
The draw interaction is a simple two-click flow: after the first click, a
preview line follows the cursor; second click confirms. The line segment maps
to a vertical `Cesium.Plane` in ECEF space (normal perpendicular to the line
in the horizontal plane, infinite vertical extent). This is distinct from the
2D section line drawing in the Sections stage (which stores lat/lng endpoints
in the DB). The 3D split line is **session-ephemeral** — it is not persisted
to the bundle, not tied to the section model, and is not a cross-section.

### 4.7 3D split-line relationship to the Sections cross-section model

**Are they the same thing?**

No. They are different operations at different fidelities:

| | Section (Sections stage) | 3D split line (Geology stage) |
|---|---|---|
| Purpose | Contact editing surface | Visual inspection tool |
| Persistence | DB + bundle | Session-ephemeral |
| Geometry | Two lat/lng endpoints stored per project | A plane in 3D space computed on-the-fly |
| Editing | Contacts placed on it, exported | No contacts, not exported |
| Output | DXF, Plaxis | None |

**Should the 3D split line tie to the section model (auto-create a section)?**

Not for v1.0. The user flow is different: in the Sections stage, the engineer
creates a section to edit contacts. In the Geology 3D viewer, the user draws
a split line to visually inspect the model. Forcing them to be the same object
adds coupling that doesn't serve either workflow — the section line has
endpoint constraints (must pass through or near investigations), while the 3D
split line should be freely drawable for inspection.

Post-launch enhancement option: "Send to Sections as a new cross-section"
button when a 3D split is active. This would create a cross-section record
from the split line's projected endpoints. Deferred — not v1.0.

**Recommendation:** the 3D split line is view-only, session-ephemeral, and
independent of the section model. State it explicitly in a code comment when
the split mechanic is implemented.

### 4.8 Performance posture

The project's performance rules are explicit: no premature optimisation; Python
+ existing tools first; profile before abstracting. The same applies to the
3D viewer.

**Real risks at typical project scale:**

| Risk | Realistic trigger | At typical scale | Response |
|---|---|---|---|
| Two Cesium contexts memory pressure | Large tile cache × 2 scenes | Not a concern for 100–500 investigations | Monitor; revisit if user reports >4 GB GPU RAM |
| Large TIN vertices array | Very dense contact grid | 500 contacts → ~500-pt TIN → ~6 KB vertices | Fine; the benchmark shows 500-contact TIN computes in 2.6 ms |
| Vertex transform (proj4) at load | First render of a large model | 500 contacts × proj4 (memoised) → fast | Memoised in `projectedToWgs84`; no issue |
| Cesium tile fetching on slow network | Remote tile servers during offline use | All basemap providers are external; offline mode needs local tiles | Document: 3D viewer basemap requires network; offline → blank background |

**When to revisit:** when a user reports the 3D viewer is slow on a real
project that is substantially larger than the current benchmark scope (hundreds
of investigations). At that point, profile the Cesium render loop and the
vertex transform separately before any change.

**What is NOT a concern now:**

- WebAssembly compilation of Cesium (it doesn't use WASM).
- The TIN geometry size: debt #19 (bundle size cap) is already tracked; the
  TIN vertices are the same data whether rendered in 2D or 3D.
- Free-threaded Python (the 3D viewer is pure frontend; Python performance
  does not affect it).

---

## 5. Phased build plan

Phases are independently shippable (green suite at every commit). The
functional core (G1–G4) must land before the 3D viewer (G5+) because:

1. G1–G4 unblock the Sections "Seed" action, which is currently explicitly
   disabled and tied to a code comment pointing at this design.
2. G1–G4 resolve debt #14 (Sidebar overhaul), which has been open since the
   shell rework and is a dogfooding friction item.
3. G5+ is the 3D viewer — higher risk, novel, and not MVP-gate-critical per
   the CLAUDE.md build sequence.

### Phase G1 — GeologyToolbar + GeologyInspector (functional core, day 1)

**(Revised by §10 — Fork E. The Fill-from-boreholes verb now opens a curated
selection dialog rather than calling auto-populate directly. Commits G1.1 and
G1.3 carry the new actions and dialog; see §10 for all signatures.)**

**Risk: low-medium.** `handleDeleteModel` and the inspector migration are low
risk (existing logic moved). `discoverBoreholeFormations` + `FormationSelectionDialog`
+ `applyBoreholeFormationSelection` (with delete-the-rest and its confirm gate)
are net-new logic.

Each commit is one file:

1. `feat(geology): add discoverBoreholeFormations + applyBoreholeFormationSelection to useGeologicalModel`
   - Adds two new actions to `UseGeologicalModelResult`:
     `discoverBoreholeFormations(boreholeIds): Promise<FormationCandidate[]>`
     and `applyBoreholeFormationSelection(selectedNames, allCandidateNames, boreholeIds): Promise<void>`.
   - `discoverBoreholeFormations` calls the new additive backend endpoint
     `POST /projects/{pid}/geology/models/{mid}/contacts/discover-from-stratigraphy`
     (body: `{borehole_ids:[...]}`, response: `{candidates:[{name,borehole_count}]}`).
     Returns candidate list only — no DB mutation, nothing created.
   - `applyBoreholeFormationSelection` calls
     `handleAutoPopulateFromStratigraphy(boreholeIds)` for the selected names
     only, then calls `DELETE /formations/{fid}` for every current formation
     whose name is not in the selected set. The confirm gate lives in the
     calling dialog. See §10.3 for exact signatures and edge cases.

2. `feat(geology): add handleDeleteModel to useGeologicalModel`
   - Adds `handleDeleteModel: () => Promise<void>` to `UseGeologicalModelResult`
     interface and implements it in `useGeologicalModel.ts`. Calls
     `DELETE /projects/{pid}/geology/models/{mid}`, clears local state,
     fires `removeFromManifest` for all formation ids.

3. `feat(geology): add FormationSelectionDialog`
   - New file: `shell/stages/geology/FormationSelectionDialog.tsx`.
   - Modal: candidate checklist with select-all/none, delete-the-rest warning
     copy, confirm/cancel per the UX rule. See §10.4 for full dialog spec.

4. `feat(geology): add GeologyToolbar with Fill, Build, Dedupe, Reset, Delete model verbs`
   - New file: `GeologyToolbar.tsx`. "Fill from boreholes" calls
     `discoverBoreholeFormations` then opens `FormationSelectionDialog`; on
     confirm calls `applyBoreholeFormationSelection`.
     `handleRebuildSurfaces`, `handleDedupeContacts`, `handleDeleteModel` wired.
     Reset is a stub (disabled) until G5.
   - The `PrimaryToolbarButton` / `ToolbarButton` pattern is the same shape
     as `SectionsToolbar.tsx`. Do not extract yet — the rule says "extract on
     the third copy"; Export stage toolbar is the third.

5. `feat(geology): add GeologyInspector migrating InterpretationPane content`
   - New file: `GeologyInspector.tsx`. Extracts formation list + drag-reorder
     + delete confirm + borehole scope + crossings banner from
     `InterpretationPane.tsx`. Wires from `useShell()` rather than props.
   - `InterpretationPane.tsx` is NOT deleted yet — see G4.

6. `feat(geology): replace GeologyStage stub with functional toolbar + inspector`
   - Updates `GeologyStage.ts` to swap `GeologyToolbar` and `GeologyInspector`
     into the descriptor.
   - `GeologyCanvas.tsx` still renders the "coming soon" fallback — that is
     G2.

7. `test(geology): add GeologyStage.test.tsx smoke render`
   - Mirrors `SectionsStage.test.tsx`. Mounts GeologyStage zone components
     with a stub ShellContext; asserts no crash, no TDZ.

### Phase G2 — GeologyCanvas 2D plan view (functional core, day 2) *(superseded)*

**Superseded 2026-05-16 (build pass).** The MapView fallback was replaced with
a clean empty-state message (Mountain icon + contextual guidance) so the Geology
stage no longer shows a read-only map. GeologyCanvas renders either the Cesium
3D viewer (when surfaces exist) or the empty-state. The MapView plan view described
below was shipped briefly then removed; the commit that replaced it is
`fix(geology): replace 2D map fallback with empty-state message`.

~~**Risk: low.** MapView is already used by both DataCanvas and SectionsCanvas.~~

~~1. `feat(geology): replace GeologyCanvas placeholder with MapView plan view`~~
   ~~- Updates `GeologyCanvas.tsx` to render `<MapView>` in read-only mode~~
     ~~(no CPT/borehole selection wiring, no import bbox drawer).~~
   ~~- Passes `cpts`, `boreholes`, `sections`, basemap, map state from~~
     ~~`useShell()`.~~
   ~~- Sections canvas shows no investigation selection from this view by~~
     ~~design (see section 3.6).~~

2. `feat(sections): un-gate Seed from stratigraphy in SectionsToolbar`
   - Removes the disabled no-op from `SectionsToolbar.tsx` and wires
     `handleAutoPopulateFromStratigraphy` as the Seed action.
   - Updates the code comment to explain the Geology/Sections contract.
   - This is the concrete deliverable that makes the define→seed→build
     workflow end-to-end.

### Phase G3 — Sidebar / InterpretationPane retirement (debt #14 resolution)

**Risk: low.** Pure UI cleanup.

1. `chore(sidebar): hide Interpretation tab now that GeologyInspector ships`
   - Sets the Interpretation tab in Sidebar.tsx to display:none or removes
     it from the tab array. The tab's JSX and `InterpretationPane` import
     stay in the file but are not reachable.

2. `chore(sidebar): remove InterpretationPane wiring from App.tsx`
   - Removes all `InterpretationPane` prop wiring from App.tsx (the `onFormationCreated`,
     `onRebuildSurfaces`, etc. callbacks that were passed down).

3. `chore(sidebar): delete InterpretationPane.tsx and Sidebar Interpretation tab`
   - Deletes `InterpretationPane.tsx`.
   - Deletes the Interpretation tab entry from Sidebar.tsx.
   - Verifies no import of `InterpretationPane` remains (grep before commit).

4. `docs(debt): resolve debt #14 — Sidebar overhaul`
   - Deletes debt #14 from `docs/debt.md`.
   - Updates CLAUDE.md "Debt #14" reference in the Appendix of
     `ui-shell-architecture.md`.

### Phase G4 — Polish and integration (functional core complete)

1. `feat(geology): add amber unsaved markers to GeologyInspector formation rows`
   - Wires `sessionImportFormationIds` to formation row `DirtyAsterisk`.

2. `feat(geology): apply semantic color tokens to all Geology stage components`
   - Sweeps `GeologyToolbar.tsx`, `GeologyInspector.tsx`, `GeologyCanvas.tsx`
     for raw palette classes and replaces with semantic tokens. Mirrors the
     S5 token pass on the Sections stage.

3. Dogfood on a real project. Adjust before moving to G5.

### Phase G5 — Cesium integration (3D viewer, day 3)

**Risk: MEDIUM-HIGH.** First use of Cesium in the project. Build configuration
is the main unknown.

1. `chore(deps): add cesium npm package and configure vite-plugin-cesium`
   - `npm install cesium` in `desktop/`.
   - Configure Vite to copy Cesium static assets (`/Build/Cesium/`) to the
     Electron app's output. `vite-plugin-cesium` is the standard approach;
     verify it works with the current `@electron-toolkit/vite` setup.
   - Add `CESIUM_BASE_URL` Vite define so Cesium's worker scripts resolve
     correctly from the Electron local file URL.
   - Verify: `npm run dev` launches without Cesium worker 404 errors.
   - **This commit may require iteration.** Flag it as the highest-risk
     single step in the 3D build.

2. `feat(geology): add Geology3DViewer component (single-viewport, formations only)`
   - New file: `Geology3DViewer.tsx`. Creates one `CesiumWidget` instance.
   - No imagery provider (configure later), flat `EllipsoidTerrainProvider`.
   - Renders TIN surfaces for all non-stale formations with colour from
     `hashHexColor`.
   - Transform vertices via `projectedToWgs84` (imported from `useWgs84.ts`).
   - Fly camera to bounding box of all vertices on first mount.

3. `feat(geology): replace GeologyCanvas 2D plan view with Geology3DViewer`
   - Updates `GeologyCanvas.tsx` to render `<Geology3DViewer>` when an active
     model with at least one non-stale surface exists; falls back to the MapView
     plan view when no surfaces exist yet.

4. `feat(geology): add active basemap tile layer to Geology3DViewer`
   - Adds `UrlTemplateImageryProvider` (or `WebMapTileServiceImageryProvider`
     for Geopunt WMTS KVP) wired from `useShell().mapState.activeBasemapId`.
   - Verify each basemap source renders correctly in Cesium (tile order, URL
     template compatibility).

5. `feat(geology): un-stub Reset view button in GeologyToolbar`
   - Wires Reset to fly the Cesium camera back to the model bounding box.

### Phase G6 — Split-viewport (3D viewer, advanced)

**Risk: HIGH.** Two WebGL contexts, Cesium ClippingPlane API, custom draw
interaction. Only begin if owner confirms this is in v1.0 scope (see section 6).

1. `feat(geology): add split-line draw interaction to Geology3DViewer`
   - Two-click draw flow in the Cesium scene. Emits a `Cesium.Plane` in ECEF
     from the drawn line segment.

2. `feat(geology): add split-viewport mode to Geology3DViewer`
   - When `splitMode === 'split'`, renders two `CesiumWidget` instances side
     by side. Each receives a `ClippingPlaneCollection` for the opposite half.

3. `feat(geology): wire split-viewport Reset to GeologyToolbar`
   - Un-stubs the Reset verb; collapses two widgets back to one.

4. `feat(geology): un-stub Delete model in GeologyToolbar`
   - The Delete model verb was stubbed (disabled) until the 3D viewer existed
     to show a meaningful canvas to return to after deletion. Un-stub it now
     that the canvas degrades gracefully (falls back to MapView when no surfaces
     exist).

---

## 6. The v1.0 scope fork — owner must decide

The CLAUDE.md v1.0 MVP gate is: "geological model + geotech subdivision
structure + cross-sections + DXF/Plaxis exports." The 3D viewer appears as
"geographic context" in the Tech Stack table and is ranked as a v1.0
essential in `project_remaining_v1_essentials` memory. But the split-viewport
sophistication is not in the MVP gate definition.

The three options, with honest trade-offs:

### Option V1: Full spec for v1.0 (phases G1–G6)

**What ships:** Functional core (formations, Build, Seed fix) + 3D viewer with
basemap drape + orbit/pan/zoom + split-screen with user-drawn split line.

**Benefit:** The 3D split-screen is a genuine product differentiator. gINT
does not have it. D-Series does not have it. Plaxis 3D has 3D views but not
integrated in a ground-model tool with DOV data and a cross-section editor.
If the 90-second demo video includes the 3D split, it is visually compelling.

**Cost:** G5 (Cesium integration) is medium-high risk; G6 (split-viewport) is
high risk. Two unknowns: (1) Cesium build configuration in Electron; (2)
`ClippingPlaneCollection` correctness with the project's CRS transform path.
Risk materialises as build delays, not data loss (the functional core is
unaffected if G5/G6 slip).

**Recommendation if chosen:** time-box G5 to 2 days. If the Cesium build
configuration is not working cleanly at the end of day 2, cut to Option V2.

### Option V2: Single-viewport 3D for v1.0, split-screen as fast-follow (G1–G5, defer G6)

**What ships for v1.0:** Functional core + 3D viewer (single viewport, basemap
drape, orbit/pan/zoom). No split-screen.

**Benefit:** G5 is medium-high risk but the fallback on failure (MapView 2D plan
view) is always there. G6 (split-viewport) is the highest-risk, most-novel part
and can ship as a post-launch update — it does not gate any other feature.

**Cost:** The demo is less visually dramatic. "3D view of the model" is table
stakes for modern geotech tools; "3D split-screen along a drawn line" is the
differentiator. Deferring G6 loses that angle on launch day.

**Recommendation:** this is the safer choice for a solo dev with a hard launch
deadline. The 3D viewer (G5) adds value on its own; G6 is a refinement.

### Option V3: 3D viewer entirely post-v1.0 (G1–G4 only)

**What ships for v1.0:** Functional core (formations, Build, Seed fix, 2D plan
view). No 3D.

**Benefit:** Lowest risk. G1–G4 are all migrations of existing code — no new
libraries, no build-config unknowns. The v1.0 MVP gate (layer geometry +
sections + exports) is fully satisfied without any 3D.

**Cost:** The demo video has no 3D. For the BE/NL consultancy market where
gINT is the incumbent (which has no 3D at all), even a basic 3D view is a
differentiator. Cutting it entirely may weaken the first impression on a cold
prospect.

**Recommended option: V2.** The functional core (G1–G4) must ship for the
Seed contract fix. The single-viewport 3D viewer (G5) is achievable and
adds genuine value. The split-screen (G6) is the owner's call based on
remaining timeline after G5 is assessed.

**The owner must decide.** The architectural design is the same for all three
options — the phasing is simply how far to go before the v1.0 gate closes.

---

## 7. Genuine decision forks — owner must resolve

### Fork A: 3D viewer scope (V1 / V2 / V3)

**(RESOLVED 2026-05-15 — owner chose V1: full 3D scope including split-screen
for v1.0. Phases G1–G6 all in scope. No design change to §4 or §5 G5–G6 needed
beyond noting V1 is confirmed.)**

### Fork B: CesiumJS build configuration in Electron

`vite-plugin-cesium` is the standard path for Vite + Cesium. The project uses
`@electron-toolkit/vite` (per the Electron + React + Vite setup). The
compatibility between these two plugins must be verified before G5 commits.

**Verify in a throwaway branch:** `npm install cesium vite-plugin-cesium`,
add the plugin to `vite.config.ts`, launch `npm run dev`, check that Cesium
worker scripts load from the `file://` protocol that Electron uses. If this
fails, the fallback is a manual Cesium asset copy step in the Electron builder
config (known-good pattern, documented in the Cesium GitHub issues).

**Decide:** is `vite-plugin-cesium` compatible with this setup, or does it
require a manual approach? Block G5 commit 1 on this answer.

### Fork C: Geopunt WMTS in Cesium

The Geopunt WMTS KVP URLs (`geo.api.vlaanderen.be/OMWRGBMRVL/wmts?...`) may
need `WebMapTileServiceImageryProvider` rather than `UrlTemplateImageryProvider`
because they use KVP syntax with explicit `TILEROW`/`TILECOL` parameters, not
a simple `{z}/{x}/{y}` template. The other basemaps (CARTO, Esri, OSM) are
standard XYZ and work with `UrlTemplateImageryProvider`.

**Decision needed in G5 commit 4:** test each basemap source against Cesium's
imagery providers and pick the correct provider class per source. The
`BasemapSource` type may need a `cesiumProviderType: 'xyz' | 'wmts'` field to
drive the right provider instantiation.

### Fork D: Offline mode + 3D

The 3D viewer's basemap requires live tile fetching from external providers.
In offline mode (on-site laptop without internet), the viewer would show
surfaces against a blank globe. This is acceptable for v1.0 (the user still
sees the 3D model geometry), but it should be explicitly documented.

**Decide:** is the offline case acceptable with a blank basemap, or should the
2D MapView fall back automatically when network is unavailable? The fallback
logic is not complex (detect tile fetch failure → switch to fallback mode) but
adds state to `GeologyCanvas`. **Recommendation:** blank globe is acceptable
for v1.0 with a tooltip explaining it; auto-fallback is a post-launch
enhancement.

### Fork E: GeologyInspector — reorder vs separate "keep" toggle

**(RESOLVED 2026-05-15 — see §10 for the full design.)**

The owner resolved this as: "Fill from boreholes" is a **curated selection
dialog**, not a hide toggle. Unselected formations are DB-deleted ("the rest
doesn't matter anymore and is deleted"). There is no per-formation hide toggle
on formations. The `hidden_formation_ids` view_state field described in
Interpretation 2 is NOT needed and NOT being added.

The full resolved design — discovery endpoint, dialog shape, delete-the-rest
safeguard, re-run idempotency, and hook contract — is specified in §10.

---

## 8. Risks and explicit non-goals

### 8.1 Top risks

**Risk 1 — Cesium build configuration fails in Electron (HIGH probability,
MEDIUM severity).**
Cesium's worker scripts use `importScripts` paths that must resolve from the
Electron `file://` protocol. `vite-plugin-cesium` may not handle this out of
the box; manual `CESIUM_BASE_URL` configuration is the known fix but requires
knowing the correct Vite define path. Mitigation: prototype G5 commit 1 in a
throwaway branch before committing to the G5 phase. If the config fails, the
fallback (MapView 2D plan view) is always available — the functional core is
unaffected.

**Risk 2 — Split-viewport ClippingPlane precision near the project CRS origin
(MEDIUM probability, LOW severity).**
The ECEF coordinates of a Belgian site are in the range `[3.5e6, 5.0e6,
3.2e6]` metres. Cesium's `ClippingPlane` operates in ECEF space and should
handle this without precision loss (`float64` is used throughout). The risk is
that the clipping plane's normal calculation from a user-drawn line segment in
ECEF is numerically sensitive if the line is very short or nearly vertical.
Mitigation: enforce a minimum line length in the draw interaction (e.g. 10 m
projected); reject vertical lines.

**Risk 3 — GeologyInspector TDZ during InterpretationPane content extraction
(LOW probability, HIGH severity if it hits).**
`InterpretationPane.tsx` has `reorderFormations` declared as a `useCallback`
that closes over `manifestFormationIds`, `formations`, and `onFormationUpdated`
— it cannot read `visibleFormations` (declared later in the component body)
without TDZ. This is explicitly documented in a code comment inside
`InterpretationPane.tsx`. `GeologyInspector.tsx` must maintain this ordering
constraint when the logic is re-homed. Mitigation: the smoke test covers mount
TDZ; add a specific test that covers the drag-reorder callback before
committing G1 commit 3.

**Risk 4 — Sections "Seed" un-gate changes user expectations (LOW probability,
MEDIUM severity).**
Currently "Seed from stratigraphy" is visually greyed out and users expect it
to do nothing. Un-gating it calls `handleAutoPopulateFromStratigraphy`, which
creates contacts from borehole stratigraphy. If the user runs it on a project
that already has contacts, it may create duplicates. The dedupe action exists
for this; the Seed button tooltip should explain "places contacts from borehole
observations for defined layers — run Dedupe if duplicates appear." The
existing `handleDedupeContacts` is the safety net.

### 8.2 Explicit non-goals

**Not implementing per-layer parameters.** Formation colours, names, and
display order are the only formation properties touched here. Unit weights,
friction angles, cohesion — Phase 5.

**Not implementing G3Dv3 import.** The stratigraphy catalog exists; the
"Fill from boreholes" action in this design seeds from DOV observation
stratigraphy. G3Dv3 import is a separate post-v1.0 or alongside-launch item.

**Not implementing the geotechnical stage.** Debt #13 (geotechnical units in
section editor). Phase 5.

**Not implementing the Export stage.** The Plaxis 3D export verb remains in
the Sections toolbar for now. It moves to the Export stage when that stage is
built (Phase 4 follow-on, separate scope).

**Not changing the backend (except one additive discovery endpoint).** All
mutation endpoints exist. `handleDeleteModel` calls `DELETE /projects/{pid}/geology/models/{mid}`
which is in the catalogue. The curated Fill flow (§10 — Fork E) requires one
new endpoint: `POST /projects/{pid}/geology/models/{mid}/contacts/discover-from-stratigraphy`.
This is an additive addition — read-only dry-run, no side effects, returns
candidate formation names. Per CLAUDE.md's additive-only API rule this is
permitted; it is stated explicitly here because the original non-goal said "no
new endpoints", which §10 corrects.

**Not changing .gmproj format.** Fork E resolved to curated delete, not a
hide toggle. No `hidden_formation_ids` field. The format stays v3 with zero
changes — the Fill dialog creates and deletes existing formation + contact rows;
no new persisted field is introduced. See §10.6 for the explicit confirmation.

**Not pre-building kriging or RBF surfaces.** The `method` query param on the
rebuild endpoint is scaffolded for future interpolation methods; G1–G6 all use
`method=tin` (the v1.0 enforced method). No Phase 5 interpretation is
pre-built here.

---

## 9. Debt updates

When the Geology stage ships (G1–G4), update `docs/debt.md`:

**Resolve debt #14 (Sidebar UI overhaul):** delete the entry when G3 commit 3
(delete `InterpretationPane.tsx`) ships.

**Resolve debt #25 (SectionsInspector section rows lack amber asterisk):** this
is a partial resolution candidate — once Sidebar.tsx's section list is retired
(G3), the SectionsInspector becomes the sole section list surface and the amber
marker must be wired. The debt comment in `SectionsInspector.tsx` already
says "when Sidebar.tsx's section list is retired." Wire `sessionImportSectionIds`
through the `coordinator` slice of the bus (the pattern used for
`sessionImportCptIds` and `sessionImportBoreholeIds`) and delete the stub
`new Set<string>()` in `SectionsInspector`. Resolve debt #25 in the same G3
commit that retires Sidebar's section list.

**Add new debt item for the 3D split-screen offline fallback** (if the owner
picks V1 or V2 and the blank-globe offline case is accepted as known
degradation):

```
## [NEW] 3D viewer — blank basemap in offline mode (low)

What. When no network is available, the Cesium tile layers return 404 errors
and the 3D canvas shows formation surfaces against a blank black globe. The
surfaces are still correct; only the geographic context is missing.

Why deferred. Implementing auto-fallback to the 2D MapView on tile failure
requires detecting all tile provider failures and toggling the canvas, adding
state that complicates GeologyCanvas. At v1.0, the offline case is documented
as known degradation.

When to revisit. First time a real user reports frustration with the blank
globe during on-site offline use. Fix shape: `ImageryLayer` error events →
set `offlineFallback: true` state → render MapView instead of Cesium.
```

---

## 10. Addendum — Fill-from-boreholes is a curated selection dialog (Fork E resolved 2026-05-15)

**Cross-references:** patches §2 table row "Choose which formations to keep",
§2 "Seed action closure", §3.4 verb 1, §5 Phase G1, §7 Fork E, §8.2 "Not
changing the backend" and ".gmproj format". Those sections now carry
"(superseded by §10)" notices inline. This section is the single authoritative
source for the Fill-from-boreholes design.

---

### 10.1 Discovery without commit

**Decision: a backend endpoint is required.** Pure frontend derivation is not
feasible.

The reason is grounded in what the code actually holds. `useInvestigationData`
maintains `boreholes: BoreholeListItem[]` (the list-level type) and a
`boreholeDetailMap: Map<string, BoreholeDetailResponse>`. The list type
(`BoreholeListItem`) carries only header fields — name, location, depth,
drill method. It does NOT carry `observations`. The `BoreholeDetailResponse`
shape (which includes `observations: ObservationResponse[]` with their
`layers[].description`) only lands in `boreholeDetailMap` for boreholes the
user has clicked open in the Data stage. In a project with 50 boreholes, the
user may have opened 2; the other 48 have no detail loaded.

The frontend cannot derive candidate formation names from observation
stratigraphy without either (a) eagerly loading all borehole details (expensive,
changes the existing data model), or (b) asking the backend to scan.

**Required additive endpoint:**

```
POST /projects/{pid}/geology/models/{mid}/contacts/discover-from-stratigraphy
Body:  { borehole_ids: string[] }   // 1..500, same limits as auto-populate
Response: {
  candidates: Array<{
    name: string            // display name — FORMAL counterpart description when
                            // the observation is formal-stratigraphy, else the
                            // INFORMAL description itself
    regional_ref: string | null   // formal stratigraphy code (e.g. "HyEg") when
                                  // the observation is formal; null for informal
    key: string             // stable identity: regional_ref when present, else
                            // name. Two boreholes that share the same regional_ref
                            // but use different working names produce ONE candidate
                            // keyed on that ref.
    borehole_count: number  // how many of the supplied boreholes have this key
  }>
}
```

This endpoint is **read-only** — it performs the same scan as the existing
`auto-populate` backend but returns candidate names only, creating nothing. It
reuses the exact same parser logic on the backend (FORMAL_STRATIGRAPHY
preferred, INFORMAL_STRATIGRAPHY fallback, surface layers skipped). No DB
mutation; no transaction needed; 200 always.

**Reconciliation with §8.2 "Not changing the backend" non-goal.** That
non-goal was written before this fork was resolved and assumed the one-click
model. It is now corrected by §8.2's inline note and confirmed here: one new
additive endpoint is required. Per CLAUDE.md's additive-only API rule, adding
a new endpoint is always permitted — the rule forbids removing or repurposing
existing fields, not adding endpoints. The non-goal is revised to "no
migrations, no breaking API changes."

---

### 10.2 Delete-the-rest is destructive — safeguard design

**The threat:** every time the dialog is confirmed, every formation currently
in the model whose name is NOT in the selected set will be DB-deleted
(cascading contacts). If the user had placed manual contacts on a formation
that is now unselected, that data is gone.

**The confirm gate (per CLAUDE.md irreversible-action rule):**

The `FormationSelectionDialog` must:
- Show a summary before the "Apply" button becomes active:
  - If any current formations (with their contacts) would be deleted:
    `"N formation(s) and M contact(s) will be permanently deleted."`
    where N is the count of current formations not in the selection and M is
    the sum of their contact counts (derivable from the local `contacts` list
    which is already loaded on the bus).
  - If no deletions would occur (first run or re-run adding formations only):
    show no warning; the confirm button is an ordinary accent button.
- The confirm button text is `"Apply selection"`, never `"OK"`.
- The cancel button has default focus when the destructive warning is shown.
  When no warning (zero deletions), the confirm button may take default focus.
- The destructive-warning row uses `text-red-600` or the semantic danger token,
  consistent with the formation delete confirm in `GeologyInspector`.

**Does delete-the-rest apply on every run?**

Yes, on every run. The model must end up containing exactly the selected
formations and no others. This is the owner's explicit intent: "the rest
doesn't matter anymore and is deleted." There is no "first-run-only" special
case.

**Re-run behaviour and idempotency:**

When the dialog is opened on a model that already has formations (from a
previous Fill run or from manual creation):

- The dialog pre-checks every formation currently in the model whose name
  appears in the candidate list. Formations the user added manually (not in
  the candidate list) are NOT shown in the dialog — they exist in the model
  but the dialog has no knowledge of them from the discovery scan.
- **Sharp edge — manually-added formations not in the candidate list:**
  If the user created a formation manually (e.g. "Holocene Fill") that was not
  derived from any borehole stratigraphy observation, it will NOT appear in the
  candidate list. On confirm, `applyBoreholeFormationSelection` deletes every
  current formation whose name is NOT in the selected set. "Holocene Fill" is
  not in the selected set (it was never a candidate), so it gets deleted.
  This is the correct and intended behaviour: "Fill from boreholes" is a
  destructive replace operation on the model's formation set. The confirm
  dialog's `"N formation(s) and M contact(s) will be permanently deleted"`
  copy must count these manually-added formations in its N and M totals — the
  count comes from diffing `geoModel.formations` against the selected names,
  which will naturally include any manually-added formations not in the
  candidate list.
  **Sharp-edge note on stable-key identity.** Pre-check and deletion both use
  the same stable key: `regional_ref ?? name` (lowercased for comparison).
  `regional_ref` is the formal stratigraphy code from DOV (e.g. `"HyEg"`); for
  informal-only descriptions the key falls back to the display name. The
  server derives this key via `_derive_layer_names_and_key()` during `execute()`
  and during `scan_stratigraphy_candidates()` — the same function in both paths
  guarantees the key the dialog receives equals the key the server will use when
  creating/matching formations.

  **The build agent must not filter the deletion set to only candidate-named
  formations. The delete-the-rest set is every formation in the current model
  whose stable key (`regional_ref ?? name`) is not in the user's selected-key
  set, regardless of whether it appeared in the candidate list.**

---

### 10.3 Bus / hook contract

Two new actions added to `UseGeologicalModelResult` in `useGeologicalModel.ts`.
Both are additive — no existing action is removed or renamed.

```typescript
/** A candidate formation identity discovered from borehole stratigraphy. */
export interface FormationCandidate {
  /**
   * Display name — FORMAL counterpart description when the observation uses
   * formal stratigraphy, else the INFORMAL description itself.
   */
  name: string
  /**
   * Formal stratigraphy code when the observation is formal (e.g. "HyEg");
   * null for informal-only descriptions. Two boreholes with the same
   * regional_ref but different working names share one candidate row.
   */
  regional_ref: string | null
  /**
   * Stable identity key: regional_ref when present, else name.
   * This is the value passed to the server in selected_keys on confirm.
   * Derived by _derive_layer_names_and_key() — guaranteed equal to the
   * key the server uses in execute() so discover and execute never diverge.
   */
  key: string
  /** Number of in-scope boreholes that carry this stable key. */
  boreholeCount: number
}

// Add to UseGeologicalModelResult:

/**
 * Scan the given boreholes' stratigraphy for candidate formation identities.
 * Read-only — nothing is created. Returns the candidate list for the
 * FormationSelectionDialog to render.
 *
 * Calls POST /projects/{pid}/geology/models/{mid}/contacts/discover-from-stratigraphy.
 */
discoverBoreholeFormations: (
  boreholeIds: readonly string[]
) => Promise<FormationCandidate[]>

/**
 * Apply the user's curated selection:
 *   1. POST auto-populate with selected_keys so the server creates formations
 *      + contacts for the selected stable keys only (server-side filter —
 *      unselected keys are never created, so there is nothing to clean up).
 *      Idempotent — existing rows are skipped; orphaned FormationContactOrm rows
 *      with NULL observation_layer_id are purged before the idempotency index
 *      is built so prior failed runs cannot permanently suppress re-creation.
 *   2. Refetch the formation list fresh (never filter a stale closure).
 *   3. Delete every formation in the fresh list whose stable key
 *      (regional_ref ?? name, lowercased) is NOT in selectedKeys. Deletions
 *      cascade contacts via the existing DELETE /formations/{fid} endpoint
 *      (which cascades at the DB layer). Run sequentially to avoid
 *      race conditions on overlapping contact sets.
 *   4. Refresh formations + contacts state.
 *
 * The confirm gate (irreversible-action warning) lives in FormationSelectionDialog,
 * not here. This action fires only after the user has confirmed.
 *
 * Parameters
 * ----------
 * selectedKeys
 *     The stable keys (candidate.key) the user chose to keep / create.
 *     Passed verbatim as selected_keys to the auto-populate endpoint.
 * boreholeIds
 *     The boreholes in scope (same list passed to discoverBoreholeFormations).
 */
applyBoreholeFormationSelection: (
  selectedKeys: ReadonlySet<string>,
  boreholeIds: readonly string[]
) => Promise<void>
```

**Which endpoints each action calls:**

| Action | Endpoints |
|---|---|
| `discoverBoreholeFormations` | `POST .../discover-from-stratigraphy` (new additive read-only endpoint) |
| `applyBoreholeFormationSelection` (step 1) | `POST .../contacts/auto-populate` with `selected_keys` body field (existing endpoint, additive param) |
| `applyBoreholeFormationSelection` (step 3) | `DELETE /projects/{pid}/geology/formations/{fid}` per unselected formation (existing endpoint, one call per formation) |

Step 3 runs the deletions sequentially (not in parallel) to avoid cascading
race conditions in the backend — a formation delete cascades contacts, and
parallel deletes on overlapping contact sets are unnecessary risk. Sequential
is fine at v1 cardinality (typically 5–15 formations).

**Why server-side key filter removes the create-then-delete pattern.** The
original design called `handleAutoPopulateFromStratigraphy` (no filter) then
deleted unselected formations. This produced a race condition: the stale
`formations` closure used to compute `toDelete` did not include the formations
just created in step 1, so they were immediately deleted in step 2. The
corrected design passes `selected_keys` to the server so only the chosen
formations are ever created — there are no unselected formations to clean up
(they were never created). Step 3's delete-the-rest removes formations that
pre-existed in the model but are no longer in the selection.

`applyBoreholeFormationSelection` is NOT added to the undo stack. The
delete-the-rest operation deletes unknown quantities of user data;
reconstructing a precise undo would require snapshotting the entire pre-
delete state (all contacts across all deleted formations). The safeguard is the
confirm dialog, not undo. This is consistent with how `handleDedupeContacts`
is also excluded from the undo stack for the same reason (irreversible cleanup
with confirm).

---

### 10.4 Where it lives and dialog shape

**File:** `desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx`

**Prop contract:** `FormationSelectionDialog` is NOT a StageDescriptor component.
It is a standalone modal opened imperatively by `GeologyToolbar` when the
discovery scan completes. It takes props:

```typescript
interface FormationSelectionDialogProps {
  candidates: FormationCandidate[]
  /** Current formations in the model — used to pre-check and compute deletion counts. */
  currentFormations: GeologicalFormationResponse[]
  /** Current contacts in the model — used to compute M in the "M contacts deleted" warning. */
  currentContacts: FormationContactResponse[]
  /**
   * Fired on "Apply selection" with the set of stable keys (candidate.key)
   * the user has checked. The hook passes these directly to the server's
   * selected_keys filter — identity is preserved regardless of working-name
   * variation across boreholes sharing a formal stratigraphy code.
   */
  onConfirm: (selectedKeys: ReadonlySet<string>) => void
  onCancel: () => void
}
```

`GeologyToolbar` reads `geoModel.formations` and `geoModel.contacts` from
`useShell()` and passes them to the dialog.

**Dialog content, top to bottom:**

1. **Heading:** `"Fill from boreholes"` (same label as the toolbar button).
2. **Subheading / description:** `"Select the formations to include in the model.
   Unselected formations and their contacts will be permanently deleted."`
   — always visible; primes the user to understand the destructive nature.
3. **Select all / Select none** links, right-aligned above the list.
4. **Candidate list** — one row per candidate, checkbox + name +
   `"found in N borehole(s)"` secondary text. Rows sorted by `boreholeCount`
   descending (most-represented first), then alphabetically. Default state:
   if a candidate's stable key (`candidate.key`, lowercased) matches the
   stable key of a formation already in the model (`f.regional_ref ?? f.name`,
   lowercased), it is pre-checked; new candidates are unchecked by default (the
   user has to opt in to adding new formations, not opt out of deleting things).
5. **Deletion warning** — shown only when the current selection would cause
   at least one deletion: `"N formation(s) and M contact(s) will be
   permanently deleted."` in `text-red-600`. N and M are recomputed live as
   the user changes checkboxes.
6. **Footer** — two buttons right-aligned:
   - `Cancel` — always left, no destructive styling. Has default focus when the
     deletion warning is visible.
   - `Apply selection` — accent button (or danger-accent if N > 0). Has default
     focus when N = 0 (no deletions).

**Dark-mode note (debt #24):** The shared Modal primitive is light-only. The
Sections delete modal handles dark-mode inline. `FormationSelectionDialog`
must do the same — use `dark:` Tailwind variants directly on its own elements
rather than relying on the shared Modal to propagate them. This is consistent
with the existing pattern; do not attempt to fix debt #24 inside this commit.

**Loading state:** the dialog is opened only after `discoverBoreholeFormations`
resolves (the toolbar shows a spinner while the discovery endpoint is in
flight). If the endpoint returns an empty candidate list (no boreholes carry
stratigraphy), the dialog is not opened — instead a toast is shown:
`"No boreholes carry stratigraphy data."` This prevents showing an empty
checklist.

---

### 10.5 Sections "Seed" interaction still holds

The Sections "Seed from stratigraphy" action is unaffected by this change.

The contract established in §2 and §3 holds exactly as-is:
- Geology creates the curated formation set (via `FormationSelectionDialog` +
  `applyBoreholeFormationSelection`).
- Sections Seed (`handleAutoPopulateFromStratigraphy` called directly from
  `SectionsToolbar`) places contacts only for formations that already exist in
  the model. It does not create new formations and does not delete anything.
- Seed un-gates (the disabled no-op in `SectionsToolbar.tsx` is wired) once
  the Geology stage ships and formations exist — this is unchanged.

The only wording correction needed from §2's "Seed action closure" paragraph:
it states "The bus action `handleAutoPopulateFromStratigraphy` is reused for
both [Geology Fill and Sections Seed]." After §10, Geology's Fill calls
`discoverBoreholeFormations` + `applyBoreholeFormationSelection` (which
internally calls `handleAutoPopulateFromStratigraphy` as one of its steps).
Sections Seed continues to call `handleAutoPopulateFromStratigraphy` directly.
That paragraph now carries a "(superseded by §10)" note inline.

---

### 10.6 .gmproj / schema impact — confirmed none

The curated selection dialog creates and deletes existing formation + contact
rows using endpoints that already exist (`POST /formations`, `DELETE
/formations/{fid}`, `POST /contacts/auto-populate`). It introduces no new
persisted field, no new ORM column, and no new bundle field.

The `hidden_formation_ids: string[]` field described in the original Fork E
Interpretation 2 is NOT added. Unselected formations are deleted, not hidden.
There is no "hidden set" to persist.

**Format version stays at 3. No version bump. No dual reader. No migration.**

This explicitly corrects §8.2's "Not changing .gmproj format (unless Fork E
resolves to the hide-toggle interpretation)" which anticipated a possible
additive field if Interpretation 2 were chosen. Fork E resolved to delete, so
that conditional is moot.

---

### 10.7 Revised G1 summary

The complete G1 commit sequence is now specified in §5 Phase G1 (revised
inline). For reference, the new commits that did not exist in the original G1:

| New in §10 | Commit |
|---|---|
| Discovery endpoint (backend, additive) | `feat(geology): add discover-from-stratigraphy endpoint` — separate backend commit before the frontend G1 work |
| `discoverBoreholeFormations` + `applyBoreholeFormationSelection` | G1 commit 1 |
| `FormationSelectionDialog` | G1 commit 3 |
| Updated `GeologyToolbar` (Fill verb opens dialog) | G1 commit 4 |

G1 commits 5, 6, 7 (GeologyInspector, stage swap, smoke test) are identical to
the original plan's commits 3, 4, 5 — no change in content.

**The backend discovery endpoint must land before G1 commit 1.** It is a
separate backend commit:
`feat(geology): add discover-from-stratigraphy read-only endpoint`
in `src/groundmodel/api/routers/geology.py`, backed by a service function that
runs the same FORMAL/INFORMAL stratigraphy scan as `auto-populate` but returns
candidate names + counts only, with no transaction and no DB write. Body
validation mirrors `auto-populate` (borehole_ids list, 1..500). The endpoint
schemas (`DiscoverFromStratigraphyRequest`, `FormationCandidateItem`,
`DiscoverFromStratigraphyResponse`) live in
`src/groundmodel/api/schemas/project/formation_contact.py` alongside the other
contact schemas (`FormationContactCreateRequest`,
`AutoPopulateFromStratigraphyRequest`, ...) — the discover endpoint is a
contact-domain operation mounted at `.../contacts/discover-from-stratigraphy`,
so it shares that module rather than fragmenting into a new `geology.py`.
(Resolved during G1 build — supersedes the earlier `geology.py` suggestion.)

---

## 11. Addendum — G7: DEM ground surface + clip-to-surface (owner directive 2026-05-16)

The G5/G6 viewer ships a **flat** `EllipsoidTerrainProvider` base. Owner
directive (a practising geotech engineer, dogfooding): the real ground
surface must be in the model, formation tops must not render above it,
and the water-surface-vs-bed problem must be acknowledged rather than
silently wrong. This supersedes §4.x's flat-ellipsoid base. Region scope
**BE + NL** (owner-confirmed). Build now (owner-confirmed), one
engineer pass + one review, then dogfood — same rhythm as G1–G6.

### 11.1 The DEM is OUR surface, not Cesium world-terrain

Decision: sample a public DEM into a Strix-owned **"Ground surface"
TIN** that lives in the same scene as the formation surfaces — *not* a
Cesium quantized-mesh terrain provider. Rationale:

* **Local-first / offline** — Strix is offline-capable on site
  (CLAUDE.md "Distribution model"). A live world-terrain provider
  breaks that; a cached sampled raster does not.
* **It is the only approach that enforces §11.3** — a cosmetic terrain
  drape cannot clamp formation geometry; a sampled z-grid we own can.
* **One concept, not a new one** — the fetch+cache mirrors the existing
  DOV XML cache (`DovXmlCache`): filesystem-first, network only on a
  cold cell, cache wipe is safe (CLAUDE.md "Doesn't apply to" — DOV
  cache layout; the DEM cache gets the same status).

### 11.2 `DemProvider` abstraction (infrastructure)

One interface, two implementations behind it (owner chose BE+NL):

| Provider | Source | Access |
|---|---|---|
| `DhmvDemProvider` (BE/Flanders) | DHMV II — *Digitaal Hoogtemodel Vlaanderen II*, 1 m LiDAR DTM | Geopunt/AGIV WCS (GeoTIFF) |
| `Ahn4DemProvider` (NL) | AHN4 — *Actueel Hoogtebestand Nederland*, 0.5 m | PDOK WCS |

* Provider selected per project from `default_horizontal_epsg`
  (31370 → DHMV; 28992 → AHN4) with an explicit override path; unknown
  CRS → "no DEM provider for this region" surfaced to the UI, not a
  crash.
* Infrastructure layer only (`infrastructure/dem/`). It returns sampled
  z at (x, y) in the project CRS; the WCS request, GeoTIFF decode,
  reprojection, and the on-disk cache all live here. Domain never sees
  WCS.
* `DemTileCache` parallels `DovXmlCache` — keyed by (provider, tile
  bbox, resolution), filesystem under the same userData cache root,
  TRACE/DEBUG logging of every WCS URL + status + bytes per the DoD,
  logs cold-miss vs warm-hit.
* WFS/WCS client reuse: fold into debt #15 (WFS client base class) if
  the shared shape is real after the second client exists — do not
  pre-abstract on the first (CLAUDE.md "don't pre-abstract").

### 11.3 Clip rule — layers cannot exist above ground (domain)

A formation top interpolated between boreholes can overshoot the
terrain in a valley/slope. Rule, owner-stated: **no formation surface z
may exceed the ground-surface z at the same (x, y).**

* Enforced at **surface build** (the `surfaces/rebuild` path), not only
  at render — clamp each TIN vertex to `min(formation_z, dem_z)`.
* Where a contact's own surveyed top sits **above** the DEM, that is a
  data conflict, not something to silently clamp: emit a
  `ValidationIssue` (per Data Integrity Rule §5 — validation invariants
  belong in the parse/build result, the domain accepts messy input and
  records the problem; it does not raise). The clamp still applies for
  rendering so the model stays geologically valid, but the issue is
  surfaced to the engineer.
* The clamp is a pure domain function (DEM z-grid in, clamped contacts
  + issues out) — unit-testable with no DB/IO, lives in the geological
  surface service alongside the TIN compute. Add a `bench_*` only if
  profiling shows the clamp is per-vertex hot at 500-contact scale
  (current TIN compute is 2.6 ms @ 500 — clamp is the same order;
  measure before adding a benchmark per CLAUDE.md "When to add a
  benchmark").

### 11.4 Bathymetry — scoped OUT as a documented known-limitation

LiDAR DEMs return the **water surface** over rivers/canals/docks, so a
formation under water would clamp to water level — wrong. There is **no
single national wet-DEM**; bed data is per-waterway-authority survey
data (BE: De Vlaamse Waterweg / VMM dwarsprofielen; NL: Rijkswaterstaat
Vaklodingen / Baseline; estuary/marine: EMODnet). Building automatic
multi-authority bathymetry ingestion now is a large, low-coverage
detour and is **not** in G7.

G7 instead:

* Flags DEM cells over mapped water bodies as **low-confidence ground**
  and emits a `ValidationIssue` ("ground surface over water may
  represent water level, not bed — verify before relying on clipped
  formations here") rather than presenting it as truth.
* Leaves a Phase-5 path: **manual river-bed-profile import** (engineer
  supplies surveyed cross-sections that override the DEM locally).
  Tracked as a new debt item, not built now.
* The "generic GeoTIFF DEM import" the owner did *not* pick stays a
  natural future fallback provider behind the same `DemProvider`
  interface — no rework cost to add later.

### 11.5 Contracts — additive only, no .gmproj change

* **API:** one additive endpoint, contact/surface-domain shaped, e.g.
  `POST /projects/{pid}/geology/models/{mid}/ground-surface/build`
  (samples the DEM over the model's investigation hull, caches it,
  returns the ground-surface TIN + any clip `ValidationIssue`s).
  Read path may piggy-back the existing surfaces response with an
  additive optional `ground_surface` field — additive, defaults
  null/optional per CLAUDE.md "Additive only".
* **.gmproj / bundle:** **no `format_version` change.** The sampled
  ground surface is a *cache of public data* (like DOV-imported CPTs),
  derivable from (provider, project hull, resolution) — it does not
  ride in the bundle as a source-of-truth array. If a future decision
  wants it persisted for true-offline reopen, that is an additive
  bundle field + version bump then, designed per the Backwards-Compat
  upgrade-chain — out of scope for G7.
* **Frontend:** `Geology3DViewer` renders the ground-surface TIN as the
  scene base in place of the flat ellipsoid and renders formation
  surfaces already clamped (the clamp is server-side; the viewer just
  draws what `rebuild` returns). The basemap drapes onto that same TIN
  (`buildBasemapDrape`, §4.4) so the aerial follows real relief.

### 11.6 Build rhythm

Single staff-engineer pass for the whole G7 slice (backend provider +
cache + sampling + clip rule + ValidationIssue + additive endpoint +
unit tests; frontend viewer integration), one-file-per-commit,
Conventional Commits, DoD (numpy docstrings + entry/exit logging +
unit tests), layer model (WCS in infrastructure, clamp in domain,
orchestration in application, endpoint in API), Node 22, no
`--no-verify`. Then one senior-code-reviewer pass; fix only genuine
blockers (crash / data-loss / compat); push; owner dogfoods. Bathymetry
debt item added to `docs/debt.md` in the same campaign.
