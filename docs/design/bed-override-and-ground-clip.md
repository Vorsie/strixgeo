# Bed overrides and the crossing-line ground clip

Current-state design of two coupled features (owner ruling 2026-09-06). Load
before touching the ground surface, the formation-surface clip, or the
bed-override CRUD.

## The problem

A site was dredged 8 m for a canal. Two tests on either side still log the
Vlierzele and Pleistoceen units, but between them, under the canal, those units
are gone. The DEM (DHMV II) over the canal carries the WATER surface, not the
dredged bed, so a naive clip leaves the units under the water surface. And the
old point-by-point clamp (min of formation z and ground z at each vertex)
flattened a crossing surface into a plateau at the ground level instead of
cutting it.

## Ruling 1 — clip by the crossing line, not by clamping

A formation surface is cut along its crossing line with the ground surface, not
clamped vertex by vertex. In the owner's words: a formation surface ends where
it crosses the ground surface; the crossing line is part of the TIN; nothing
above the ground remains; a surface entirely below it (like Merelbeke, well
under the bed) keeps its own top.

* Pure domain function: `domain/services/clip_tin_by_ground_surface.py`
  (`clip_tin_by_ground_surface(surface, ground_z)`). Each triangle is clipped
  independently against the scalar field `f = surface_z - ground_z` (keep the
  `f <= 0` half) with a single-plane Sutherland-Hodgman clip. All three vertices
  on or below ground: the triangle is kept verbatim. All three above: dropped.
  Mixed: clipped to the below-ground sub-polygon with the crossing points
  inserted on the straddling edges, then fan-triangulated. A triangle whose
  ground is NoData is kept verbatim (no reliable cut target). When nothing is
  dropped or clipped the input object is returned unchanged, so a below-ground
  surface is byte-identical to before.
* Wiring: `RebuildModelSurfaces.execute(model_id, ground_sampler=...)` forwards
  the sampler to `RecomputeFormationSurface`, which clips each TIN before the
  upsert. The clip is applied only on the explicit geological Build (the
  `/models/{model_id}/surfaces/rebuild` endpoint builds the ground surface and
  passes the sampler). The auto-recompute path on a contact mutation passes no
  sampler, so it is byte-identical to before. The cut therefore shows in the
  section view (the sliced polyline stops at the crossing) and in 3D (the
  formation TIN triangles end there), both reading the same clipped cache.
* Best-effort: `application/build_model_ground_sampler.py` builds the ground
  surface (DEM plus bed overrides) and returns a `ground_z(x, y)` sampler over
  the ground TIN, or `None` on any failure (no DEM provider for the CRS, a WCS
  outage, an empty hull). A `None` sampler means "no clip", so a Build never
  fails because the DEM is unreachable, it just produces unclipped surfaces as
  before.

The old `domain/services/dem_clip.py` clamp remains for the ground-surface
build's per-vertex overshoot flagging (`contact_above_dem`); it is not the
formation clip. The formation clip is the crossing-line function above.

## Ruling 2 — the manual bed override (the missing bathymetry)

A bed override is a polygon drawn on the map with one constant bed elevation
(m TAW / NAP). Inside the polygon the ground surface takes that level instead
of the DEM; outside, the DEM stands. Several polygons per project, each its own
level. Survey-file bathymetry import stays Phase 5; only the drawn polygon
exists now.

* Value object: `domain/value_objects/bed_override_polygon.py`
  (`BedOverridePolygon`: label, level_m, vertices). Service:
  `domain/services/bed_override.py` (`bed_level_at` point-in-polygon;
  `ground_sampler_with_bed` wraps a DEM sampler so the bed wins inside a
  polygon, even over a DEM hole). Overlaps resolve by list order (first
  containing polygon wins); rows are stored newest-first so the newest drawn
  polygon wins.
