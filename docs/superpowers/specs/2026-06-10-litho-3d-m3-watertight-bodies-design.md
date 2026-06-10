# M3 — watertight 3D litho bodies (shared contact surfaces)

**Status:** design approved (brainstormed in the browser companion 2026-06-10, lens-void
spike PASSED). Ready for an implementation plan.
**Extends:** `docs/superpowers/specs/2026-06-09-litho-3d-model-design.md` (Part B / M2 shipped
the per-body solids). This is milestone **M3**.
**Branch:** off `develop`.

---

## 0. In plain words

The 3D litho viewer builds one closed solid per body. Today each body fits its **own** copy of
every contact surface from its **own** member investigations. The contact between two stacked
bodies (e.g. base-of-SAND = top-of-CLAY) therefore gets fitted **twice**, from **different**
hole-sets — so the two surfaces don't coincide and leave a **hairline / hole** along the
interface (worst where the hole-sets differ most). The owner sees this as a long horizontal seam
running the full width between stacked units, plus voids at pinch-outs.

M3 makes the bodies **tile watertight**: every contact is fitted **once** and shared by the body
above and the body below. Pinch-outs become surfaces meeting; an enclosed lens becomes a matrix
body with an interior void whose walls are the lens's own (shared) surfaces. No boolean-CSG
library.

---

## 1. Problem & root cause

`litho_solid_builder.build_body_solids` builds a body mesh as `[top TIN] + [flipped base TIN] +
[side walls]` and caches surfaces in `surface_cache` keyed by **`_surface_key`** — the full
sorted pick-set including each point's `(investigation_id, x, y, z)`. Two bodies share a surface
**only when their pick-sets are byte-identical**, i.e. they span exactly the same investigations.
That is the rare case. Whenever the body above and below have **different lateral extents**
(SAND on 40 holes, CLAY on 51 — the normal case), the keys diverge, each body re-fits the contact
over its own hole-set, and the surfaces drift apart.

The builder's docstring claims "two bodies sharing a contact reference identical surface geometry
→ watertight by construction." That is true **only** in the equal-extent case; M2 never achieved
it for the interesting contacts.

### Spike evidence (`_spike_lens_void.py`, throwaway, 2026-06-10)

- **Independent fits coincide where extra holes fall OUTSIDE the shared hull** (Delaunay is local):
  a clean pinch where CLAY simply continues past SAND's footprint → **0.00 cm** gap.
