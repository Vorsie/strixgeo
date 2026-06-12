# Watertight loft body builder — the 3D model from the section partitions

- **Date:** 2026-06-12
- **Status:** design approved (owner, browser-companion brainstorm — 3D scenes)
- **Base:** develop (after litho-model-from-solids + the Issue-A own-base-floor fix
  `0e10f2ec`/`794afd99`; basal-clay overshoot is already resolved and out of scope)
- **Supersedes:** the per-body TIN internals of ``build_body_solids`` (M2/M3 paths:
  per-body top/base TIN fitting, the shared-contact surface cache, the
  facies-competitor prism machinery, the M2 legacy disk-marker fallback).
- **Owning layer (the first gate):** Python domain —
  ``RecomputeLithoSolids`` → a new loft builder service family. NOT the 2D
  section renderer, NOT the 3D viewer; their contracts are unchanged.

## Problem

The dogfeed on ``test.strix`` (2026-06-12) showed the built 3D litho model has:

1. **Holes** — bodies the builder cannot triangulate fall back to flagged disk
   markers: single-test bodies (``picks=1``), collinear footprints
   (``picks=3`` on one section line → Qhull degenerate), and facies
   competitors with no prism ("fall back to M2 legacy"). 32 of 110 bodies on
   the real model are markers; with markers hidden the rock is simply missing.
2. **Overlaps + hairline gaps** — every body fits its own top/base TIN over its
   own picks; between tests, neighbouring bodies disagree → interpenetration
   and daylight seams. Root cause flagged in M3: per-body independent surfaces
   cannot tile.

## Owner decisions (locked in the brainstorm)

1. **Success bar = B, export grade.** The bodies must *mathematically* tile the
   modelled domain: shared faces identical, union without voids, no
   interpenetration. "Not redoing this later."
2. **Domain:** lateral = **alpha-shape** (concave hull) of the participating
   tests, factor an owner-tunable knob mirroring the TIN-trim factor (4.0
   default); top = **ground surface** (DEM, G7); bottom = **deep base surface
   interpolated through the deepest-reaching tests** — a shallow test does NOT
   locally truncate the model (its area inherits the deep structure from
   neighbours), and nothing extrapolates below the locally-interpolated
   observed base.
3. **Geology prevails** (owner directive 2026-06-11): geological boundary
   surfaces slice the domain into HARD bands; litho never crosses a band
   boundary; the litho partition fills within each band.
4. **Architecture = loft the 2D section partitions** (option 1 of 3). The
   validated per-section partition (``computeSectionFill``) is the authored
   interpretation; the 3D model is its interpolation between sections. The
   fence diagram is this model's wireframe.
5. **Pinch rule:** a body present on one section but not its neighbour pinches
   to zero thickness exactly at the **equidistance midline** between the two
   sections (the 2D lens rule generalised). Mesh geometry ENDS at the pinch
   line — no zero-thickness skins.
6. **Persistence:** solids live in the **DB** (``litho_body_solid``, as today)
   **and in the ``.strix`` bundle**, so a freshly-opened file can export
   without a rebuild. Build model overwrites them (existing upsert + orphan
   delete semantics). Pre-ship amnesty: no ``format_version`` bump.

## Design

### 1. Where it lives

- ``RecomputeLithoSolids`` (application) keeps its contract: same endpoint,
  same response shape, same checksum/staleness machinery, same per-body
  ``litho_body_solid`` rows (vertices + triangles).
- The builder internals are replaced by a loft pipeline of pure domain
  services (one responsibility each):
  - ``domain/services/section_partition.py`` — **Python port of
    ``computeSectionFill``** (the TS implementation stays the live 2D
    renderer). Golden-parity tests pin the two implementations to each other
    (fixtures generated from the TS side; identical region output per
    section).
  - ``domain/services/model_domain.py`` — alpha-shape lateral boundary,
    ground-surface top, deep-base bottom (through deepest-reaching tests).
  - ``domain/services/loft_field.py`` — the blended per-column stack field
    (section 3 below).
  - ``domain/services/loft_mesher.py`` — wedge meshing + per-body extraction
    (section 4 below).
