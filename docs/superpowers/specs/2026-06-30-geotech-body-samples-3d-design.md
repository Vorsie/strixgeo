# Geotech Packing Body Model — Lithology-Bounded Subdivision, Lab Samples, and Watertight 3D (Design)

**Date:** 2026-06-30
**Status:** design — awaiting owner review
**Owner directive thread:** brainstorm 2026-06-30 (CS1 real-data), on top of the body-centric geotech subdivision shipped 2026-06-24.

---

## 1. Goal / core problem

Make the geotech packing model **trustworthy and useful** for three things at once:

1. **Subdivide → watertight 3D model** — geotech packing bodies stack into a watertight 3-D solid model that honours borehole observations as ground truth.
2. **Assign borehole lab samples to a density layer** — every lab `sample` (attached to a borehole at a depth interval) resolves to the specific geotech body it sits in, so its lab results can be pooled per body.
3. **Keep packing physically meaningful** — NAD packing classes are lithology-specific; the model must never stamp a sand class onto a clay (or vice-versa).

### The problem on real data (CS1)

Rendered from the dev DB (`scripts/throwaway_cs1_brainstorm_render*.py`): CS1 has 32 CPTs, 9 boreholes, 27 lab samples. The current "Divide boreholes" TIN-interpolation produced **34 bands where the imposed NAD class contradicts the lithology** (e.g. borehole `GEO-10/171-B6`: a SILT layer stamped `SAND·MD`, a ZAND layer stamped `CLAY·SF`) plus 11 unclassified bands — **all on the 9 boreholes**. The 32 CPTs are clean. Root cause: the TIN imposes CPT *packing geometry* onto boreholes ignoring *which lithology* it cuts.

A second, independent defect: **lab samples carry no density indicator** of their own. A sample cannot be matched to a packing class from its own measurements — it can only **inherit** the density of the spatial body it sits in. So the spatial model is the only bridge, which makes correctness of the spatial model load-bearing.

---

## 2. The invariant + the correlation guard

**Invariant: packing ⊂ litho body.** A NAD packing class only ever exists as a subdivision *inside one lithostratigraphic body*. Packing never crosses a litho-body boundary. This is how the geotech stage was conceived from the start; the rest of this design enforces it everywhere.

