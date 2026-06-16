# Smooth watertight 3D litho model — the implicit stratigraphic-potential builder

- **Date:** 2026-06-13
- **Status:** design approved (owner)
- **Supersedes:** the watertight loft mesher (`loft_field.LoftField` + `loft_mesher.build_loft_meshes`),
  which produces metre-scale overlaps on real interbedded data (see Problem).
- **Owning layer (the first gate):** Python domain — `RecomputeLithoSolids` →
  a new `strat_field` builder family. NOT the 2D section renderer (kept), NOT
  the 3D viewer (kept). This is a **from-scratch module**; it does not edit the
  2D fill, the fence, or the map.
- **Base / branch.** The reusable foundation (`model_domain`,
  `section_partition`, the `litho_body_solid` bundle carriage, the
  `RecomputeLithoSolids` wiring, the band-filler-off litho-model decision) lives
  on branch `feat-litho-3d-watertight-loft`, NOT on `develop`. The strat builder
  replaces only `loft_field` + `loft_mesher`, so it branches **from
  `feat-litho-3d-watertight-loft`** (keeping the good parts, retiring the wedge
  mesher). The first plan step resolves whether to first land that branch's
  reusable parts onto `develop` or to fork directly. The loft mesher itself must
  NOT be merged to `develop` as-is — it produces the overlapping model this
  design replaces.

---

## Problem

The watertight loft builder (branch `feat-litho-3d-watertight-loft`,
spec `2026-06-12-watertight-loft-body-builder-design.md`) builds the 3D litho
model by emitting one prism *wedge* per body per map-triangle and welding shared
faces. Watertightness relies on assigning every body a single **global
top-to-bottom slot** (`loft_mesher._node_interfaces` / `_global_body_order`,
ordered by mean elevation), so that every triangle touching a node computes the
same interface array and faces weld.

This holds only for **layer-cake** stratigraphy. On the owner's real model
(`test.strix`, 14 sections, heavily interbedded ZAND/SILT/KLEI) it fails:
instrumented ray-sampling at the 58 authored test columns found **50 interior
overlaps between different lithologies — median 1.17 m, p90 5.6 m, max 9.2 m**
of interpenetration (KLEI/ZAND, KLEI/SILT pairs dominate). The cause: where the
local stacking order at a node disagrees with the global mean-elevation slot
(any dipping or interbedded sequence), the cursor logic in `_node_interfaces`
places a body's wedge at the wrong elevation, overlapping its neighbour. The
synthetic invariant tests never caught it because they used only layer-cake
fields with no geological bands.

The global-slot assumption is *load-bearing* for the welding, so it cannot be
patched out — the per-triangle-wedge primitive is fundamentally limited to a
consistent global vertical order. Interbedding and lateral pinch-outs (which the
owner confirms are the norm in BE/NL Quaternary/Tertiary) demand a different
primitive.

### What we keep

The loft **field is not the problem** — at any (x, y) the per-column stack is a
correct, gap-free, ordered partition; `compute_section_fill` (the 2D render) and
`model_domain` (alpha hull / DEM top / deep base) are sound. We keep the 2D
partition, the domain, the persistence contract, and the data-loading. We
replace the **mesher** (the prism + global slot) with a smooth implicit model.

---

## Approach: a stratigraphic potential field

The Lajaunie (1997) / LeapFrog / GemPy method. Interpolate a single smooth
scalar field `F(x, y, z)` over the domain. Each litho **contact is an
isosurface** `F = cᵢ`; the iso-values `c₁ < c₂ < …` are ordered by stratigraphic
position. A **body is the volume between two consecutive isosurfaces**
(`cᵢ ≤ F < cᵢ₊₁`); its **lithology is a lookup** from stratigraphic position.

Why it fits the requirements:

- **Smooth** — `F` is a smooth interpolant (RBF / thin-plate spline via SciPy),
  so every contact surface is smooth, not blocky; a finer evaluation grid only
  smooths further, never staircases. (Owner rejected voxels for this reason.)
- **Interbedding is free** — ZAND/SILT/ZAND/SILT is four iso-intervals; the same
  lithology at two horizons is two intervals that both look up "ZAND". No
  special case.
- **Pinch-outs are free** — a layer pinches exactly where `F` stops spanning its
  `[cᵢ, cᵢ₊₁]` interval; the isosurface terminates naturally.
- **Folds are free** — the field bends with the orientation data; a folded
  sequence is still one conformable field.
- **Watertight by construction** — consecutive isosurfaces of one smooth field
  are *nested and cannot cross*, so the bodies between them tile with no gaps or
  overlaps. This is the property the wedge mesher could not guarantee.