- Frontend, fence, 2D model fill, Build button: **unchanged**. The 2D
  ``ModelFillOverlay`` keeps sampling whatever meshes the builder stores.

### 2. Domain skeleton

- **Lateral wall:** alpha-shape of all participating tests (knob:
  ``view_state`` litho-segmenter pref, default mirrors TIN trim 4.0).
- **Top:** the ground surface (existing G7 ground TIN / test elevations).
- **Deep base:** a surface interpolated through the **deepest-reaching tests
  only**. Tests that stop shallow contribute no depth constraint; the deep
  structure interpolates across their area. Nothing is modelled below this
  surface.
- **Geological bands:** the geological model's boundary surfaces (already
  snapped/clipped by the shipped geo-bounding work) slice the domain into
  bands. Bands are watertight by construction (bounded by two consecutive geo
  surfaces + the walls). Litho volumes are built per band and clipped to it.

### 3. The loft field (the core algorithm)

- **Map-plane triangulation:** scipy Delaunay over (a) a grid filling the
  alpha hull (density knob), (b) the hull boundary vertices, and (c) nodes
  **densified along every section line** so triangle edges closely follow the
  sections. No constrained-CDT dependency: at a node ON a section line the
  field reproduces that section's partition EXACTLY (weight 1), so fidelity at
  sections scales with densification, and the field is continuous everywhere
  regardless. (License note: ``triangle``/``gmsh`` are not commercially
  usable; scipy is already in the stack.)
- **Per-node stack:** find the **two nearest sections** (distance to their
  polylines; d1 ≤ d2). Evaluate each section's partition stack at the node's
  projection onto it. **Match stack entries by ``body_id``** (the resolver
  already provides cross-section body identity via shared layers/ties). Blend
  matched interface depths by inverse distance (w1 = d2/(d1+d2)).
- **Pinch:** a body present on only one of the two sections gets thickness
  scaled by max(0, 2·w_its_section − 1) — zero exactly at the equidistance
  midline, full thickness at its own section.
- **Between vs beyond (when does a node blend two sections?):** a node blends
  its two nearest sections when it lies BETWEEN them — its projection onto
  the axis connecting the two projection points has parameter t ∈ [0, 1].
  Otherwise the node is governed by its nearest section alone
  (single-section extrusion): geological bands and regions the 2D partition
  classifies as **BAND** (2-corr) continue to the alpha wall; **ONLAP/LENS**
  regions (1-/0-corr) pinch at the existing ``open_extent_length_m`` knob.
  This reuses the 2D termination taxonomy verbatim — no new "matrix"
  concept.
