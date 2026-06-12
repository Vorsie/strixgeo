# Litho ↔ Geology Bounding (3D) — Design

- **Date:** 2026-06-12
- **Status:** Approved (brainstormed with the owner, visual companion). Ready for a plan.
- **Branch:** `litho-geo-bounding` (off `develop@66d3c846` — the merged M3 + facies builder).
- **Renders in / owned by:** the **3D litho solid builder** — `domain/services/litho_solid_builder.build_body_solids`, orchestrated by `application/recompute_litho_solids.RecomputeLithoSolids`. **The 2D section is an INPUT, not a render target** — no 2D-section overlay code changes.

---

## 0. In plain words

The 3D litho model today builds per-body watertight solids from correlated litho
contacts, with no awareness of the geological model. This feature makes the
**geological framework the hard outer bound** of the litho model:

- The parent geological model's boundary surfaces partition 3D space into
  **bands**. A litho body may **never cross a geological boundary** — lithology
  interfingers *only within* a geological unit.
- Each litho body fills its band using the **existing** correlation → body
  machinery (lenses, facies competition, single-patch). We **bound** that
  partition; we do not reinvent it, and we never *invent* geometry that the
  correlations don't already imply.
- The model has a synthetic **floor**: a *base-of-tests* surface through each
  test's deepest point, constrained to stay below the geological boundaries.
  Tests too shallow to reach the deepest band are **dropped from the floor and
  marked**.

The whole thing is computed on the existing **Build** (`RecomputeLithoSolids`)
and is **derived / build-only** — it never mutates the geological model the user
authored in the geology stage.

---

## 1. Problem, scope, non-goals

### Problem
`build_body_solids` produces band-blind litho solids: a body spanning a
geological boundary is geologically wrong (e.g. a clay body straddling the
Quaternary/Tertiary contact, which carries different parameters above and
below). There is also no defined bottom to the model — bodies floor at whatever
depth their member picks reach, with no validity check against the geological
framework.

### In scope
1. A **geo-division pre-pass** that confines litho to geological bands by placing
   a litho contact at every geological boundary in every column (snap-or-divide).
2. A **base-of-tests floor** with a validity guard against the geological TINs,
   plus the **marked-test** rules (exclusion + endpoint at lowest correlation).
3. Wiring both into `RecomputeLithoSolids` so the existing `build_body_solids`
   receives band-confined, floored picks and is otherwise **unchanged**.

### Out of scope (non-goals)
- **Inventing geometry.** Bodies/lenses come only from real correlated contacts.
  Geo-bounding *bounds*; it never creates a body the correlations don't.
- **Mutating the geological model.** The adjusted boundary is derived/build-only
  (owner decision A). Geology stage stays the single author of the geological
  model.
- **2D section changes.** None. The 2D partition is an input.
- **New body-detection / lens-authoring UX.** Lens formation is untouched
  existing machinery (`ResolveLithoInstances`, correlation edges, the facies
  partition).
- **Design-ready parameters.** Unchanged Phase-5 boundary.

---

## 2. The locked product model (geology prevails)

Owner directive 2026-06-11, re-confirmed 2026-06-12. Not up for re-litigation:

- Geological boundary surfaces are **hard outer bounds**; interpolated across the
  model they partition it into bands.
- Within each band, the **existing** litho partition fills the space; a litho
  unit **never crosses** a geological boundary.
- The deepest band is floored by the **base-of-tests surface** (the "red line").
- At a near-coincident geo↔litho boundary, **snap or divide** (see §4).

---

## 3. Architecture — the pipeline

All steps run inside `RecomputeLithoSolids.execute(model_id)`, in order, on
pure-domain transforms of the loaded data. The geological context enters where
the litho model's `parent_geological_model_id` is resolved.

```
load litho model  ──▶  resolve parent geological model
                          └─ load parent FormationSurfaceOrm TINs (band dividers)
load litho picks  ──▶  [1] GEO-DIVISION PRE-PASS  (snap-or-divide; derived)
                       [2] BASE-OF-TESTS FLOOR     (build + validity guard + mark)
                       [3] APPLY FLOOR + ENDPOINTS (truncate valid; endpoint marked)
                       [4] RE-DERIVE BODY GROUPING (split bodies at boundaries)
                              │
                              ▼
                       build_body_solids(picks)   ◀── UNCHANGED
                              │
                              ▼
                       upsert litho_body_solid     +  report marked test ids
```

Steps [1]–[4] are new pure domain services. `build_body_solids` and every
routing branch inside it (lens / matrix-void / facies / single-patch / legacy)
are **unchanged** — they simply receive band-confined, floored picks.

---

## 4. Component 1 — Geo-division pre-pass (snap-or-divide)

**Goal:** give every column a litho contact *exactly at* each geological
boundary, so that after body resolution no body can span a boundary.