* One shared primitive feeds three consumers, all reading the same
  bed-adjusted ground: the 3-D ground surface (`BuildGroundSurface` takes
  `bed_overrides` and wraps `grid.sample_at`), the section DEM line
  (`GET /dem/sample?project_id=...` overrides each along-line sample inside a
  polygon), and the crossing-line clip (its ground sampler is built from the
  bed-adjusted ground surface). A surveyed test collar still outranks the bed
  at the test's own location (collar over bed over DEM).
* Persistence: `bed_override` table (`infrastructure/db/models/bed_override_orm.py`),
  Alembic migration `a1b2c3d4e5f7_bed_override_table.py`, repository
  `bed_override_repository.py`, CRUD routes `api/routers/bed_override.py`
  (`/projects/{project_id}/bed-overrides`). Project-scoped, independent root
  (no cross-table FK) like `cross_section`. Additive `.strix` bundle collection
  `bed_overrides` (no `format_version` bump; old files restore to an empty
  list).

## Ruling 3 — the bed cuts the litho model too (owner ruling 2026-09-07)

Ruling 1 clips the *geological formation surfaces*. It does NOT touch the
lithostratigraphic / geotechnical model: the 2-D litho fill tops at each
column's collar, and the voxel top is the section region envelope, never the
ground sampler (the 2026-07-30 ruling: the voxel top is section-derived). So the
answer to "does the canal fill also cut out in the litho model?" was *no* — the
litho fill and the 3-D litho solids still reached the water surface under the
canal.

The ruling: a **BED-ONLY clip**, exactly what a bed polygon means — inside a bed
polygon nothing lithological is drawn or built above the bed level; outside every
bed polygon nothing changes. It is deliberately NOT a DEM clip everywhere and
NOT a change to the collar-derived fill top or the section-derived voxel top; a
project with no bed override renders and builds byte-identically (every voxel
golden unchanged).