- **Uninterpreted volume:** any band volume not covered by litho regions is
  assigned to the **band itself** as a band-level body (renders in the
  formation's colour). The tiling is always complete — this is what makes
  "union fills the domain" achievable everywhere.
- **Bodies on no section:** a body whose tests project into no section
  corridor cannot shape the loft. It is stored flagged
  (``is_flagged=true``) with the actionable meaning "not on any section —
  draw a section through these tests"; its space belongs to the enclosing
  band body. This is the only surviving use of the flag; disk-marker geometry
  is retired.

### 4. Meshing + the watertightness guarantee

- Per map triangle, the three corner stacks have identical body sequences (the
  field is continuous; matching is by ``body_id``; ties broken
  deterministically). Emit one **wedge prism per unit per triangle** (3 top
  vertices + 3 base vertices).
- Neighbouring wedges share faces exactly — same node, same blended depth —
  so the union **tiles the domain by construction**: no holes, no overlaps,
  no T-junctions along shared edges. Watertightness is a property of the
  construction, not of a repair pass.
- **Per-body mesh** = union of the body's wedges with internal faces dropped →
  one closed manifold per body (or per disconnected component). Pinch lines
  close the mesh with a degenerate-free seam (geometry ends at the pinch).
- **Determinism:** identical inputs → identical triangulation (sorted point
  insertion, stable section ordering) → byte-identical meshes. This is what
  lets the bundle carry solids that a rebuild reproduces exactly.

### 5. Retired / kept

- **Retired:** per-body top/base TIN fitting, ``litho_contact_surfaces`` cache,
  ``litho_facies_partition`` + ``assemble_facies_competitors`` prisms,
  ``_legacy_body`` M2 fallback, disk-marker emission.
- **Kept:** ``ResolveLithoInstances`` (``body_id`` is the loft's matching
  key), geo-bounding (feeds the band skeleton), the fence builder (unchanged;
  now provably consistent with the model), ``litho_body_solid`` schema + API +
  staleness/checksum, the 2D fill, the Build button flow.

### 6. Validation

- **Invariant suite (unit/integration, every build in tests):**
  Σ body volumes ≈ domain volume (ε); sampled pairwise no-overlap; per-mesh
  closed-manifold check (existing ``mesh_test_helpers`` ray logic);
  ``solid_min_elev ≥ body_deepest_pick_elev − ε`` (the handoff regression
  guard); 3D-at-section == 2D partition (slice the meshes at a section plane,
  compare to ``computeSectionFill`` regions).
- **Voxel oracle:** a brute-force rasteriser (test-only) assigns lithology per
  column from the same field and cross-checks random (x, y) stacks against
  the meshes. Bulletproof reference for any degenerate layout.
- **Golden parity:** TS ``computeSectionFill`` ↔ Python port on shared JSON
  fixtures (generated from the TS side, committed).
- **Real-data eval:** rebuild ``test.strix``; the handoff SQL diagnostic
  (per-lithology solid-vs-pick elevations); owner dogfeed.
- **e2e:** un-``fixme`` ``flow_litho_facies`` (single-CPT VEEN gets a real
  volume — assert non-flagged + volume > 0); ``flow_litho_solids`` stays
  green.
- **Bench:** extend ``bench_litho_solid_builder.py`` to the loft pipeline;
  budget = on-click Build, a few seconds at ``test.strix`` scale.

### 7. Persistence (DB + bundle)

- ``litho_body_solid`` rows persist per body as today; Build overwrites
  (upsert + orphan delete).
- **Bundle:** bundle-build serialises the model's solid rows (mesh,
  ``body_id``, ``formation_id``, ``display_color``, ``is_stale``, checksum);
  bundle-restore writes them back. Pre-ship amnesty: no ``format_version``
  bump (same precedent as ``bodies[]``). A freshly-opened ``.strix`` can
  therefore export geometry without a rebuild; staleness rides along so the
  UI still knows when solids predate a contact edit.
- Size: modest at current scale (110 bodies, mostly 14–80 vertices).
  Compression is a later concern if a giant model bloats the file.

## Out of scope

- The exporters themselves (DXF-3D / Plaxis 3D / IFC volume export — Tier D /
  Phase 5; this design produces the export-grade meshes they will consume).
- Crossing-section visual refinement beyond the continuous two-nearest blend.
- Phase-5 parameters; any UI rework beyond the flag-message copy.

## Open implementation questions (resolve in the plan)

1. Deep-base + geo band surface evaluation: reuse the existing TIN services
   (``compute_tin`` + geo-bounding's band surfaces) vs a thin wrapper — pick
   whichever keeps one source of truth per surface.
2. "Deepest-reaching tests" membership rule (e.g. reaches the lowest geo band
   present locally vs a depth quantile) — make it a pure helper + test it.
3. Stack-matching tie-breaks when a body appears twice in one column
   (re-entrant) — order by depth, match pairwise by rank.
4. Exact serialisation shape of solids in the bundle (mirror the API response
   field names).
