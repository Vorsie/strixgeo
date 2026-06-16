# Geological-band-bounded voxel labelling — fill the deeper bands sideways

- **Date:** 2026-06-15
- **Status:** design (owner-approved direction; spec under review)
- **Owning layer:** Python domain (`domain/services/voxel_litho/`) + the
  `BuildVoxelLithoModel` use case. The 2-D `computeSectionFill` partition and the
  geological model are READ-ONLY inputs — neither is modified.
- **Base / branch:** continue on `feat-litho-3d-strat-field`.
- **Builds on:** the voxel litho builder (label → extract → greedy mesh →
  use case/endpoint, spec `2026-06-15-voxel-litho-builder-design.md`) and the
  honor-borehole override already shipped on this branch.
- **Reuses:** the geological-band framework already built for the implicit strat
  builder — `strat_field/geo_blocks._band_index`, the `SurfaceBound` /
  `formation_surface` loading in `AssembleStratInputs.assemble_with_geo`, and the
  `litho_snap_tolerance_m` snap-or-divide knob.

---

## Problem

The voxel litho builder labels each voxel from the 2-D section partition
(`computeSectionFill`) blended between the two nearest sections. It is faithful to
the sections (99.8 % on-section) and, per a real-data check on `test.strix`, it
does **not** push a shallow test's deepest unit downward past its total depth (0 %
of sand-bottom columns sit below the Paleogeen surface). But it has the opposite
defect:

- **Below a shallow test, the deeper geological band is left VOID** rather than
  filled with the litho the deep tests show there. Measured on `test.strix` (2 m):
  ~985 columns bottom out in sand/silt that stops *above* the Paleogeen surface
  (mean −4.7 m), with empty space below down to the model base. The clay (or
  whatever the deepest layer is) is not *wrong* — it is **missing** wherever only
  deep tests reach.

These empty pockets in the deeper layer are the owner's "gaps in the clay".

The root cause: the 2-nearest-section blend has no notion of the geological layers.
Where both nearest sections are shallow at a point, the blend has no deeper-layer
litho to place, so the deeper band stays void. The litho that *should* fill it
lives on the deep-reaching tests, which may be further away or on another section.

---

## The ground truth and the rule (owner directive, validated in detail)

1. **The 2-D Fill bands (`computeSectionFill`) are the ground truth** — the user's
   chosen litho contacts + correlations. They are NOT changed by this work
   (3-D-only). The 3-D model must reproduce them where the sections are.
2. **Geological layers are hard bounds.** The parent geological model's band
   surfaces partition the volume into bands; a litho never crosses a geological
   boundary; interfingering happens ONLY within a band.