For each test (column) at its `(x, y)`, sample every geological boundary surface
elevation (interpolate the geological TIN at the test location, reusing
`evaluate_tin_at` / the TIN-slice machinery). For each geological boundary
elevation `g`:

- **SNAP (geology → litho).** If a litho contact on this column is within
  `snap_tolerance_m` of `g`, the boundary is treated as coincident with that
  **observed litho contact**, not the interpolated `g`. The litho contact is the
  measured datum; the geological TIN there is an interpolation. The **derived
  band-divider surface** is fitted to pass through the litho contact at this
  column (the geological surface bends to the observed contact). No sliver is
  created.
  - Tie-break: if two litho contacts are within tolerance, snap to the **nearest**.
- **DIVIDE.** If no litho contact is within tolerance, insert a synthetic litho
  contact at `g` (the geological elevation), splitting the straddling layer into
  **two same-lithology layers** — one per band. These become **two distinct
  bodies** (geology prevails: same lithology, different geological parent, e.g.
  Quaternary clay over Tertiary clay).

**Derived / build-only (owner decision A).** The pulled band-divider lives only
inside the litho build. The geological model authored in the geology stage is
**not** modified. The ≤ tolerance difference between the derived divider and the
raw geological surface is imperceptible in the geology pane.

**Tolerance.** Reuse the existing `view_state.litho_segmenter.litho_snap_tolerance_m`
knob (default **0.20 m**) already used for 2D litho↔geology coupling (#134-A /
#162). One knob governs both 2D coupling and 3D bounding. No new setting.

---

## 5. Component 2 — Base-of-tests floor + validity guard

**Construction.** The floor is a TIN through each test's **deepest point** (full
penetration / deepest litho data), interpolated across the model — one control
point per test.

**Validity guard.** The floor must stay **below the geological boundary TINs**
everywhere. A test whose deepest point sits **above the lowest geological
boundary** would pull the floor up across a geological TIN. Such a test is:

1. **Dropped** from the base-of-tests control set (the floor interpolates from the
   neighbouring tests that *do* reach deep enough), and
2. **Marked** (surfaced to the user — see §8), so the exclusion is visible, not
   silent.

Per-test check: at the test's `(x, y)`, compare its deepest elevation to the
lowest geological surface elevation. If shallower (above), drop + mark.

**Endpoints.**
- **Valid test** → its litho is floored at the base-of-tests surface.
- **Marked test** → its endpoint is its **lowest correlation** (the deepest litho
  contact tied by a correlation edge). Below that it isn't laterally tied, so it
  stops; the litho stub between its lowest correlation and its true bottom is
  dropped.
- **Marked test with no correlations at all** → **excluded entirely** from the
  3D model (still marked). It can neither floor the model nor tie laterally.

**Marking mechanism.** Reuse the existing `excluded_borehole_ids` exclusion
pattern that the geological surfaces already honour (`recompute_formation_surface`).
Here the exclusion set is **derived per Build** (computed by the validity guard),
not user-authored, and is reported on the Build response (§8).

---

## 6. Component 3 — Builder unchanged + the body invariant

After [1]–[3], the pick set is band-confined and floored. Step [4] re-derives the
**body grouping** so that a stored body crossing a geological boundary becomes
multiple band-confined bodies (connected components of correlation edges
*within* each band). `build_body_solids` then runs **unchanged**, and every
routing branch (lens / matrix-void / facies / single-patch / legacy) operates
naturally **within a band**.

**The body invariant (write this into the code + tests):**

> Litho bodies and lenses come **only** from real correlated contacts. The
> geo-bounding feature **bounds** them within geological bands and applies the
> floor; it never **invents** a body the correlations don't already imply.