**Guard on "Correlate packing" (new).** A packing correlation between two geotech bands is **hard-blocked** unless both bands belong to the **same litho body** (trace each geotech band → its source litho layer → that litho layer's `body_id`; require equality). "Same lithology" alone is too weak — two *separate* sand bodies must not merge.

- **Hard block, not a warning.** The gesture refuses and explains: *"these bands are in different litho bodies — correlate the lithology first in the litho stage."* A soft warning re-admits exactly the mess being removed.
- **Applies to both** the manual gesture and the auto-correlate pass (auto already sequence-matches within a body; the guard makes that an explicit, enforced precondition).
- **Note:** the guard and the 34 borehole mismatches are *different sources*. The guard stops the *user* creating a cross-litho packing body; §4 stops the *borehole fill* doing it on its own. They are complementary halves of the same invariant.

---

## 3. The geotech body

A **geotech body** is a correlated, **single-NAD-class, single-lithology** region — the analytical unit. Refinements from the CS1 brainstorm:

- **A body need not appear on every column between its ends.** It *skips* a column whose lithology doesn't match and passes under/around it. CS1 example: a deep dense-sand body correlated CPT-L↔CPT-R passes **under** a borehole whose log shows basal clay there — the borehole is a member of the *clay* body at that depth, not the sand body. No sand is forced onto the borehole's clay.
- **Membership = CPT correlations + any borehole whose lithology matches and whose position falls in the body's extent.** A body therefore **pools samples from every borehole that genuinely penetrates it** ("left and right"), across the whole model — not only adjacent columns.
- **Prerequisite (owner already does this):** for a deep sand to be one body under a clay, the **litho framework must carry that sand as one continuous litho body** under the clay. If the litho stage modelled two separate sands, the §2 guard correctly blocks the correlation until the lithology is fixed first.

---

## 4. Borehole packing fill (litho-confined) — the §C mechanism

When "Divide boreholes" runs, for **each litho-body extent on a borehole** (bounded by the borehole's own litho contacts — its clay top, etc.):

1. **Place same-lithology CPT packing surfaces, clipped by depth.** Interpolate the internal packing surfaces of that litho body (from the body's CPTs) to the borehole `(x, y)`; clip each to the borehole's litho-body extent. **Clip, never proportional-rescale** — rescale invents classes the depth evidence doesn't support (e.g. flips a 4 m sample from MEDIUM to DENSE; see `crosscut.html`).
2. **Cover any uncovered remainder by the conservative cascade:**
   - **(a) CPT-interpolated** within the body — `confidence = high`.
   - **(b) Body minimum density** — the loosest class the body's CPTs actually produced — when no interpolated surface reaches that stretch. `confidence = low`. Conservative: NAD numbering runs weak→strong within a lithology (sand 5→8, clay 21→24), so "body min" = weakest evidenced.
   - **(c) Absolute lithology minimum** (sand 5 · silt 13 · clay 21 · peat 29 · gravel 1) — only when the litho body has **no CPT classification at all** (a borehole-only body). `confidence = lowest`.
3. **Tag provenance.** Each borehole band records its cascade tier on the existing `litho_layer.source` + `litho_layer.confidence` columns, so a defaulted value never masquerades as CPT evidence.

This produces **zero litho≠class bands** by construction (packing can only be of the borehole's own lithology) and **zero null bands** (the cascade always assigns *something*, tagged).

---

## 5. Sample → band → body (stored)

- Computed during **"Divide boreholes"** (the litho-confined pass above). Each `sample` resolves to the borehole band its `[depth_top_m, depth_base_m]` midpoint falls in → that band's geotech body + NAD class.
- **Stored** on the sample: `geotech_body_id` (the resolver's `body_id` value — same identifier space as `litho_layer.body_id`; a plain indexed nullable UUID, **not** a hard table FK, since bodies are resolver-derived connected components, not a table), `geotech_nad_class` (int, nullable), `geotech_assignment_source` (enum: `cpt_interpolated` | `body_min` | `absolute_min` | `unresolved`). Additive, nullable — rides in the `.strix` bundle, stable for export/reports.
- **Recomputed on re-run.** The "Divide boreholes" button already goes amber (`boreholesStaleStore`) when correlations/bodies change; re-running refreshes the assignments. No separate step.
- **Spanning samples** (a sample interval crossing a band boundary): assign by the interval **midpoint**; record the crossing in `notes` for the validation view (§6b).

---

## 6. The four uses

- **(a) Aggregation.** Per geotech body, pool member samples' lab results → characteristic descriptive statistics (mean / range / outliers). This is the data foundation the future **Parameters stage "per-body" tab** stands on (see `memory/project_parameters_stage_architecture.md`); this design ships only the *containment*, not the parameter derivation (Phase 5).
- **(b) Validation.** Surface (i) every `body_min` / `absolute_min` / `unresolved` assignment, and (ii) any sample whose own `composition`/`sample_type` contradicts its assigned body's lithology — the sample is independent ground truth the CPT interpolation isn't.
- **(c) 3D + query.** §7. Samples render as clickable points → their body; click a body → its pooled samples.
- **(d) Export.** Bodies + pooled samples + provenance tags flow into the Phase-4 export step.

---

## 7. Watertight 3D model

**Reuse the existing voxel builder** (`build_voxel_litho_model` → `label_voxels` → `extract_body_solids` → greedy mesh). It already labels 3-D space from the validated 2-D section partition and is **watertight by construction** (a labelling of space is a partition: every voxel belongs to exactly one body). Two properties make it correct here without new geometry code:

1. **Honor-borehole = clay as ground truth.** The builder already honours a borehole's *own observed log* at its column (`build_voxel_litho_model` docstring "Honor-borehole"; `InvestigationColumn`). So at a borehole the voxels take the **borehole's true lithology** (the clay), never the interpolated neighbour. The aggregated dense-sand body fills *under/around* the honoured clay, never through it. This is precisely the owner requirement: *"the dense sands connected/aggregated, but the 3D still needs the clay as ground truth."*
2. **Aggregated bodies stay aggregated in 3D.** The picks' `body_id` is the resolved connected-component value, so all voxels of the dense-sand body group into one solid across the section — the "connected dense sands" become one watertight body, with the borehole clay punched through it as its own body.

**The only change required for 3D** is upstream, not in the builder: feed it the **§4 litho-confined geotech partition** and the **borehole's true litho** (not the retired imposed-NAD). Once §2–§4 land, the geotech 3D inherits watertightness + clay-ground-truth for free. The geotech "Build model" button already POSTs the voxel path.

**Watertight acceptance:** reuse the litho voxel build's invariants — `flagged == 0`, `inter-body overlap == 0`, plus a new check that **no voxel labelled packing-class-of-lithology-X sits inside an observed-lithology-Y borehole column** (the 3-D analogue of "zero litho≠class").

---

## 8. Precondition fix: the CPT-null classification bug

Independent of all the above, **7 CPT bands (1.3%) classified to `nad_class = NULL`** despite full, healthy qc (e.g. `GEO-10/170-S10` sand 8.83–13.18 m, qc avg 8.73 MPa, while the same body classified NAD 5/6/7 on ~20 other tests). The `None` comes from `SubdivideAllBodies` → `_build_column_plans` producing empty `profile.splits` for a CPT segment that should classify (`suggest_geotech_subdivision` is documented "never empty", so the drop is upstream — a per-segment grouping/series gap). **This must be fixed first** — a CPT band with usable qc must never become a skeleton; otherwise it pollutes both the 2-D partition and the 3-D labels. Diagnosis + fix is the first task of the plan.

---

## 9. Data-model changes

- **`sample`** — add nullable: `geotech_body_id UUID NULL` (the resolved `body_id` value, indexed; not a hard FK), `geotech_nad_class INT NULL`, `geotech_assignment_source VARCHAR NULL`. Additive; backwards-compat is suspended pre-ship.
- **`litho_layer`** — reuse existing `source` + `confidence` for borehole-band provenance (no new column).
- **No new tables.** Geotech bodies, layers, edges, and the resolver are the existing machinery.

---

## 10. Non-goals (explicit)

- **No design-ready parameters** (φ′/c′/cu/E50/…): Phase 5. This ships *containment + descriptive aggregation hooks* only.
- **No Parameters-stage UI** (per-test/per-body/per-parameter/synthesis tabs; EarthWalker local/global regression + feature-gen): Phase 5, separate spec.
- **No proportional-rescale** borehole fill: rejected in §4.
- **No interfingering / facies geometry** beyond the body-skips-column rule: Phase 5.

---

## 11. Testing strategy

- **Unit (domain):** the §2 guard (same/different litho body); the §4 cascade (interp → body_min → absolute_min) incl. the clip-not-rescale crosscut; the §5 midpoint sample→band assignment incl. spanning intervals.
- **Integration (DB):** "Divide boreholes" produces **0 litho≠class bands** and **0 null bands** on a fixture mirroring the CS1 crosscut; sample rows get correct `geotech_body_id` + source; the §8 CPT-null fix verified on a good-qc fixture.
- **Real-data gate (the arbiter, mirrors the CS1 deep-substrate gate):** regenerate the CS1 inputs from the dev DB; assert `litho≠class == 0`, `null bands == 0` on CPTs, each sample assigned with a provenance tag, and the voxel build `flagged == 0 / overlap == 0` with no packing voxel inside a contradicting borehole column. Synthetic fixtures are necessary-not-sufficient.
- **Frontend (vitest):** guard blocks the cross-litho correlate gesture with the explanatory message; sample points render + click-through to body; provenance/confidence surfaced in the geotech inspector + validation view.

---

## Appendix — CS1 reference artifacts (throwaway)

- `scripts/throwaway_cs1_brainstorm_render.py` — full CS1 with mismatch/null flags.
- `scripts/throwaway_cs1_brainstorm_render2.py` — packing-body ribbons + litho boreholes + samples.
- Companion screens: `intro.html`, `cs1-full.html`, `cs1-bodies.html`, `crosscut.html`, `deepbody.html` under `.superpowers/brainstorm/`.