3. **No down-extrapolation.** A test's litho occupies only `surface → its own
   TD`. A test that stops part-way through a layer does NOT push its deepest unit
   deeper. (Already true in practice; this spec keeps it true.)
4. **Sideways fill from reaching tests.** Each geological band is filled across its
   whole extent from the tests/sections that **reach that band**, extrapolated
   laterally. So the empty pocket below a shallow test fills with the correct
   deeper-band litho taken from the deep-reaching tests around it.

The deepest layer's litho is therefore *whatever the deep tests logged in it* —
not assumed to be clay (owner: "there isn't always a clay as floor").

---

## Approach — band-scoped 2-nearest-section fill

Make the per-voxel labelling **geological-band-aware**. For each voxel
`(x, y, z)`:

1. **Find its band** `B` from the geo surfaces at `(x, y)` (the `_band_index`
   rule: `B` = number of geological surfaces above `z` at `(x, y)`).
2. **Blend the two nearest sections that REACH band `B`** at `(x, y)` — i.e. whose
   projected stack at that along-position has litho within band `B`'s elevation
   range. A shallow section that does not reach band `B` is **skipped for band
   `B`** (it contributes nothing below where it stops → no down-extrapolation),
   and a further section that *does* reach `B` is used instead (→ sideways fill
   from the reaching tests).
3. **Clip to the band.** The chosen litho interval is clamped to band `B`'s
   vertical extent `[surface_below(x,y), surface_above(x,y)]` so it cannot cross a
   geological boundary. **Snap-or-divide** at a near-coincident litho↔geo boundary
   (within `litho_snap_tolerance_m`): snap the litho contact to the geo surface
   when within tolerance, otherwise divide cleanly at the surface — the existing
   rule, so a litho contact near a geo surface does not spawn a spurious thin
   sliver across it.
4. **Label** the voxel with that interval's `body_id` (carried from the section
   region, so the resolver's body identity is preserved). If no section reaches
   band `B` anywhere within reach, the voxel stays void (a genuine
   no-data-in-this-band case — reported, not hidden).

Why "two nearest reaching sections" rather than the global 2-nearest: the global
2-nearest can both be shallow at a point, which is exactly when the deeper band is
left void today. Selecting the 2-nearest *that reach the band* is the lateral
extrapolation the owner described, expressed per band.

The existing midline-pinch blend (`_blend_stacks`) is reused unchanged — it now
operates on the band-scoped, geo-clipped stacks rather than the full-column stack.

This is the voxel analogue of the strat builder's `assemble_with_geo` (one field
per geological band, bounded by the band surfaces), expressed as per-band voxel
labelling instead of a per-band implicit field.

---

## Components (small, testable units)

- **`geo_bands.py`** (new, `domain/services/voxel_litho/`) — pure helpers:
  `band_of(surfaces, x, y, z) -> int` (reusing the `_band_index` rule),
  `band_extent(surfaces, x, y, band) -> (base, top)` (the band's vertical bounds
  at `(x, y)`), and a `section_reaches_band(section, along, surfaces, band)`
  predicate. No I/O, no logging.
- **`label_voxels`** (extended) — additive keyword
  `geo_surfaces: tuple[SurfaceBound, ...] = ()` and
  `litho_snap_tolerance_m: float`. When `geo_surfaces` is empty the behaviour is
  byte-identical to today (the section-blend path). When present, the per-voxel
  labelling switches to the band-scoped fill above. Determinism preserved.
- **`BuildVoxelLithoModel`** (extended) — loads the parent geological model's
  built, non-stale band surfaces (reuse the loader from
  `AssembleStratInputs.assemble_with_geo`, extracted to a shared helper) and the
  project's `litho_snap_tolerance_m`, and passes both to `label_voxels`. When the
  litho model has no parent geo model or no built surfaces, it logs a WARNING and
  builds un-bounded (the current behaviour) — geo-bounding is an enhancement, not
  a hard requirement. Folds the geo-surface geometry into the build checksum so a
  geo rebuild busts it.

No schema change, no new table, no API-shape change (the surfaces are loaded
server-side from the existing geological model; the request payload is unchanged).

---

## Data flow

```
FRONTEND (unchanged):  computeSectionFill per section  ->  POST build-voxel
BACKEND  BuildVoxelLithoModel:
  picks            = load_body_picks(model)                  [honor-borehole columns]
  geo_surfaces     = load parent geo model band surfaces     [NEW]
  domain           = build_domain_from_sections(sections)
  grid             = label_voxels(domain, spacing, sections,
                        investigation_columns=..., geo_surfaces=...,
                        litho_snap_tolerance_m=...)           [band-scoped fill]
  meshes           = extract_body_solids(grid)               [greedy, unchanged]
  upsert litho_body_solid                                    [unchanged]
