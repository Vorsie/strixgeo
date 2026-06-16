# Geology-bounded, matrix-backbone implicit litho builder with lens-in-lens

- **Date:** 2026-06-14
- **Status:** design approved (owner)
- **Owning layer:** Python domain (`domain/services/strat_field/`) + the
  `RecomputeLithoSolids` application wiring. No 2D-render or frontend changes
  except an optional shared-classifier extraction (below). NOT the 3D viewer.
- **Base / branch:** `feat-litho-3d-strat-field` (the implicit-field builder,
  all 11 tasks shipped + reviewed, UNPUSHED off `develop`). This design fixes the
  one thing that blocks it on real data; build on the same branch.
- **Supersedes for this model:** nothing is retired — this EXTENDS the shipped
  implicit builder so it can build a non-conformable real model.

---

## Problem

The implicit stratigraphic field builder is complete and watertight-verified on
conformable fixtures, but it cannot build the real `test.strix` model. Stage 1's
topological sort of the 102 lithology bodies hits a directed cycle →
`NonConformableError` → all bodies flagged, **zero solids built**. The builder is
behaving correctly (it detects and reports the contradiction rather than silently
mis-ordering, the old loft builder's exact failure), but the model does not build.

**Why a single field cannot build it (mathematically, confirmed by an independent
math review):** a single smooth scalar field `F(x,y,z)` orders space by its level
sets, which cannot cross. So a stratigraphy that is non-conformable (a unit is
above another here and below it there) is a *topological obstruction*, not a
tuning problem. The cycle Stage 1 detects *is* that obstruction.

**The concrete root cause on `test.strix` (instrumented, not guessed):** the
cycles are *enclosure / over-merge*. The resolver `body_id` (connected components
of the user's correlations) transitively merges a recurring lithology across
horizons into one giant body — e.g. `KLEI#6bb744` is 60 layers spanning 0–11 m
and is recorded **above and below** the same SILT **in one borehole**
(`KLEI / SILT / KLEI`). One body cannot be both above and below another, so the
order cycles. There are exactly **2 small cycles (8 of 102 instances)**; the other
94 bodies order cleanly. Diagnostics: `scripts/eval_strat_cycles.py`,
`scripts/eval_geo_bounded_cycles.py`, `scripts/eval_lens_out.py`.

Two empirical facts that shape the fix:
1. **Geology-bounding alone does NOT break the cycles** — both cycles live
   *inside a single geological band* (`eval_geo_bounded_cycles.py`: bands 2 and 3
   still cycle). So the geological frame is not the cycle-fix.
2. **Lensing the enclosed minorities DOES break them** — treating the enclosed
   minority of each cycle (the SILT/ZAND between two KLEI/ZAND) as a *lens* in its
   matrix host and keeping the matrix whole makes the backbone conformable:
   `eval_lens_out.py` → 6 bodies lens out, the remaining **96-body matrix backbone
   is a clean DAG**.

---

## Approach (owner-approved)

Build the model as a **geology-bounded, matrix-backbone implicit field with the
enclosed minorities carved in as lenses (recursively → lens-in-lens)**:

1. **Geological blocks — the frame.** The litho model's parent geological model
   supplies hard band surfaces (the 4 Quartair/Paleogeen bands). The field is fit
   *within each band*; the geological surfaces are the band's hard top/base.
   Re-introduces the geology↔litho coupling the owner decided on 2026-06-11
   ("geology prevails — litho interfingers only within each geo unit"), and is the
   seam where faults/unconformities land later. *It is the truthful frame, not the
   cycle-fix.*
2. **Matrix backbone field.** Stage 1 orders only the **matrix** bodies (the
   conformable backbone — 96/102 on `test.strix`). The implicit field builds them
   watertight exactly as today — the engine is unchanged.
3. **Lens-in-lens carving (v1, full).** Each enclosed minority becomes a **lens
   carved out of its matrix host** (matrix-with-void + lens-fills-void). A lens
   enclosed within a lens is carved recursively.
4. **Shared enclosure classifier.** One pure domain helper decides matrix-vs-lens
   by the **enclosure criterion** (a body bracketed above-and-below by the same
   body in a column is a lens). Computed once on the global 3D instance stacks;
   the *same* criterion the 2D section classifier uses, extracted to a single
   source of truth so 2D and 3D never disagree.
5. **Monotone clamp.** A one-line `np.minimum.accumulate` on each column's contact
   heights makes watertight non-overlap a hard theorem (not merely sampled) and
   removes the VEEN −1.17 m overshoot class.

Because a subgraph of a DAG is a DAG, the global lens-out result (96-body backbone
is a DAG) **guarantees every per-band matrix backbone is conformable too** — so
the geological partition and the lens carving compose without re-introducing
cycles.

---

## Architecture

The shipped pipeline is `stratigraphic_order → control_data → potential_field →
iso_surface → body_assembly → strat_builder`, wired by `assemble_strat_inputs` +
`recompute_litho_solids`. The changes, by component:

### A. Shared enclosure classifier — `classify_lenses` (NEW, shared)
A pure domain helper: given the per-investigation litho stacks (the columns, with
each unit's `body_id` + lithology + depth order), return a **`LensPartition`**:
- `matrix_body_ids: set[str]` — the conformable backbone.
- `lenses: list[Lens]` where `Lens(body_id, host_body_id, depth_rank)` — each
  enclosed body tagged with the matrix (or lens) it is carved into; `depth_rank`
  gives the nesting order (host-of-host) for lens-in-lens.

**Criterion (enclosure):** body `B` is a lens-in-`M` when, in the columns where
both appear adjacent, `B` is bracketed *above and below by the same body* `M`
(`M / B / M`). Applied recursively: a body enclosed within a lens `L` is a
lens-in-`L`. The result must satisfy the **cross-check**: removing `lenses` from
the Stage-1 precedence graph yields a DAG (if it does not, a residual cycle is a
*true* interfingering that lens-out cannot resolve — surfaced as an actionable
error, see Out of scope).

**Sharing:** the enclosure test currently lives only in the 2D path
(`domain/services/classify_enclosed_lenses.py` + the TS `partitionFill`
classification). Extract the *criterion* into this one helper and have the 2D
classifier call it, so "what you author as a lens in a section is a lens in 3D" by
construction (and per the project's "extract on the second copy" rule). Where the
2D code is TS, the Python helper is the source of truth and the TS classification
is validated against it (no behavioural change to the 2D render in this design).

### B. Stage 1 change — order the matrix, emit the lenses
`build_stratigraphic_order` (and the `assemble_strat_inputs` mapping that feeds
it) gains the `LensPartition`:
- Build the precedence DAG over **matrix bodies only**. This is now conformable.
- A residual cycle on the *matrix backbone* (after lens-out) is a **genuine
  non-conformable order** (true interfingering / fault) → keep raising
  `NonConformableError` with the offending bodies (v1 limit).
- The `StratColumn` is unchanged in shape; the lenses ride alongside as a
  `LensPartition` consumed by the carving stage.

### C. Geological blocks — per-band fields
- `assemble_strat_inputs` loads the parent geological model's formation surfaces
  (the existing `GeologyRepository.list_surfaces` + the parked
  `divide_picks_by_geology` / band-surface machinery — most of the plumbing
  already exists, it was retired from the strat path in Task 8 and kept for the
  geotech model).
- Assign each litho pick to a geological band (by mid-elevation vs the surfaces at
  its (x,y); nearest-vertex fallback off-footprint, as the old code did). A
  litho contact within `litho_snap_tolerance_m` of a geological surface **snaps**
  to it; otherwise the pick **divides** at the boundary (the owner's 2026-06-11
  snap-or-divide directive).
- The `Block` value object gains **curved band bounds**: `top_surface` /
  `base_surface` (sampleable `z(x,y)` callables / TINs) instead of (or in addition
  to) flat `z_min`/`z_max`. The outermost band's open bound stays flat
  (DEM top / deep base). `body_assembly`'s caps use the band surfaces, so adjacent
  bands share the geological surface exactly (watertight stitch).
- One field is fit **per band**, over that band's matrix bodies.

### D. Lens carving (NEW stage) — matrix-with-void + lens-fills-void
After the matrix field builds the matrix bodies for a band:
- For each lens, build the lens solid (its own small region — from its picks'
  extent, using the same height-field-prism primitive bounded by the host body's
  geometry), and **carve a matching void** in the host matrix body so the lens and
  host tile (no overlap). This reuses the retired loft M3 precedent
  (`detect_enclosed_lenses` + `append_void` = matrix body with an interior void) —
  ported to the height-field-prism builder.
- **Recursion (lens-in-lens):** carve deepest-nested lenses first; a lens enclosed
  in another lens carves a void in *that* lens, not the matrix. The `depth_rank`
  from `classify_lenses` orders the carving.
- Each lens is emitted as its own `LithoBodyMesh` (watertight closed manifold);
  the host carries the void. Both pass the closed-manifold + no-overlap invariants.

### E. Monotone clamp — `body_assembly._sample_height_fields`
After sampling the per-column contact-height stack, apply
`np.minimum.accumulate` over ascending rank (NaN-aware for absent contacts) so the
heights are provably non-increasing with depth. This makes per-body non-overlap a
construction theorem and pinches a field bubble to zero thickness instead of
overshooting (kills the VEEN class). Independent of the lens/geology work; land it
in the same effort.

### F. Wiring (`recompute_litho_solids`)
`RecomputeLithoSolids` keeps its full external contract (endpoint, outcome shape,
upsert/orphan-delete, checksum, `force`). It now: resolves instances → assembles
geology-bounded control + the `LensPartition` → builds per band (matrix field +
lens carve) → upserts matrix bodies AND lens bodies (the synthetic `body_id`
scheme extends to lenses, e.g. `lens:<host>:<k>`). The checksum digest extends to
cover the geological surfaces + the lens partition + grid spacing.

---

## Data flow

```
RecomputeLithoSolids.execute(model_id, force)
  ResolveLithoInstances (body_id stamps)                       [unchanged]
  AssembleStratInputs:
     load picks  →  assign to geological bands (parent geo surfaces)
     classify_lenses(columns)  →  LensPartition (matrix set + lenses + nesting)
     per band: StratControlData over MATRIX bodies + the band Block (surface bounds)
  for each geological band:
     build_stratigraphic_order(matrix columns)   → conformable order (or real cycle = error)
     fit_potential_field(control, [band block])  → F per band
     assemble_bodies(F, order, band block)        → watertight matrix bodies
        + np.minimum.accumulate height clamp      [E]
     carve_lenses(matrix bodies, LensPartition)   → lens solids + host voids (recursive) [D]
  upsert matrix + lens bodies; orphan-delete; checksum
```

---

## Reused / new / changed

- **Reused unchanged:** the implicit field engine (`potential_field`,
  `iso_surface`), the resolver, the persistence/bundle path, the section-column
  diff oracle, `LithoBodyMesh`.
- **New:** `classify_lenses` (shared enclosure helper), the lens-carving stage,
  the geological-band partition in `assemble_strat_inputs`, the `Block`
  surface-bounds extension.
- **Changed:** `stratigraphic_order` (order the matrix; lens partition),
  `body_assembly` (surface caps + monotone clamp + host-void support),
  `strat_builder` / `recompute_litho_solids` (per-band loop + lens carve + checksum).
- **Un-retired:** the geo-bounding / band-surface plumbing parked in Task 8/9 is
  brought back as the block partition.

---

## Testing (real-data-shaped — the load-bearing discipline)

Every validation uses interbedded / enclosed-lens / geology-banded fixtures, never
layer-cake (the lesson that hid the loft + the original cycle):
- `classify_lenses`: an interbedded `KLEI/SILT/KLEI` column → SILT is a lens in
  KLEI; a `KLEI/SILT/ZAND/SILT/KLEI` → ZAND is a lens-in-lens inside the SILT;
  cross-check that lens-out yields a DAG; a true reversal across columns (no
  sandwich) is NOT classified as a lens (it must surface as a real cycle).
- Stage 1: matrix-only order is conformable on the enclosed-lens fixture; a real
  matrix cycle still raises `NonConformableError`.
- Geology blocks: picks partition to the right band; snap-or-divide at a boundary;
  adjacent bands share the geological surface (watertight stitch).
- Lens carving: the host has a void exactly where the lens sits (no overlap, no
  gap — `assert_no_overlap_sampled` + `assert_model_matches_columns` STRICT); the
  lens + lens-in-lens are each closed manifolds; the carved host is still a closed
  manifold.
- Monotone clamp: a deliberately bubbled field column no longer inverts; the
  body stack is provably monotone; a unit/property test pins the VEEN-overshoot fix.
- **Real-data acceptance:** rebuild `test.strix` → it builds (matrix backbone +
  6 lenses, the 2 cycles resolved); the section-column diff overlaps are ~0; the
  owner orbits the model and slices a cross-section to confirm it matches the
  authored litho columns (the lenses sit inside their hosts).

---

## Out of scope (v1)

- **True interfingering that survives lens-out.** If, after carving the enclosed
  minorities, the matrix backbone of a band *still* cycles, that is genuine
  laterally-reversing interfingering (not over-merge). v1 reports it as a
  `NonConformableError` naming the bodies (it cannot occur on `test.strix` — the
  backbone is a DAG — but the design must surface it, not silently force it).
- **Faults / unconformities beyond the per-band blocks** (the geological partition
  here is conformable bands; cross-fault block stitching is the later milestone the
  `blocks` seam already anticipates).
- **2D-render behavioural changes.** The shared classifier aligns the *criterion*;
  it does not change what the 2D sections draw.
- **Authoring lenses by hand in 3D.** Lenses are derived from the existing
  correlation/enclosure data, not drawn in the 3D viewer.

---

## Decisions locked in the brainstorm (2026-06-14)

- Geology-bounding is the frame, **not** the cycle-fix (proven: cycles survive
  within bands). The cycle-fix is **lens-in-lens** (proven: lens-out → DAG).
- Matrix/lens classification is **enclosure**, via **one shared helper** used by
  2D and 3D (better than reusing the 2D code per-section, and than a size
  heuristic that could lens the matrix).
- **v1 is the full fix** — carve the lenses in 3D now (not matrix-backbone-only).
- The **monotone clamp** is folded in (hard watertight theorem + VEEN fix).