**Worked consequence (the owner's edge case).** A lens may sit in a geological
band *below* a marked (too-shallow) test's endpoint. This needs **no special
case**: the lens is the volume between two **correlated contact surfaces** carried
by the *adjacent deep tests*; under the marked test it is pure interpolation from
those neighbours. Dropping the marked test below its endpoint removes it as a
*control point* only — the lens never depended on it. Conversely, if the
surrounding tests had **no** interbed contacts, there would be **no lens** there —
geometry only ever comes from real correlations.

---

## 7. Pipeline order (why this order)

1. **Geo-division before floor** — bands must exist before we reason about which
   band a test reaches and where it's floored.
2. **Floor + endpoints before body re-derivation** — truncation changes which
   picks exist per band.
3. **Body re-derivation before the builder** — the builder groups by `body_id`;
   it must see band-split groupings.
4. **Builder last, unchanged** — it consumes the fully prepared pick set.

---

## 8. Interfaces & contracts

- **Geometry: no schema / API / Cesium change.** Clipped, band-confined geometry
  lands in the same `LithoBodyMesh` → `litho_body_solid` (vertices/triangles
  JSONB) → `buildSolidPrimitive` chain. Verified against the code map.
- **Marked tests: one additive field.** The Build response gains an additive,
  optional list of **excluded/marked test ids + reason** (default empty), so the
  UI can mark them. Additive-only, backwards-compat safe.
- **Derived body ids (open implementation question, §11).** Split bodies need
  stable, idempotent identity so re-Builds don't churn the `litho_body_solid`
  rows (UNIQUE(model_id, body_id)). The plan must choose a stable derivation
  (e.g. `(stored_body_id, band_ordinal)` → deterministic uuid) or an equivalent
  discriminator.
- **No geological-model write.** The derived band-divider is build-only; the
  geological model and its `formation_surface` rows are untouched.

---

## 9. Edge cases (all confirmed in brainstorm)

| Case | Handling |
|---|---|
| Litho contact within tolerance of a boundary | SNAP geology→litho (no sliver) |
| Straddling layer, no contact near boundary | DIVIDE → two same-lithology bodies |
| Two litho contacts within tolerance | snap to the **nearest** |
| Test too shallow (above lowest geo boundary) | drop from floor + mark; endpoint = lowest correlation |
| Marked test with no correlations | exclude entirely (still marked) |
| Lens below a marked test's endpoint | no special case — inferred from adjacent deep tests; confined to its band |
| Multiple geological boundaries | a contact is placed at **each**; floor must stay below the **lowest** |
| Top band | bounded above by ground/DEM as today (unchanged) |

---

## 10. Risks & open implementation questions (for the plan)

1. **Correlation-edge re-mapping on DIVIDE.** When a layer is split at a boundary,
   an existing correlation edge on it must attach to the matching band piece
   (upper↔upper, lower↔lower). Both neighbours split at the same boundary, so the
   mapping is well-defined, but the implementation needs care. **First test
   should pin this.**
2. **Stable derived body identity** (see §8) — idempotent re-Build.
3. **Floor interpolation between nodes vs per-test check.** The per-test validity
   check is the practical rule; verify the interpolated floor surface cannot dip
   above a geological TIN *between* compliant nodes (nested-surface assumption).
   If it can, add a node-level clamp.
4. **Performance.** The pre-pass is per-test 1-D work + TIN sampling; expected
   cheap vs the existing Delaunay builder (benchmarks show ~1 s / 200 bodies). Add
   a bench only if profiling shows a hotspot (per project policy).
5. **DEM / top band interaction** — confirm the top band still floors at the DEM
   clip unchanged.

---

## 11. Testing strategy (TDD)

Pure-domain, no DB, in `tests/unit/` first (red → green → refactor):

- **Geo-division:** snap within tolerance pulls the divider to the litho contact;
  outside tolerance divides a straddling layer into two same-lithology layers;
  nearest-contact tie-break; a contact placed at **each** of multiple boundaries.
- **Base-of-tests:** floor through deepest points; a too-shallow test is dropped +
  marked and the floor interpolates from neighbours; valid test floored at the
  surface; marked test endpoint = lowest correlation; no-correlation marked test
  excluded entirely.
- **Body invariant:** a body crossing a boundary becomes two band-confined bodies;
  a lens defined by neighbour contacts survives under a marked test's endpoint; no
  body is invented where no correlation exists.
- **Edge re-mapping:** a correlation edge on a divided layer attaches to the
  correct band piece.

Integration (sibling DB via the wrapper, never the dev DB):

- `RecomputeLithoSolids` end-to-end: parent geological surfaces loaded; solids are
  band-confined; marked-test ids reported; re-Build is idempotent (no row churn).

No schema/API/Cesium change for geometry → no Cesium test needed beyond the
existing `flow_litho_*` e2e staying green; add coverage only for the additive
marked-tests field.

---

## 12. Likely touch points (for the plan, not prescriptive)

- **New pure domain services** (one class/function group per file, near the
  builder): geo-division (snap-or-divide), base-of-tests floor + validity guard,
  floor/endpoint application, band-aware body re-derivation.
- **`application/recompute_litho_solids.py`** — load parent geological surfaces;
  call the new services before `build_body_solids`; thread the snap tolerance from
  `view_state`; report marked test ids.
- **Builder + helpers** (`litho_solid_builder`, `litho_body_assembly`,
  `litho_facies_partition`, `litho_contact_surfaces`) — **unchanged** (verify by
  test).
- **Build response schema** — additive marked-test field.
- **Settings** — none (reuse `litho_snap_tolerance_m`).

---

## 13. Definition of done (per project policy)

- Logging on each new service (entry/exit/phase), GroundModelLogger inheritance.
- numpy docstrings on all public modules/classes/functions.
- Unit tests (happy + structural error + the variant logic) green before commit.
- One file per commit, Conventional Commits.
- Owner **dogfeed on `test.strix`** (Build the 3D solids, confirm bands confine
  litho, floor + marks read right) is the gate before
  `finishing-a-development-branch`.
- **Do not push** the branch.