```

---

## Real-data validation discipline (owner directive — a hard gate)

Synthetic fixtures hid every prior 3-D bug; every function is checked on the real
`test.strix` model against the ground truth, and a deviation flags + changes the
path (never relax the check). Specifically, after this work:

- **No void in a populated deeper band.** The ~985 sand/silt-bottom columns with
  empty space below must now fill the deeper band(s) with the deep tests' litho.
  Re-run the substrate-composition + clay-gap diagnostic: every column that has a
  geological band beneath it must be filled in that band (no
  litho-then-void-to-base), bounded by the surfaces.
- **No litho crosses a geo surface.** Sample across each geo surface; the litho
  above and below must be on the correct side (within voxel tolerance), 0 non-band
  litho below a surface.
- **On-section fidelity unchanged.** `eval_voxel_label.py` must still reproduce
  `computeSectionFill` on every section (the geo bounding must not move the
  on-section partition).
- **Watertight preserved.** `extract_body_solids` → every body a closed manifold,
  STRICT no-overlap (`eval_voxel_solids.py`).
- **Fidelity improves or holds.** `eval_strat_fidelity.py`: the deepest-band
  substrate now matches the geology; record exact/subsequence/wrong + contact
  errors before vs after.

---

## Error handling

- **No parent geo model / no built surfaces / all stale** → build un-bounded (the
  current path), WARNING logged. The model still builds; it just is not
  geo-bounded.
- **A point outside every surface's footprint** → the surface's nearest-vertex
  fallback (already in `evaluate_tin_at` / `ModelDomain`) gives a finite band
  boundary; no crash.
- **A band with no reaching section within the footprint** → void in that band at
  that `(x, y)`, counted + reported (a real no-data case, not silently filled).

---

## Testing

- **Unit (real-data-shaped synthetic):** a 2-section fixture with one shallow test
  (stops mid-model) + a deep test + a geo surface between two bands. Assert: (a)
  below the shallow test's TD, the deeper band fills with the DEEP section's litho
  (not void, not the shallow unit pushed down); (b) no litho crosses the geo
  surface; (c) snap-or-divide at a near-coincident litho↔geo contact; (d) the
  no-`geo_surfaces` default is byte-identical to the current blend.
- **`geo_bands.py`** helpers unit-tested directly (band index, band extent,
  reaches-band predicate) on a hand-built surface set.
- **Integration:** extend `test_build_voxel.py` with a seeded parent geo model +
  surfaces; assert the deeper band fills and nothing crosses a surface.
- **Real-data gate scripts:** the five checks above, run on `test.strix`.

---

## What is NEW vs reused

- **New:** `geo_bands.py`; the band-scoped branch in `label_voxels`; the geo-
  surface load + pass-through in `BuildVoxelLithoModel`; the band-fill checks in
  the eval scripts.
- **Reused unchanged:** `computeSectionFill` (ground truth), `extract_body_solids`
  + greedy mesh, the persistence/checksum/upsert path, the honor-borehole columns,
  `_band_index` + the `SurfaceBound`/`formation_surface` loader + the
  `litho_snap_tolerance_m` knob from the strat builder.

---

## Out of scope (separate, simpler sibling work — not this spec)

- **Anisotropic voxels** (independent horizontal X/Y + vertical Z cell size in
  Settings) — a grid-spacing change, orthogonal to band-bounding; its own spec.
- **Wiring the "Build model" button** to the voxel endpoint + the Settings knobs —
  frontend wiring; its own task.
- **Smoothing** the blocky voxel surface — deferred (the voxel-builder spec).
- **Any change to the 2-D `computeSectionFill` / Fill bands** — explicitly out;
  the 2-D is the ground truth.

---

## Risks / open questions

- **"Reaching section" cost.** Selecting the 2-nearest sections that reach a band
  is a per-band nearest search; at realistic section counts (14 on `test.strix`)
  this is cheap, but profile on the real model (the build is already ~36 s at
  2 m). Profile before optimising (the re-learned lesson).
- **Snap-or-divide tolerance** at litho↔geo coincidence reuses the existing
  `litho_snap_tolerance_m`; the real-data check confirms it does not spawn slivers
  or swallow a genuine thin unit straddling a surface.
- **Band assignment near a steep/crossing geo surface** — the `_band_index`
  count-surfaces-above rule assumes the geological surfaces do not cross within the
  hull (true for the Belgian Quaternary/Paleogene contact). Documented assumption,
  same as the strat builder.
