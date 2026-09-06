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

## What the owner sees on the worked example

He draws a polygon over the canal and types the dredged bed level (say -4 m
TAW). The 3-D ground surface and the section DEM line drop to -4 m across the
polygon. On the next Build the Vlierzele and Pleistoceen surfaces are cut where
they cross that bed: they are present on the two flanks and gone under the
canal, and Merelbeke (below the bed everywhere) keeps its own top unchanged.