- **Independent fits DRIFT where the extra holes interleave INSIDE the shared footprint** (CLAY's
  extra holes refine its TIN differently from SAND's) → **up to 75 cm** vertical gap. This is the
  whole-section hairline.
- **The lens void is cheap:** a matrix solid with the lens surface appended **reversed** is a
  watertight 2-manifold whose point-in-solid parity is exactly "matrix minus lens"; the cavity
  walls equal the lens surface (0 gap). No CSG.

---

## 2. Goal & success criteria

Build, from the stored model, one **closed watertight 2-manifold per body** such that adjacent
bodies **share boundary geometry** and the set of body solids forms a true 3D partition (no gaps,
no overlaps) over the region the data covers.

Covered geometry (owner directive 2026-06-10: **include interfingering lenses now**):
1. **Through-going** stacked contacts.
2. **Pinch-outs** (a body's lateral extent ends inside the model).
3. **Same-lithology stacked** bodies (two CLAY bodies meeting).
4. **Enclosed lenses / interfingering** — a lens body inside a matrix body that is the same
   lithology above and below it (the model already merges the host halves into one body, see
   `plan_enclosed_lens_merges.py`).

Done when:
- Every body mesh passes the closed-2-manifold check (every undirected edge in exactly 2
  triangles; every directed edge once).
- No two body solids overlap by more than a small tolerance (sampled point-in-solid check), and
  there is no gap along a shared contact (shared surfaces are byte-identical, gap = 0).
- The whole-section hairline in the dogfeed (`test.strix`) is gone, and a known lens renders
  carved out of its matrix.

Out of scope: 3D **export** (DXF / Plaxis — Tier D, separate spec); advanced uncertainty
envelopes (Phase-5 debt #205); any interfingering geometry the 2D model does not already produce
(M3 mirrors the 2D model, it does not invent new facies geometry).

---

## 3. Design — one surface per contact, shared by both sides

### 3.1 Contact-centric surfaces (the load-bearing change)

Stop keying surfaces on the pick-set. Key them on the **contact's identity**.

The litho column is gap-free (contiguity triggers: base-of-layer-i = top-of-layer-(i+1)). So at
each investigation, the interface between the body directly above and the body directly below is a
single `FormationContact`. Group these contact points across investigations into **contact
patches**: a patch = a maximal set of holes where the **same ordered body pair** (A above, B
below) is adjacent. Fit **one TIN per patch** over exactly those holes. That patch surface is used
as **A's base** and **B's top** over the patch — referenced, never re-fit.

- A body's **top boundary** = the union of the patches where something overlies it (often one
  patch for a through-going body; several where different bodies overlie it in different places).
- A body's **base boundary** = the union of the patches below it.
- Patches that meet along a transition line (where adjacency changes — a pinch line) share that
  boundary's vertices, so they **conform** (no T-junction, no drift). The spike showed a clean
  pinch already yields 0 gap, so this stitch is geometrically benign; the requirement is to fit
  each patch over its own shared holes, not over a body's full hole-set.

### 3.2 Footprint-aware closure

`_assemble` currently relies on top and base sharing one topology (one TIN each). With patchwork
boundaries a body's top and base no longer share a single triangulation. Close each body with side
walls along its **real lateral boundary** (the alpha-shape edge of its footprint), connecting the
top boundary loop to the base boundary loop. A pinch-out is the degenerate case where the top and
base patches meet at the extent edge (zero thickness there).

### 3.3 Enclosed lens void (interfingering)

A matrix body wrapping a lens is one body (the host halves are merged — `plan_enclosed_lens_merges`).
The lens's top and base contacts are **interior** to the matrix (matrix lithology above and below,
lens fully inside). Build the matrix as **its outer closed solid + the lens body's surface appended
with reversed winding** as an internal cavity. The lens body is built normally; its surface and the
matrix's cavity wall are the **same geometry** (shared) → they tile with 0 gap. Validated by the
spike: watertight, and point-in-solid parity = matrix-minus-lens. **No CSG.**

---

## 4. Inputs & reuse (no new heavy deps)

| Need | Reuse |
|---|---|
| Surface fitting | `domain/services/tin_surface.compute_tin` (SciPy Delaunay + alpha trim) |
| Body membership (`body_id`) | `ResolveLithoInstances` (connected components of approved edges) |
| Matrix-wraps-lens knowledge | `plan_enclosed_lens_merges` / `classify_enclosed_lenses` |
| Contact identity / gap-free column | `FormationContact` + contiguity triggers (layer_id == top contact id post-A4) |
| Per-pick (x, y, surface_elev, depths) | existing `BodyLayerPick` assembly path |
| Mesh value object, ORM, API, viewer | `LithoBodyMesh`, `litho_body_solid`, litho-solids API, `Geology3DViewer.buildSolidPrimitive` (mesh shape is unchanged — still vertices + triangles) |

The output contract (`LithoBodyMesh` = vertices + triangles, optionally `is_flagged`) **does not
change**, so the ORM / API / client / Cesium renderer are untouched. M3 is a **rewrite of the
builder's surface-sharing + assembly only**.

---

## 5. Components to change

- `domain/services/litho_solid_builder.py` — the rewrite: contact-patch grouping + shared-surface
  fitting (cache keyed on contact-patch identity, not pick-set); footprint-aware `_assemble`;
  lens-void append. Likely split helpers into `litho_solid_builder/` (patches, assembly, void) if
  the file grows past ~one screen of responsibility.
- `domain/services/tin_surface.py` — only if patch-boundary conforming needs a constrained insert
  (TBD by the planning spike; avoid if the patch-over-shared-holes approach suffices).
- Tests — see §6.
- `RecomputeLithoSolids` + the 6-site stale cascade — unchanged trigger points; only the builder
  internals change.

No schema / API / bundle change. No new dependency.

---

## 6. Testing strategy

- **Unit (pure domain), TDD:** port the spike's checks into `tests/unit/domain/services/`:
  closed-2-manifold per body; lens-void parity (void point outside matrix, off-lens inside); shared
  surface coincidence (a contact patch's vertices are identical in both adjacent bodies); pinch
  yields 0 gap; a two-body stack shares its interface exactly. Cover happy path + same-lithology
  stack + enclosed lens + a pinch-out.
- **No-overlap invariant:** sample points across a small synthetic model, assert each point is
  inside at most one body solid (allowing the shared boundary).
- **Bench:** existing `bench_litho_solid_builder.py` re-run; the contact-patch grouping must stay
  within the M2 envelope (200 bodies ≈ 1 s on Build). Add a case with a lens.
- **Real-data dogfeed (the definitive gate):** owner runs `test.strix` in the app — the
  whole-section hairline gone, a known lens carved from its matrix, no new holes. The `.strix`
  bundle cannot reconstruct contacts offline (derived server-side), so live-app dogfeed is the
  real validation, as with the 2D partition.

---

## 7. Risks & open questions

- **Patch assembly is the real new code** (not the void). A body whose top is several patches
  stitched along pinch lines is the case to get right. Recommend a **second small spike during
  planning**: build a two-patch top (A/B over part, A/C over the rest) and confirm the stitched
  body is watertight, before committing the full builder rewrite.
- **Alpha-shape boundary per body** must be stable enough to wall against; `compute_tin`'s trim
  (factor 4.0) governs this. Watch for a body whose footprint alpha-shape differs between top and
  base patches — the walls must follow one agreed footprint boundary.
- **Concave bodies + voids** are valid for SVG/Cesium today; the future 3D **export** (Tier D)
  must accept concave + voided solids. Flag it in that spec; not an M3 blocker.
- **Degenerate / <3-pick bodies** keep the M2 disk-marker fallback (`is_flagged`).

---

## 8. Build order

1. Planning spike: two-patch stitched body watertight (de-risk §3.1/§3.2 assembly).
2. TDD the contact-patch grouping + shared-surface cache (kills the 75 cm drift).
3. TDD footprint-aware `_assemble`.
4. TDD lens-void append (port the passed spike).
5. No-overlap + manifold invariants across a synthetic multi-body model.
6. Bench; then owner dogfeed on `test.strix`.