### Owner decisions (locked in the brainstorm, 2026-06-13)

1. **Smooth, from scratch.** Build the implicit engine; do not reuse the wedge
   mesher. Voxel/labelled-grid modelling is explicitly deferred as a *separate*
   later modelling style.
2. **Python + SciPy, NOT Rust.** The hot paths (RBF solve = LAPACK, field
   evaluation = BLAS, marching cubes = scikit-image C) are already compiled
   native code; Rust would re-port optimised numerics for no gain, complicate
   distribution (Electron + Python + a PyO3 wheel), and fight the testability /
   visual-iteration requirement. Numba stays the documented escape hatch if a
   *pure-Python* hot loop is ever profiled; Rust is deferred until a profile
   earns it. (Consistent with the project's "profile first, Numba before Rust,
   no active Rust candidates" stance.)
3. **Conformable v1 + a per-block seam for faults/unconformities.** v1 assumes a
   consistent stratigraphic order (dips, pinch-outs, interbedding, folds all
   handled). Faults and unconformities — domain-partitioning surfaces — are
   designed-for via a **per-block interpolation interface** that v1 runs with
   exactly **one block**. Adding faults later = compute fault surfaces, partition
   into blocks, run the same per-block interpolation N times, stitch at the fault
   surfaces. No core rework. Folds need nothing.
4. **Geology coupling stays OUT of the litho model** (owner directive
   2026-06-13, from the band-filler removal): the litho model is pure litho. The
   per-block seam will later host geological bounding in the **geotech** model.
5. **Super-testable + visually inspectable at every stage** (first-class owner
   requirement). Each of the six pipeline stages has unit tests against
   **real-data-shaped fixtures** (interbedded, pinching, dipping — not
   layer-cake) AND emits a **standalone HTML 3D/slice preview** the owner opens
   in a browser before the next stage is built (the same workflow as the
   existing `section_preview.html` / `geo_aligned_preview.html`).
6. **Persistence unchanged.** `RecomputeLithoSolids` keeps its endpoint, outcome
   shape, `litho_body_solid` rows, checksum/staleness, and `.strix` bundle
   carriage (Tasks shipped on the loft branch). Only the mesh-production internals
   change.

---

## Architecture — six stages, one new module

Proposed package: `src/groundmodel/domain/services/strat_field/` (a cohesive
from-scratch module; the new session may flatten to `strat_*` files if it
prefers the existing flat convention). Each stage is a pure domain unit with one
responsibility, a well-defined value-object interface, and independent tests.

```
RecomputeLithoSolids (application — wiring kept)
  └─ assemble inputs (reuse the litho-layer / correlation / section loaders)
        └─ StratControlData            (Stage 2 output)
  └─ build_strat_model(control, domain, blocks=[whole_domain])   ← NEW
        Stage 1  stratigraphic_order(control)        → StratColumn (horizon order + iso-values)
        Stage 3  fit_potential_field(control, order, block) → PotentialField  (F evaluable on a grid)
        Stage 4  extract_isosurfaces(field, order, grid)    → list[ContactSurface]  (smooth, shared)
        Stage 5  assemble_bodies(surfaces, order, domain)   → list[LithoBodyMesh]   (closed, watertight)
        Stage 6  validate(bodies, field, control)           → invariants + section-vs-column diff
  └─ persist (litho_body_solid rows + bundle — kept)
```

### Stage 1 — Stratigraphic order

Derive the ordered horizon list + iso-value assignment **from the correlation
topology, not from elevation.** Each litho contact (between body *above* and
body *below*) is a horizon. Every investigation column gives a partial order
(its top-to-bottom stacking); the global stratigraphic order is the **topological
sort** of the merged partial orders.

- **Conformable ⟺ the merged order is a DAG.** A cycle in the topological sort is
  exactly a non-conformable relationship (a contact that is above another here
  and below it there) — the v1 boundary. v1 **detects a cycle and reports it as
  an actionable error** ("these contacts imply an unconformity/fault — not yet
  supported"); it does not silently mis-order (the loft's mean-elevation sin).
  The reported cycle is precisely where the future fault/unconformity block split
  will go.
- Iso-values: assign `cᵢ` by topological rank (evenly spaced; the field's
  smoothness, not the spacing, sets geometry). Interbedding handled — repeated
  lithologies get distinct ranks.
- Output: `StratColumn` = ordered `[Horizon(rank, iso_value, above_formation,
  below_formation, contact_ids)]`.
- **Visual:** the stratigraphic column / horizon DAG (an HTML diagram).
- **Tests:** an interbedded conformable column sorts correctly; two columns with
  consistent partial orders merge; an inconsistent pair raises the cycle error
  naming the offending contacts.

### Stage 2 — Control data

Build the interpolation constraints from the same DB data the assembly already
loads (litho layers per investigation + the section-drawn contacts + the
correlations):

- **On-contact points** `(x, y, z, horizon_rank)` — each observed contact in a
  borehole/CPT, tagged with its horizon's iso-value (an *equipotential*
  constraint: all points of one contact share `F = cᵢ`).
- **Section-drawn contacts** — the contacts the user placed on cross-sections
  add `(x, y, z, horizon_rank)` points along the section lines (denser
  constraint where the user interpreted).
- **Orientation constraints** — gradients that keep `F` well-behaved (the
  potential method needs them or it "bubbles"). v1 derives them WITHOUT explicit
  dip measurements: (a) the per-borehole vertical ordering gives a local up-
  section gradient (F increases upward through the stratigraphic order); (b) the
  along-section slope of the user-drawn contacts gives the in-section dip.
  Explicit dip-measurement input is deferred.
- Output: `StratControlData` = points + orientations + the `StratColumn`.
- **Visual:** the tagged control-point cloud in 3D, coloured by horizon.
- **Tests:** points extracted from a synthetic interbedded borehole carry the
  right ranks; section contacts contribute along-line points; orientation
  derivation produces sane up-section gradients on a dipping fixture.

### Stage 3 — Potential-field interpolation

Fit `F(x, y, z)` through the control data, **per block** (v1: one block = the
whole domain).

- Method: SciPy `RBFInterpolator` (thin-plate / smoothed kernel) over the
  on-contact points (value = iso-value) augmented with the orientation/gradient
  constraints (co-kriging-style; the increment + gradient formulation of
  Lajaunie/GemPy). The exact kernel + regularisation are **tuned in-stage**
  against the visual field-slice preview and the monotonicity test — the spec
  fixes the interface (`PotentialField.evaluate(points) -> ndarray`), not the
  kernel constants.
- `block` is a value object describing the region (v1: the alpha-hull prism). The
  interface takes `blocks: list[Block]` so faults later add blocks; v1 passes one.
- Output: `PotentialField` with `.evaluate(xyz)` (vectorised) and the grid it was
  validated on.
- **Visual:** horizontal + vertical slices of `F` (heatmaps) + two raw
  isosurfaces, in an HTML viewer.
- **Tests:** **monotonicity invariant** — at every borehole, `F` evaluated down
  the hole is strictly increasing across the known contacts and crosses each
  `cᵢ` at (≈) the observed contact depth (within tolerance). A dipping-sequence
  fixture reproduces the dip. An interbedded fixture reproduces the repeats.

### Stage 4 — Isosurface extraction

Extract each contact isosurface once (so it is **shared** by the bodies above
and below — no double walls).

- Evaluate `F` on a fine 3D grid over the block; `skimage.measure.marching_cubes`
  at each `cᵢ` → a smooth triangle surface. (scikit-image is BSD — commercial-OK.)
- Optional Laplacian smoothing of each surface for extra polish (topology-
  preserving); the grid resolution is the primary fidelity knob.
- Clip each surface to the domain (alpha-hull wall, DEM top, deep base — reuse
  `model_domain`).
- Output: `list[ContactSurface(horizon_rank, vertices, triangles)]`.
- **Visual:** the smooth contact surfaces, coloured by horizon, in 3D.
- **Tests:** each surface is a manifold patch; surfaces are nested (do not cross
  — sampled pairwise); a pinch-out fixture produces a surface that terminates
  (does not span the whole domain).

### Stage 5 — Body assembly

Close each body between its two bounding isosurfaces + the domain caps into a
watertight `LithoBodyMesh` (the existing value object, reused unchanged).

- Body *k* = the region `cₖ ≤ F < cₖ₊₁` ∩ domain. Its surface = the (shared) top
  isosurface `F = cₖ₊₁` + the (shared) base isosurface `F = cₖ` + the lateral
  alpha-hull wall + the DEM-top / deep-base caps where the body reaches them.
- Because the bounding isosurfaces are the *same* meshes shared with the
  neighbouring bodies, adjacent bodies share faces exactly → watertight, no
  overlap (nested isosurfaces cannot cross). A body that pinches everywhere
  (zero volume) is omitted.
- Deterministic vertex/triangle ordering (the bundle replays it).
- Output: `list[LithoBodyMesh]` (one per body / per disconnected component),
  `is_flagged=False`.
- **Visual:** the coloured solids, orbitable.
- **Tests:** closed-manifold + pairwise no-overlap + tiles-the-domain invariants
  (Stage 6 helpers) on each body; a pinch-out body closes to a smooth tip.

### Stage 6 — Validation + persistence

- **Invariant suite, run on REAL-DATA-SHAPED fixtures** (interbedded, pinching,
  dipping, folded — the coverage gap that hid the loft bug): closed manifold per
  body; sampled pairwise no-overlap (strict); union tiles the domain.
- **Section-slice ↔ authored-column diff** — formalise this session's diagnostic
  as a test: ray-sample the bodies at the authored test columns and assert the
  model stack matches the authored litho stack (formation + ordering + no
  overlap) within tolerance. This is the test that would have caught the loft's
  50 overlaps.
- **Real-data eval** — rebuild `test.strix`; the column-diff overlaps must be ~0
  (vs. 50 on the loft); owner dogfeed on the smooth model.
- **Persistence** — unchanged: `RecomputeLithoSolids` upserts `litho_body_solid`
  rows + the bundle carries them (already shipped on the loft branch).

---

## What is reused / replaced / new

- **Reused unchanged:** `model_domain` (alpha hull / DEM top / deep base),
  `compute_section_fill` (the 2D render — the authored partition, which the
  section view should show), `LithoBodyMesh` (value object), the litho-layer /
  correlation / cross-section DB loaders, the persistence + bundle path, the
  `RecomputeLithoSolids` external contract.
- **Replaced:** `loft_field.LoftField` (`stack_at`) and
  `loft_mesher.build_loft_meshes` — the wedge + global-slot mesher. Retired once
  the strat builder is wired and green (same care as the per-body-TIN retirement).
- **New:** the six-stage `strat_field` module + its real-data-shaped fixtures +
  the per-stage HTML previews.

The band-filler clip (`loft_field._clip_to_bands`) is already disabled for the
litho model (owner directive 2026-06-13); the strat builder simply never has it.

---

## How it handles each case (summary)

| Case | Mechanism |
|---|---|
| Interbedding (repeat lithologies) | Distinct iso-intervals; lithology is a per-interval lookup. Free. |
| Lateral pinch-out | The isosurface terminates where `F` stops spanning `[cᵢ, cᵢ₊₁]`. Free. |
| Folds / dips | The field bends with the orientation constraints. Free. |
| Faults / unconformities | Per-block interpolation seam (v1 = one block); detected as a topological-sort cycle in Stage 1. Designed-for, not built. |
| Watertight | Nested isosurfaces of one smooth field cannot cross → bodies tile. |
| Smooth | RBF field + marching cubes on a fine grid (+ optional smoothing). |

---

## Out of scope (v1)

- Faults, unconformities, cut-and-fill (the per-block seam is designed; the
  block-partitioning + fault-surface interpolation + stitching are a later
  milestone). v1 reports a non-conformable cycle as an actionable error.
- Explicit dip-measurement ingestion (orientations are derived in v1).
- Voxel/labelled-grid modelling (a separate later style, per owner).
- Geological-band coupling (geotech model, later).
- The exporters themselves (DXF-3D / Plaxis / IFC) — this produces export-grade
  meshes they will consume.

---

## Open implementation questions (resolve in the plan / in-stage)

1. **RBF kernel + regularisation + the gradient-constraint formulation** —
   thin-plate vs. multiquadric, the increment/co-kriging weighting, smoothing
   factor. Fixed by the Stage-3 monotonicity test + visual, not by the spec.
2. **Grid resolution vs. build time** — the fidelity/perf knob. Target: the real
   `test.strix` build in a few seconds (the strat field replaces the per-node TIN
   scans that dominated the loft's 11.7 s). Profile the real build; expose
   resolution as a `view_state` pref like `open_extent_length_m`.
3. **Disconnected components** — a body that appears in two separate areas
   (same lithology, two basins) → one isosurface-interval region with two
   components; extract each as its own `LithoBodyMesh` (the loft already split
   components; mirror it).
4. **Marching-cubes vs. dual-contouring** for the isosurface — marching cubes is
   simplest and scikit-image-backed; dual contouring is smoother at sharp
   features but more code. Start with marching cubes; revisit only if the Stage-4
   visual shows objectionable facets.
5. **The HTML preview harness** — one shared `strat_field/preview.py` that writes
   a self-contained Three.js (or plotly) scene per stage; decide the library in
   Stage 1 and reuse it (the owner already runs `*_preview.html` files).
