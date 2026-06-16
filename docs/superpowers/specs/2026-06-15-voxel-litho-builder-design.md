# Voxel litho builder — a faithful + watertight 3D model from the section partitions

- **Date:** 2026-06-15
- **Status:** design (owner-approved direction; spec under review)
- **Owning layer:** Frontend computes the ground-truth partition; **Python domain**
  (`domain/services/voxel_litho/`, NEW) + `RecomputeLithoSolids` build the geometry.
  Output reuses `litho_body_solid` + the existing render/export path (no schema change).
- **Base / branch:** continue on `feat-litho-3d-strat-field`.
- **Supersedes (as the ACTIVE solid builder):** the implicit stratigraphic field
  builder (`strat_field/`). That code stays in the repo (dormant), but
  `RecomputeLithoSolids` switches its active builder to this one.

---

## Problem

The implicit-field 3D builder is watertight but **not truthful**. Measured on the
real `test.strix` model (`scripts/eval_strat_fidelity.py`, this session):

- **0 of 48** covered investigations match the accepted litho sequence.
- Contact-depth error vs the accepted picks: **mean 5.1 m, max 21.4 m**; only 16 %
  within 1 m; 71 % off by > 2 m.
- **10 of 58** investigations have no body at all.
- **7.2 M triangles** → the 3D viewer crawls on zoom.

Root cause: the implicit field refits a smooth scalar field and **ignores the 2D
partition entirely**; its monotone clamp forces a layer-cake, which structurally
cannot represent the interfingering / onlap / lens truth your sections carry. This
is the same class of failure as the retired loft (which built bodies independently
and reconciled them through a global layer-cake order → metre-scale overlaps).

**The recurring trap (load-bearing):** every prior 3D attempt passed
**synthetic / layer-cake fixtures** and then failed on real interbedded data. This
spec treats that as the #1 risk (see "Real-data validation discipline").

---

## The ground truth (what the model must conform to)

1. **Contacts** — the accepted litho contacts per borehole (depths).
2. **Correlations** — approved `litho_contact_correlation` edges (which units are
   the same body across boreholes; the resolver `body_id` = connected components).
3. **Fill bands** — `computeSectionFill` (the validated per-section 2D partition;
   the thing rendered by "Fill bands" / `PartitionFillOverlay`, owner-validated
   "LOOKS PERFECT"). After its `carveOverlays` post-pass it is a TRUE 2D partition
   (no gaps/overlaps), per region tagged `(formationId, bodyId)`.

The 3D model is built **from** (3), which is itself derived from (1)+(2). The
builder never re-derives the partition — it consumes `computeSectionFill` output,
so it cannot drift from the truth.

---

## Approach — label the volume, then extract boundaries

Stop building bodies and reconciling them. Instead **assign every point in the
domain to exactly one body** (a labeling = a partition of space), then each body's
surface is simply the boundary between its region and everything else.

This yields both required properties **by construction**:

- **Watertight** — a labeling of space has no overlaps or gaps; every A↔B contact
  is one shared face. (The property all three prior attempts could not guarantee.)
- **Faithful + interfingering** — a voxel may carry *any* label regardless of its
  neighbours, so a unit shallow here / deep there works; there is no global order,
  no monotone clamp, no layer-cake.

Blockiness (at the chosen voxel size) is the only tradeoff; smoothing is a later
phase. "Correct + watertight first, beautify later" — the inverse of the prior
attempts that chased smooth/clever and shipped wrong.

---

## Architecture & data flow

```
FRONTEND (the validated truth)
  for each section: computeSectionFill(columns, edges) -> regions[(formationId, bodyId,
       polygon in (fraction, elevation), gapIndex)]  + section line endpoints
       + ordered columns with canonical world (x,y)  (the buildProjectFence geometry)
  POST /litho/models/{id}/build-voxel  { sections: [...], grid_spacing_m, domain hints }

BACKEND (domain/services/voxel_litho/ + RecomputeLithoSolids)
  1. domain      = build_model_domain(...)      [reuse: alpha hull + DEM top + deep base]
  2. label_grid  = label_voxels(domain, grid_spacing, sections)   -> 3D array of body_id
  3. meshes      = extract_body_solids(label_grid)                -> per body_id, watertight
       (3a) cell-boundary faces (label != neighbour) -> closed manifold by construction
       (3b) greedy-mesh coplanar faces               -> few triangles
  4. persist     = LithoBodyMesh per body -> litho_body_solid  [reuse upsert/checksum/orphan]

RENDER / EXPORT  (unchanged — fed truthful, lighter data)
  Geology3DViewer "Solid" + section "Show model fill" now show a faithful model.
```

**Why the split:** the partition (truth) is computed once in validated TS and sent
as a small payload; the heavy 3D geometry runs in Python (scipy, the watertight
cell-complex from `body_assembly.py`, the existing persistence). No re-derivation
of the partition anywhere → no divergence.

---

## Components (each a small, testable unit)

### A. `label_voxels(domain, grid_spacing_m, sections) -> LabelGrid`
The heart. For each voxel centre `(x, y, z)`:
- Project `(x, y)` onto each section line → `(along_m, perpendicular_offset_m)`.
- On a section: `along_m` → which gap (between two ordered columns) → `fraction`
  within the gap; `z` is elevation. Point-in-polygon over that gap's regions →
  the region's `body_id` / `formation_id` (post-`carveOverlays`, the regions tile,
  so the lookup is unambiguous).
- **Between sections:** blend the **two nearest** sections by perpendicular offset,
  with a midline pinch (a body present on one section and absent on the other
  pinches out at the equidistant line) — the recipe the retired `loft_field`
  used successfully (its death was the mesher, not this blend).