* **2-D (render-layer clip, no engine change).** The partition fill overlay
  (`PartitionFillOverlay` + its seam strokes) is clipped to the section's
  ground+bed line where the section crosses a bed polygon. The pure builder
  `desktop/.../sections/sectionBedClip.ts` (`buildBedClipPath`) reconstructs each
  DEM sample's map `(x, y)` from its along-distance — exactly as `GET /dem/sample`
  does — tests polygon membership (a port of `bed_level_at` / `_point_in_ring`),
  and returns an SVG clip-path whose top edge dips to the bed line over the
  in-polygon along-ranges and stays at the plot top everywhere else. It returns
  `null` when the section crosses no bed polygon, so no clip is applied and the
  render (incl. the CS1 golden) is byte-identical. `SectionPanel` builds the path
  from the SAME `demSamples` the surface line draws and the SAME
  `warpedXToScreen` / `levelToScreen` transforms the fill uses, so the cut lines
  up pixel-for-pixel, and wraps the overlay in a `<g clipPath>`. The DEM line
  already carries the bed (fetched with `project_id`), so this needs no new
  fetch; the bed polygons reach the section view from `ShellContext.bedOverrides`
  via `SectionsCanvas` (filtered to the section's CRS).
* **3-D (labelling-top cap, the single place the top is decided).**
  `label_voxels` takes an optional `bed_top_at(x, y)` cap. For a voxel column
  inside a bed polygon it voids every voxel above the bed level; outside every
  polygon the sampler returns `None` and the column is untouched. The cap is
  applied per column AFTER both the section-blend and honored-log write paths and
  BEFORE the empty-column tally, so it caps both alike and the tally stays
  honest. `BuildVoxelLithoModel` builds the sampler from `bed_level_at` over the
  project's bed overrides (restricted to inside-polygon cells), passes it to
  `label_voxels`, and folds the overrides into the partition checksum (byte-stable
  when there are none) so drawing or re-levelling a polygon busts the cache and
  the on-open `force=false` path rebuilds. Both the litho and geotech voxel
  builds go through this one path.

## Ruling 4 — the bed cuts the fence too, and the models say when a rebuild is needed (owner 2026-09-13)

Owner question, verbatim Dutch: *"houdt dit rekening met getekend bodempeil?
wordt het getekend bodempeil ook uit het hekwerk gesneden of moet ik
strat/geo/litho model dan herberekenen?"* — does the model check account for the
drawn bed level; is the drawn bed also cut out of the fence, or must the
strat/geo/litho models be recomputed? Two parts.

* **The fence is cut at once (render + export clip, no engine change).** The 3-D
  fence walls and the fence DXF are clipped by the bed exactly like the 2-D
  section view. Pure function
  `desktop/.../utils/clipFencePanelsToBed.ts` (`clipFencePanelsToBed(panels,
  bedPolygons)`): a fence panel is a triangle soup, but every INDIVIDUAL triangle
  came from one gap of the partition, so its plan `(x, y)` points are collinear
  (a vertical wall). Each triangle is parametrised by plan-distance `s` and
  clipped in the `(s, elevation)` plane — split at every polygon-edge crossing
  (cut only inside the polygon) and, inside a polygon, capped at the bed level via
  Sutherland-Hodgman half-plane clips, then fan-triangulated and re-welded on a
  1-micron grid so the DXF interior-edge hiding still sees the seams. Membership
  is the SHARED `utils/bedPolygonMembership.ts` (`pointInRing` / `bedLevelAt`,
  extracted from `sectionBedClip.ts`), so the fence cut and the section cut agree.
  It is wired into `buildProjectFence` (the single point BOTH fence paths pass
  through — the 3-D stages via `useBody3DViewState`, the Export hub via
  `makeProjectFenceBuilder`), so the walls on screen and the exported DXF cut
  identically. A no-op — same array — when there are no bed overrides, so every
  existing fence is byte-identical.
* **The BUILT models must be recomputed — and now they say so.** A bed change
  cannot cut a cache that already exists, so a bed drawn / edited / deleted after a
  Build marks the built models stale through the on-click-Build staleness flags:
  `application/stale_models_for_bed_change.py` flips every geological model's TIN
  surfaces (`mark_all_surfaces_stale`) and every litho / geotech model's voxel
  solids (`mark_litho_solids_stale`) stale, called from the bed-override router's
  create / delete and its level-or-geometry update (a label-only rename does not
  stale). The desktop re-reads that staleness without a project reopen:
  `useBedOverrides` fires `onBedChanged` → `App`'s `bedStaleNonce` → the two
  `useLithoSolids` refresh keys and the geological-surface refetch in
  `useGeologicalModel`, so the "rebuild" badge turns amber at once. A save also
  toasts `bedOverride.savedRebuild` ("Bed level saved. Rebuild the models to cut
  them at it; the section view is cut at once." / NL).

## Where the bed is applied, and when a rebuild is needed

| Surface | Bed applied | Rebuild needed? |
|---|---|---|
| 2-D section partition fill | render-layer SVG clip (`sectionBedClip.ts`) | no — cut at once |
| 3-D fence walls + fence DXF | render/export clip (`clipFencePanelsToBed.ts`) | no — cut at once |
| Stratigraphy (geological) TIN surfaces | crossing-line clip at Build (`clip_tin_by_ground_surface`) | **yes** — marked stale on a bed change |
| Litho / geotech 3-D voxel solids | labelling-top cap at Build (`label_voxels(bed_top_at=)`) | **yes** — marked stale on a bed change |

The two VIEW surfaces recompute their geometry from the live overrides every
render, so they need no rebuild; the two BUILT caches embed the bed at Build
time, so a later bed change stales them and the engineer clicks Build to cut them.

## What the owner sees on the worked example

He draws a polygon over the canal and types the dredged bed level (say -4 m
TAW). The 3-D ground surface and the section DEM line drop to -4 m across the
polygon. On the next Build the Vlierzele and Pleistoceen surfaces are cut where
they cross that bed: they are present on the two flanks and gone under the
canal, and Merelbeke (below the bed everywhere) keeps its own top unchanged.
**And now the litho model follows:** on the section, the litho / geotech fill
under the canal stops at the -4 m bed line instead of the water surface, and the
next 3-D Build stops the litho solids at the bed there too — while the flanks and
every project without a canal are unchanged.