- A voxel outside every section's reach (beyond the data) → unlabeled (void).
Returns a 3D `body_id` label array + the grid geometry. PURE, deterministic.

### B. `extract_body_solids(label_grid) -> list[LithoBodyMesh]`
For each distinct `body_id`: the boundary faces are the voxel faces where the label
changes (label == body on one side, != on the other). Emit them as a closed
manifold (watertight by construction — every interior face cancels, every boundary
face appears once; the 3-D generalization of the XOR cell-complex already in
`body_assembly._build_component_mesh`). Then **greedy-mesh** (merge coplanar
same-body quads) → collapse flat runs to a few large quads. Deterministic vertex /
triangle order. `formation_id` from the body's label.

### C. Build orchestration — `BuildVoxelLithoModel` use case + endpoint
`POST /litho/models/{id}/build-voxel` accepts the per-section partition payload,
runs `build_model_domain` → `label_voxels` → `extract_body_solids` → upserts
`litho_body_solid` (reuse `_batch_upsert`, checksum, orphan-delete). The checksum
covers the partition payload + grid spacing. `RecomputeLithoSolids` (or the "Build
model" button path) routes here instead of the implicit field.

### D. Frontend build request assembly
A renderer helper gathers, for every section, `computeSectionFill` regions +
section geometry (reuse `buildProjectFence`'s canonical per-test world XY so tie
and cross-section columns agree at crossings) and POSTs the build. No new partition
logic — it calls the existing validated `computeSectionFill`.

---

## Real-data validation discipline (owner directive — a hard rule)

Synthetic / layer-cake fixtures have hidden every prior 3D bug. Therefore, in
addition to unit tests on real-data-shaped fixtures, **every function in this
builder is exercised on the real `test.strix` model and checked against the ground
truth, and if a step deviates we flag it and change the path — we do not loosen the
check.** Concretely, per build step:

- **`label_voxels`** — sample the label grid at every `test.strix` section plane and
  assert the recovered partition equals `computeSectionFill` there (the labeling
  must reproduce the fill bands on the sections, exactly). Sample at each borehole
  and compare to the accepted contacts.
- **`extract_body_solids`** — `assert_closed_manifold` + STRICT
  `assert_no_overlap_sampled` on the real bodies.
- **End to end** — `scripts/eval_strat_fidelity.py` (model vs accepted lithos):
  the sequence-match must go from 0/48 toward full match, the contact-depth error
  toward ≤ voxel size, coverage gaps explained (hull edge) or fixed. This is the
  gate that was never run on the implicit field; here it is a required, per-step
  check. A regression here blocks the step.

The fidelity diagnostic + `computeSectionFill` are the oracle. Deviation = a bug in
the builder, not a fixture to relax.

---

## What this reuses (low new surface)

- **Truth:** `computeSectionFill` (unchanged) + `buildProjectFence` geometry.
- **Domain:** `build_model_domain` (alpha hull + DEM top + deep base).
- **Watertight machinery:** the cell-complex boundary idea from `body_assembly.py`
  (generalized from 2-D height-field to 3-D voxel faces).
- **Persistence / render / export:** `LithoBodyMesh` → `litho_body_solid` → the
  batched upsert + checksum + orphan-delete + `Geology3DViewer` + the section
  "Show model fill" — all unchanged; they just receive truthful, lighter data.

## What is NEW

- `domain/services/voxel_litho/`: `label_voxels`, `extract_body_solids` (+ greedy
  mesh), value objects.
- `application/build_voxel_litho_model.py` + the build endpoint + the checksum
  extension.
- Frontend: a build-request assembler that POSTs the per-section partition.

---

## Performance

- **Render:** greedy-meshed voxel boundaries are *lighter* than today's 7.2 M
  triangles — flat top/base runs collapse to a few quads. This fixes the zoom
  slowness directly.
- **Build:** O(voxels) labeling + O(surface voxels) extraction. Grid spacing is the
  knob (≈ `(hull_area × depth) / spacing³` voxels). Default a coarse spacing for an
  interactive on-click build (e.g. 2–3 m); profile on `test.strix` and tune. The
  labeling per voxel is a few section projections + a point-in-polygon — cheap and
  vectorisable; profile before optimizing (the lesson re-learned this session).

---

## Out of scope (later phases)

- **Smoothing** the blocky boundary (marching-cubes / dual-contouring / mesh
  relaxation that preserves the labeling) — a follow-up once the voxel model is
  correct + watertight + validated on real data.
- **Tetrahedral / sharp-boundary** variant — the alternative we did not pick.
- **A 3D-volume export path** (DXF 3DFACE / Plaxis-3D from the solids) — the meshes
  are export-*ready* (`LithoBodyMesh` is the de-facto contract), but wiring the
  exporters is a separate Phase-4 export task (existing exporters are 2D-per-section
  today).
- **Retiring / deleting the implicit-field `strat_field/` code** — left dormant for
  now, not deleted.

---

## Risks / open questions

- **Between-section interpolation fidelity.** The sections are sparse and
  near-parallel; the labeling between them is the `loft_field` 2-nearest-midline
  recipe. Real-data check: does the interpolation produce geologically sane
  pinch-outs between sections, or artifacts at the midlines? Validated by the
  per-step `test.strix` check; if midline artifacts appear, refine the blend
  (more neighbours / strike-aware weighting) — flag, don't hide.
- **Voxel size vs build time vs blockiness.** Tuned on `test.strix`; the default is
  a profiled choice, not a guess.
- **Domain coverage at the hull edge** (the existing 10/58 gap). The voxel grid +
  alpha hull must cover every borehole; if edge boreholes still fall outside,
  widen the hull (a real-data check, not an accepted loss).
- **Frontend→backend payload size** for many sections — small in practice (regions
  are coarse polygons), but measured on `test.strix` (14 sections).
