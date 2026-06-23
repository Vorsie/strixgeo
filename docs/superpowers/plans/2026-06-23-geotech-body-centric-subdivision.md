# Geotechnical Stage — Body-Centric Subdivision Implementation Plan (Option A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the body-centric `SubdivideAllBodies` use case (spec §0.1) that subdivides whole lithostratigraphic bodies into **connected geotech spatial sub-bodies** carrying Belgian NAD packing classes, persists each as a real geotech `body_id` (so it is the stable anchor a later Parameters-stage `parameter_group` references), and renders them as connected body-bands via the existing litho partition-fill engine — plus the "Subdivide all bodies" toolbar verb.

**Architecture (Option A — locked 2026-06-23, owner + two system-architect consults):** `SubdivideAllBodies` groups the C1 geo-bounded segments by `(litho body_id, geo_formation_id)`, runs the A3 qc segmenter per CPT member, applies **policy B** (consistent vertical packing transition across the group's tests → split into connected sub-bodies at a TIN-interpolated surface; lateral-only variation → one representative NAD class), then **materialises the geotech spatial bodies the same way the litho stage does**: it INSERTs geotech `litho_layer` rows (one per sub-body per test, `status='accepted'`, under the `kind='geotechnical'` model), derives `litho_contact_correlation_edge` rows **only between matching band-position sub-bodies** of litho-correlated test pairs, and runs `ResolveLithoInstances` on the geotech model to stamp `body_id` + create `BodyOrm` rows. The frontend reuses `computeSectionFill` / `PartitionFillOverlay` **verbatim** on the geotech axis (the engine is model-kind-agnostic), recoloured by NAD class.

**Why Option A, not clip-at-render:** the owner's end-state is a first-class analytical **geotech body** — per-spatial-lens parameters, p-q regressions on triaxial grouped per body, grain-size comparison within/between bodies, and merging non-contiguous lenses whose params match. That needs a persistent, independent geotech `body_id` (which a render-time clip cannot provide and a litho-inherited render cannot diverge from). The `parameter_group` entity that does the merging/regressions sits **above** these bodies and is **deferred to Slice 3** (triaxial isn't imported yet); it will reference the `body_id` this slice persists — no rewrite between slices.

**Tech Stack:** Python 3.11 + Polars (domain), SQLAlchemy + Alembic (persistence), FastAPI (API), React + Electron + Vitest (frontend), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-06-23-geotech-stage-slice-1-design.md` — read §0 + §0.1 FIRST. **This plan corrects spec §0.1 step 5** (see "Locked decisions" below).

---

## Locked decisions (read before any task)

1. **Geotech bodies are real + persisted** via the litho machinery applied to the geotech model: geotech `litho_layer` rows + `litho_contact_correlation_edge` rows + `ResolveLithoInstances` → `body_id` + `BodyOrm`. Spec §0.1 step 5 ("run the resolver on the geotech model") is **kept and made real** — the prior plan draft's "no resolver / clip-at-render" is discarded.
2. **Edges are same-band-position only.** The litho resolver's one-lithology invariant groups connected components by `litho_main_soil_code`, which is **identical** for loose vs dense sand. To avoid over-merging packing classes into one body, `SubdivideAllBodies` derives a geotech edge **only** between sub-bodies at the *same* band position k (e.g. loose↔loose, dense↔dense) of a litho-correlated test pair — **never** cross-position. Then each connected component = exactly one geotech body of one NAD class. **This is the single most important correctness constraint; SAB-7 pins it.**
3. **The LL→FC mirror trigger is NOT kind-gated** (`mirror_litho_layer_to_contact`). Inserting an `accepted` geotech `litho_layer` row **auto-derives** its `formation_contact`. So `SubdivideAllBodies` writes **layers as the source of truth** and lets contacts derive — it must NOT also write the same contacts directly (double-write). The FC→LL trigger IS kind-gated to litho, so geotech contacts never derive layers — confirming layers must be written explicitly. **SAB-8 pins the derived-contact behaviour.**
4. **Geotech layers must satisfy the per-`(model, anchor)` no-overlap + contiguity constraints** (migrations `f7a8b9c0d1e2`, `e1c2d3a4b5f6`). The sub-bodies on each investigation must tile its geo-bounded litho extent with no gaps/overlaps. **SAB-9 pins it.**
5. **§0.1 knobs use the spec's v1 defaults** (E5 real-data eval is the arbiter): consensus = **exact band-class sequence** after A3 merge (shorter sequence may prefix-match a longer one — too-shallow case); representative class = **thickness-weighted dominant**, tie → **denser** (higher NAD number); single-CPT group → its own profile is the split; zero-CPT group → one carry-through layer, `nad_class=None`.
6. **Scope:** NAD soil type comes from litho (never auto-derived); raw qc (Qtn toggle deferred); design params (φ′/c′/cu) are Phase 5, never here. The `parameter_group` / merge-split / regression / lab-test-association surface is **Slice 3** — not in this plan. Manual depth adjustment of the result is deferred (owner).

---

## File Structure

**New (backend):**
- `src/groundmodel/domain/services/geotech_body_aggregation.py` — pure policy-B: per-CPT band-profile comparison (consensus) + representative-class aggregation. **The key new algorithm.**
- `src/groundmodel/domain/services/geotech_split_surface.py` — pure split-surface interpolation: given per-CPT transition points + all group columns, return each column's transition depth (TIN with <3-point flat fallback).
- `src/groundmodel/application/subdivide_all_bodies.py` — the `SubdivideAllBodies` use case (orchestration + geotech body materialisation).
- `scripts/eval_geotech_subdivision.py` — real-data eval vs `test.strix`.

**Modified (backend):**
- `src/groundmodel/api/routers/geology/geotech.py` — add `POST .../models/{mid}/geotech/subdivide-all-bodies`.
- `src/groundmodel/api/schemas/project/geotech_suggestion/` — request/response schemas (one class per file).

**New (frontend):**
- `desktop/src/renderer/src/utils/nadClasses.ts` — NAD class-name lookup (ported from backend `NAD_CLASSES`) + a per-class colour map.

**Modified (frontend):**
- `desktop/src/renderer/src/api/clients/geology.ts` — `subdivideAllBodies` call + types.
- `desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx` — replace placeholder; mount the section view at `axisMode='geotechnical'`, fetch geotech layers + edges (existing endpoints) + formations, NAD recolour, build-then-subdivide gate, no-qc band state.
- `desktop/src/renderer/src/components/SectionPanel.tsx` — relax the `PartitionFillOverlay` + `CorrelationEdgesOverlay` gates (~3030, ~3062) to admit `'geotechnical'`; feed the NAD colour/label maps.
- `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` (or `GeotechnicalCanvas`) — extend the `isLitho`-style gating so geotech fetches `lithoLayers`/`contactEdges` from the **geotech** model and passes `axisMode='geotechnical'`.
- the section toolbar — the "Subdivide all bodies" headline verb.
- a geotech inspector roster (mirror `LithologyInspector`).

**Tests:** `tests/unit/domain/test_geotech_body_aggregation.py`, `tests/unit/domain/test_geotech_split_surface.py`, `tests/integration/api/test_subdivide_all_bodies.py`, frontend `nadClasses.test.ts` + an overlay/canvas test, e2e `flow_geotech_subdivide_all_bodies.spec.ts`.

---

## Reuse reference (verified by reading the code — exact shapes)

- **A3 segmenter** — `domain/services/geotech_subdivision.py`: `suggest_geotech_subdivision(soil, admixtures, depth_m, qc_mpa, segment_top_m, segment_base_m, min_thickness_m) -> list[GeotechSplit]`; `GeotechSplit(depth_top_m, depth_base_m, nad_class)` (frozen). Never empty.
- **Classifier** — `nad_classifier.py`: `classify_nad(soil, admixtures, qc_mpa) -> int`.
- **Body picks** — `litho_body_pick.py`: `BodyLayerPick(investigation_id: str, x_m, y_m, surface_elev_m, body_id: str, formation_id: str, top_depth_m, base_depth_m)` (ids are strings; depths below surface).
- **Loader** — `LithoLayerRepository.load_body_picks(model_id, *, restrict_to_investigation_ids=None) -> list[BodyLayerPick]`.
- **C1 build** — `build_geotech_model_from_litho.py`: `BuildGeotechModelFromLitho(session).execute(*, project_id, litho_model_id, section_id) -> BuildGeotechResult`. Read in full: reuse `_ensure_geotech_model`, the section-scope (`project_investigations_onto_section`), the geo-bounding (`mark_and_truncate_shallow_tests` + `divide_picks_by_geology` from `domain/services/litho_geo_bounding.py`), `_read_litho_snap_tolerance_m`, `_load_geo_surfaces_with_formation`, and the skeleton find-or-create `(source_litho_formation_id, source_geo_formation_id)`.
- **C2b classified find-or-create** — `accept_geotech_suggestions.py`: `_find_or_create_classified(...)` keyed on the triple `(nad_class, source_litho_formation_id, source_geo_formation_id)`, inheriting soil/admixtures/color/display_order, name `f"{base} (NAD {nad_class})"`. Reuse for E3's classified-formation writes.
- **`litho_layer` INSERT** — table `litho_layer`. Minimum fields: `id=uuid7()`, `model_id` (geotech model), `formation_id` (geotech classified/skeleton formation), exactly one of `borehole_id`/`cpt_id`, `depth_top_m`, `depth_base_m` (`> top`), `source` ∈ {`segmenter`,`manual`,`observation_layer`,`observation_interpretation`} (use `'segmenter'`), **`status='accepted'`** (the resolver only reads accepted rows). `confidence` defaults `'medium'`. Honor `litho_layer_anchor_xor`, `litho_layer_depth_ordered`, the no-overlap + contiguity constraints per `(model, anchor)`.
- **`litho_contact_correlation_edge` INSERT** — table `litho_contact_correlation_edge`. `contact_a_id`/`contact_b_id` FK **`litho_layer.id`** (canonical `a < b`), `model_id` (geotech model, FK `geological_model`), `section_id` **NOT NULL**, `contact_a_side`/`contact_b_side` default `'top'`, `source` default `'manual'`, `user_approved=True`. Unique `(model_id, section_id, a, b, a_side, b_side)`.
- **Resolver** — `ResolveLithoInstances(session).execute(*, model_id, commit=True) -> ResolveResult`. **No `model.kind` check** — runs on geotech. Reads `litho_layer WHERE model_id==X AND status=='accepted'` + `edge WHERE model_id==X AND user_approved`, creates `BodyOrm` per connected component, stamps `litho_layer.body_id`. One-lithology invariant drops any edge whose two layers differ in `litho_main_soil_code` (decision 2 keeps edges same-position so this never over/under-merges).
- **TIN** — `domain/services/tin_surface.py`: `compute_tin(contacts, ...) -> TinSurface`; `evaluate_tin_at(surface, x, y) -> float | None` (None off-footprint; <3 points → vertices-only, returns None).
- **CPT series** — bulk `select(CptSeriesOrm).where(CptSeriesOrm.cpt_id.in_(ids))`; `series.depths_m`, `series.qc_mpa`.
- **Read endpoints (no backend kind gate — serve geotech ids as-is):** `GET /models/{mid}/layers` (`litho_layers.py`), `GET /models/{mid}/contact-correlations` (`contact_correlations.py`). Frontend gating is convention-only (the `isLitho` checks in `SectionsCanvas`).
- **Frontend band engine** — `utils/partitionFill.ts`: `computeSectionFill(columns, edges, lensApexOverrides?, alongM?) -> SectionRegion[]`. `PartitionFillOverlay` gated `axisMode==='lithostratigraphic'` at SectionPanel ~3062. `LithologyInspector` is the roster mirror. No NAD names/colours exist frontend-side (build `nadClasses.ts`).

---

## Phase E — Backend: `SubdivideAllBodies` + geotech body materialisation

### Task E1: Pure policy-B aggregator (the key algorithm)

Given each CPT member's A3 band profile for one body group, decide consistent-split vs one-class + the representative NAD class per position. No I/O.

**Files:** Create `src/groundmodel/domain/services/geotech_body_aggregation.py`; Test `tests/unit/domain/test_geotech_body_aggregation.py`.

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for the pure policy-B body-subdivision aggregator (spec §0.1)."""

from groundmodel.domain.services.geotech_body_aggregation import (
    BandProfile,
    plan_body_subdivision,
)
from groundmodel.domain.services.geotech_subdivision import GeotechSplit


def _profile(inv: str, *bands: tuple[float, float, int]) -> BandProfile:
    return BandProfile(
        investigation_id=inv,
        splits=[GeotechSplit(top, base, cls) for top, base, cls in bands],
    )


def test_single_cpt_profile_is_the_split():
    prof = _profile("c1", (0.0, 5.0, 6), (5.0, 10.0, 8))
    plan = plan_body_subdivision([prof])
    assert plan.consistent is True
    assert plan.band_classes == [6, 8]


def test_zero_cpt_group_is_carry_through_unclassified():
    plan = plan_body_subdivision([])
    assert plan.consistent is True
    assert plan.band_classes == [None]  # one carry-through unit, class unset


def test_two_cpts_same_sequence_split_with_dominant_class():
    a = _profile("a", (0.0, 4.0, 6), (4.0, 10.0, 8))
    b = _profile("b", (0.0, 6.0, 6), (6.0, 10.0, 8))
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is True
    assert plan.band_classes == [6, 8]


def test_too_shallow_cpt_prefix_matches_longer_sequence():
    # CPT b bottoms out after one band (6) → prefix of a's [6, 8]: still consistent.
    a = _profile("a", (0.0, 4.0, 6), (4.0, 10.0, 8))
    b = _profile("b", (0.0, 3.0, 6))
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is True
    assert plan.band_classes == [6, 8]


def test_lateral_only_variation_falls_to_one_representative_class():
    # a reads 6/8, b reads 8/6 (reversed) → no shared sequence → one class.
    a = _profile("a", (0.0, 5.0, 6), (5.0, 10.0, 8))
    b = _profile("b", (0.0, 5.0, 8), (5.0, 10.0, 6))
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is False
    assert len(plan.band_classes) == 1
    assert plan.band_classes[0] in (6, 8)


def test_representative_class_tie_breaks_to_denser():
    a = _profile("a", (0.0, 5.0, 6))
    b = _profile("b", (0.0, 5.0, 8))
    # two single-band CPTs disagree on class → not consistent → one class;
    # equal 5 m thickness of class 6 and 8 → tie → the denser class (8) wins.
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is False
    assert plan.band_classes == [8]


def test_band_appears_midsequence_is_not_consistent():
    # a = [6, 8], b = [6, 7, 8]: neither is a prefix of the other → not consistent.
    a = _profile("a", (0.0, 5.0, 6), (5.0, 10.0, 8))
    b = _profile("b", (0.0, 3.0, 6), (3.0, 6.0, 7), (6.0, 10.0, 8))
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is False
    assert len(plan.band_classes) == 1
```

- [ ] **Step 2: Run — expect FAIL** (`uv run pytest tests/unit/domain/test_geotech_body_aggregation.py -v`).

- [ ] **Step 3: Write the implementation**

```python
"""Pure policy-B body-subdivision aggregator (spec §0.1).

Given each CPT member's A3 packing-band profile for one
``(litho body_id, geo_formation_id)`` group, decide whether the body splits into
connected vertical sub-bodies (consensus on the ordered band-class sequence) or
carries one representative NAD class (lateral-only variation). Pure: no I/O.
Consensus is the exact band-class sequence after A3's min-thickness merge, with a
shorter sequence allowed to prefix-match a longer one (the too-shallow case;
spec §0.1 step 2, v1 default — the E5 eval is the arbiter on tightening this).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from groundmodel.domain.services.geotech_subdivision import GeotechSplit


@dataclass(frozen=True)
class BandProfile:
    """One CPT member's ordered packing bands within a body group.

    Parameters
    ----------
    investigation_id : str
        CPT id (string, matching ``BodyLayerPick.investigation_id``).
    splits : list[GeotechSplit]
        Ordered top→base packing bands from :func:`suggest_geotech_subdivision`.
    """

    investigation_id: str
    splits: list[GeotechSplit]


@dataclass(frozen=True)
class BodySubdivisionPlan:
    """The decided subdivision for one body group.

    Parameters
    ----------
    consistent : bool
        True → split into ``len(band_classes)`` connected sub-bodies (one per
        band position). False → one representative class for the whole body.
    band_classes : list[int | None]
        NAD class per band position (length 1 when not consistent or
        borehole-only; the single entry is ``None`` for a borehole-only group).
    """

    consistent: bool
    band_classes: list[int | None]


def _sequences_consistent(sequences: list[list[int]]) -> bool:
    """True iff every sequence is a prefix of the longest (shared ordering)."""
    if not sequences:
        return True
    longest = max(sequences, key=len)
    return all(longest[: len(seq)] == seq for seq in sequences)


def _thickness_weighted_dominant(splits: list[GeotechSplit]) -> int:
    """Mode NAD class by summed thickness; tie → the denser (higher) class."""
    by_class: dict[int, float] = defaultdict(float)
    for s in splits:
        by_class[s.nad_class] += max(s.depth_base_m - s.depth_top_m, 0.0)
    return sorted(by_class.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)[0][0]


def plan_body_subdivision(profiles: list[BandProfile]) -> BodySubdivisionPlan:
    """Decide the subdivision for one body group (spec §0.1 steps 2 + 4)."""
    cpt_profiles = [p for p in profiles if p.splits]
    if not cpt_profiles:
        return BodySubdivisionPlan(consistent=True, band_classes=[None])

    sequences = [[s.nad_class for s in p.splits] for p in cpt_profiles]
    if _sequences_consistent(sequences):
        longest_len = max(len(seq) for seq in sequences)
        band_classes: list[int | None] = []
        for k in range(longest_len):
            pool = [p.splits[k] for p in cpt_profiles if k < len(p.splits)]
            band_classes.append(_thickness_weighted_dominant(pool))
        return BodySubdivisionPlan(consistent=True, band_classes=band_classes)

    all_splits = [s for p in cpt_profiles for s in p.splits]
    return BodySubdivisionPlan(
        consistent=False, band_classes=[_thickness_weighted_dominant(all_splits)]
    )
```

- [ ] **Step 4: Run — expect PASS** (8 tests). Then `uv run ruff format` + `uv run ruff check --fix` on both files.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/geotech_body_aggregation.py tests/unit/domain/test_geotech_body_aggregation.py
git commit -m "feat(geotech): pure policy-B body-subdivision aggregator (#geotech-s1)"
```

### Task E2: Pure split-surface interpolation

For one consistent split position, given the CPTs' `(x, y, transition_elevation)` points, return each group column's transition elevation: TIN interpolation when ≥3 CPT points, else a flat mean-elevation surface (so single/double-CPT groups and boreholes still get a connected split).

**Files:** Create `src/groundmodel/domain/services/geotech_split_surface.py`; Test `tests/unit/domain/test_geotech_split_surface.py`.

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for the pure geotech split-surface interpolator (spec §0.1 step 3)."""

from groundmodel.domain.services.geotech_split_surface import (
    ColumnXY,
    interpolate_split_elevations,
)


def test_flat_fallback_with_one_cpt_point():
    # One CPT transition at elev 6 → every column gets 6 (flat surface).
    cpts = [ColumnXY("c1", 0.0, 0.0)]
    cols = [ColumnXY("c1", 0.0, 0.0), ColumnXY("b1", 50.0, 0.0)]
    out = interpolate_split_elevations(cpts, [6.0], cols)
    assert out["c1"] == 6.0
    assert out["b1"] == 6.0


def test_two_cpts_flat_mean_fallback():
    cpts = [ColumnXY("c1", 0.0, 0.0), ColumnXY("c2", 100.0, 0.0)]
    cols = cpts + [ColumnXY("b1", 50.0, 0.0)]
    out = interpolate_split_elevations(cpts, [6.0, 4.0], cols)
    assert out["b1"] == 5.0  # mean of 6 and 4 (TIN needs >=3 points)


def test_three_cpts_tin_interpolates_borehole_between():
    # Three CPTs at a plane elev = 10 - x*0.1; borehole at x=50 → ~5.
    cpts = [ColumnXY("c1", 0.0, 0.0), ColumnXY("c2", 100.0, 0.0),
            ColumnXY("c3", 50.0, 100.0)]
    elevs = [10.0, 0.0, 5.0]
    cols = cpts + [ColumnXY("b1", 50.0, 0.0)]
    out = interpolate_split_elevations(cpts, elevs, cols)
    assert abs(out["b1"] - 5.0) < 0.5
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `ColumnXY(investigation_id: str, x_m: float, y_m: float)` (frozen). `interpolate_split_elevations(cpt_points: list[ColumnXY], cpt_elevations: list[float], all_columns: list[ColumnXY]) -> dict[str, float]`: if `len(cpt_points) >= 3`, `compute_tin([(p.x_m, p.y_m, e) for p, e in zip(...)])` then `evaluate_tin_at(surface, c.x_m, c.y_m)` per column, falling back to the mean elevation where `evaluate_tin_at` returns `None` (off-footprint); else assign the mean elevation to every column. Return `{investigation_id: elevation}`. numpy-style docstrings.

- [ ] **Step 4: Run — expect PASS.** ruff format + check. **Commit.**

```bash
git add src/groundmodel/domain/services/geotech_split_surface.py tests/unit/domain/test_geotech_split_surface.py
git commit -m "feat(geotech): pure split-surface interpolator with flat fallback (#geotech-s1)"
```

### Task E3: `SubdivideAllBodies` use case (orchestration + body materialisation)

**Read `build_geotech_model_from_litho.py`, `accept_geotech_suggestions.py`, `resolve_litho_instances_use_case.py`, and the `litho_layer`/`litho_contact_correlation_edge` ORM models in full first.** This use case reuses C1's model-ensure/geo-bound/pick-load, C2b's classified find-or-create, E1, E2, the litho_layer/edge insert shapes, and the resolver.

**Files:** Create `src/groundmodel/application/subdivide_all_bodies.py`; Test `tests/integration/api/test_subdivide_all_bodies.py`.

- [ ] **Step 1: Write the failing integration test.** Mirror `test_build_geotech_model.py` setup. Seed a litho model with: (i) two CPTs in one corridor sharing a litho body, qc reading a consistent loose-shallow→dense-deep profile; (ii) a borehole (no qc) in that same body; (iii) a second body where the two CPTs disagree laterally; (iv) a borehole-only third body. Build the geotech model (C1) then run `SubdivideAllBodies`. Assert:
  - **SAB-1 (consistent split):** the consistent body yields **2** geotech `litho_layer` rows per CPT *and per borehole* (the borehole gets the interpolated split), each tagged a classified geotech formation; and the borehole's split depth is interpolated from the CPTs.
  - **SAB-2 (representative class):** the lateral-disagreement body yields **1** geotech layer per column (no internal split), class = thickness-dominant.
  - **SAB-3 (find-or-create by triple):** two sub-bodies of the same `(nad_class, source_litho_formation_id, source_geo_formation_id)` share one `geological_formation` row.
  - **SAB-4 (idempotent):** running twice gives the same layer/edge/body/contact counts (delete+rewrite, no duplicates).
  - **SAB-5 (borehole-only carry-through):** the borehole-only body yields one geotech layer, `nad_class=None` (skeleton formation).
  - **SAB-6 (body_id stamped):** every geotech `litho_layer` row has a non-null `body_id`; `BodyOrm` rows exist for the geotech model.
  - **SAB-7 (no over-merge across packing classes — the load-bearing one):** in the consistent-split body, the loose sub-body and the dense sub-body have **different** `body_id`s (the same-position-only edge rule kept them apart despite identical `litho_main_soil_code`).
  - **SAB-8 (contacts derive from layers):** `formation_contact` rows exist under the geotech model at the split depths (auto-derived by the LL→FC trigger from the accepted layers), with no duplicate contacts.
  - **SAB-9 (contiguity):** the geotech layers on each investigation tile its geo-bounded litho extent with no gaps/overlaps (no constraint violation; the build commits).

  Run via `.\scripts\run-integration-tests.ps1 tests/integration/api/test_subdivide_all_bodies.py`. **Grep the output for "passed/failed/error" — the wrapper returns exit 0 even on errors** (CLAUDE.local.md + memory).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `SubdivideAllBodies(session).execute(*, project_id, litho_model_id, section_id) -> SubdivideAllBodiesResult`:

  1. **Ensure geotech model** (reuse C1 `_ensure_geotech_model`). Resolve litho `body_id`: `await ResolveLithoInstances(session).execute(model_id=litho_model_id, commit=False)`.
  2. **Load section-scoped picks** with `body_id`: `corridor = project_investigations_onto_section(...)`; `picks = await litho_repo.load_body_picks(litho_model_id, restrict_to_investigation_ids=set(corridor))`.
  3. **Geo-bound** the picks exactly as C1 (`mark_and_truncate_shallow_tests` then `divide_picks_by_geology`) → segments each carrying `(source_litho_formation_id, source_geo_formation_id)`, `body_id`, soil/admixtures, the anchor + its `(x, y, surface_elev)`, and `[top_depth, base_depth]`.
  4. **Idempotent reset** (decision-1/3-aware): delete, for the corridor's investigations under the geotech model, the existing geotech `litho_contact_correlation_edge` rows, then `litho_layer` rows (the LL→FC trigger removes their derived contacts), then `BodyOrm` rows. (Order: edges → layers → bodies; delete edges first to avoid FK issues.) Re-run a `ResolveLithoInstances` at the end (step 9) rebuilds bodies cleanly.
  5. **Group** segments by `(body_id, source_geo_formation_id)`.
  6. **Per group:** load each CPT member's qc series; per CPT run `suggest_geotech_subdivision(...)` over the group's depth range (read `min_thickness` from view-state, reuse the suggester's reader) → a `BandProfile`; `plan = plan_body_subdivision(profiles)` (E1).
  7. **Per group, materialise layers:**
     - **band position count** `n = len(plan.band_classes)`.
     - For each interior boundary `k` in `1..n-1` (consistent case only), build the per-CPT transition points (each CPT's `splits[k].depth_top_m` → elevation `surface_elev - depth`) and call `interpolate_split_elevations(...)` (E2) → a transition elevation per group column. This yields, per column, the ordered split depths that cut its `[top, base]` into `n` sub-intervals.
     - For each column × band position `k`: find-or-create the classified geotech formation for `band_classes[k]` via C2b `_find_or_create_classified` (triple key) — or the skeleton formation when `band_classes[k] is None`. INSERT a geotech `litho_layer` row: `id=uuid7()`, `model_id=geotech_model_id`, `formation_id=<that formation>`, the column's anchor, `depth_top_m`/`depth_base_m` = the k-th sub-interval (clamped to the column's geo-bounded extent so contiguity holds), `status='accepted'`, `source='segmenter'`. Record `layer_id` keyed by `(investigation_id, k)`.
  8. **Derive edges (same-position only — decision 2).** For each litho correlation edge within the group (read the litho model's approved edges restricted to the group's investigations + body) connecting test A's litho layer ↔ test B's litho layer, and for each band position `k` present on **both** A and B, INSERT a geotech `litho_contact_correlation_edge`: `contact_a_id`/`contact_b_id` = the geotech `layer_id`s at `(A,k)` and `(B,k)` (canonical `a<b`), `model_id=geotech_model_id`, `section_id=section_id`, `user_approved=True`. **Never** connect position `k` of A to position `j≠k` of B.
     - *If the group has no litho edges (e.g. a single-test body), no geotech edges — each test's sub-bodies resolve to their own bodies, which is correct.*
  9. **Resolve** the geotech model: `await ResolveLithoInstances(session).execute(model_id=geotech_model_id, commit=False)` → stamps `body_id` + creates `BodyOrm`. (No kind guard — it runs on geotech.)
  10. **Single commit.** Return counts (created formation ids, layer count, body count, split-body count, one-class-body count, borehole-only count).

  > **Helper caveat:** read the verified private-helper signatures from the live C1/C2b files; call them as-is. Where a private helper isn't importable, lift the minimal shared logic into a module-level function (mind the C1 DRY watch-list). The `min_thickness` / view-state reader is the same one C2a uses — import or factor it, don't re-implement.

- [ ] **Step 4: Run — expect PASS** via the wrapper (grep output). Pay special attention to **SAB-7** (over-merge) and **SAB-9** (contiguity) — they catch the two structural traps.

- [ ] **Step 5: Commit.**

```bash
git add src/groundmodel/application/subdivide_all_bodies.py tests/integration/api/test_subdivide_all_bodies.py
git commit -m "feat(geotech): SubdivideAllBodies body-centric use case with geotech body materialisation (#geotech-s1)"
```

### Task E4: Endpoint + client call

**Files:** Modify `api/routers/geology/geotech.py`; create schemas under `api/schemas/project/geotech_suggestion/`; modify `desktop/src/renderer/src/api/clients/geology.ts`.

- [ ] **Step 1:** Add `POST /models/{model_id}/geotech/subdivide-all-bodies` mirroring `geotech/build` (read it first). `model_id` = the **litho** model. Body `SubdivideAllBodiesRequest { section_id: UUID }`. Response `SubdivideAllBodiesResponse { geotech_model_id, created_formation_ids, layer_count, body_count, split_body_count, one_class_body_count, borehole_only_count }`. One schema class per file.
- [ ] **Step 2:** Integration test hitting `geotech/build` then `geotech/subdivide-all-bodies` via httpx; run via the wrapper (grep output).
- [ ] **Step 3:** Add `subdivideAllBodies(projectId, lithoModelId, sectionId): Promise<SubdivideAllBodiesResponse>` + the type to `geology.ts`. tsc-gate from `desktop/`: `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json` (Node 22).
- [ ] **Step 4: Commit** each file separately (schemas, endpoint, client).

### Task E5: Real-data eval vs `test.strix`

Synthetic tests are necessary-not-sufficient (the real-data rule — see the deep-to-deep substrate memory + `feedback_profile_before_optimizing`). Validate against the owner's manual NAD marks before declaring E done.

**Files:** Create `scripts/eval_geotech_subdivision.py`.

- [ ] **Step 1:** Mirror `scripts/eval_strat_fidelity.py`. Against the dev DB (`:5433`, **no** DATABASE_URL override), load `test.strix`'s litho model, run `BuildGeotechModelFromLitho` then `SubdivideAllBodies` per cross-section, and report per body group: consistent-vs-one-class decision, the band-class sequence, body count, and (where owner manual NAD marks exist) a match/miss count. Print a summary table.
- [ ] **Step 2:** Run it; read the output. Judge consensus strictness: if many bodies the owner split manually fall to one-class (exact-band-sequence too strict), record that the **±1-band fuzzy tolerance** (spec §0.1 open item a) is the indicated refinement — but do NOT change the default without owner confirmation. Capture the numbers in the task report.
- [ ] **Step 3: Commit** the eval script.

```bash
git add scripts/eval_geotech_subdivision.py
git commit -m "test(geotech): real-data eval for body-centric subdivision (#geotech-s1)"
```

---

## Phase F — Frontend: render geotech bands via the litho engine + verb

> Per CLAUDE.local.md: work from `desktop/`, Node 22.x, vitest via `./node_modules/.bin/vitest run <file>`, tsc via `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json`. After editing `ContactsLayer.tsx` run `react-hook-order-check`; for overlays drawing at along-section positions run `strix-section-geometry-check`.

### Task F1: NAD class names + colour map

**Files:** Create `desktop/src/renderer/src/utils/nadClasses.ts`; Test `nadClasses.test.ts`.

- [ ] **Step 1: Write the failing test** — `nadClassName(6)` returns the packing-class label (starts with `"ZAND"`), `nadClassName(null)` returns the `"No qc — manual class"` sentinel, `nadClassColor(6)` returns a valid `#rrggbb`. Pin two known class numbers against the backend `NAD_CLASSES` labels.
- [ ] **Step 2: Run — expect FAIL** (`./node_modules/.bin/vitest run src/renderer/src/utils/nadClasses.test.ts`).
- [ ] **Step 3: Implement** — port the 31 `NAD_CLASSES` labels from backend `shared/constants/litho_constants.py` into a frozen `NAD_CLASS_NAMES: Record<number, string>` (translate-at-presentation: this is a UI lookup table; the backend stays raw). Add `nadClassName(n: number | null): string` (null → the no-qc sentinel) and `nadClassColor(n: number | null): string` mapping packing density → a deterministic colour ramp (document it as a placeholder palette; null → a neutral/hatched colour). **Verify each label against the backend constant, not a self-grep** (`feedback_verify_against_source_not_self`).
- [ ] **Step 4: Run — expect PASS.** **Commit.**

### Task F2: `GeotechnicalCanvas` — fetch geotech layers/edges + mount the section view

**Files:** Modify `shell/stages/geotechnical/GeotechnicalCanvas.tsx`; `SectionsCanvas.tsx` (or fold its section-host logic) for the geotech-axis fetch.

- [ ] **Step 1:** Read `SectionsCanvas.tsx` (the litho host) as the mirror — how it fetches `lithoLayers` (`api.geology.listLayers`) + `contactCorrelationEdges` (`api.geology.listContactCorrelations`) keyed on `activeLithoModel`, and passes them + `axisMode` to `SectionPanel`.
- [ ] **Step 2:** Build `GeotechnicalCanvas` to mount the same `SectionPanel`-based view at `axisMode='geotechnical'`, but fetch the layers + edges from the **geotech** model id (the build/subdivide response carries `geotech_model_id`; or look it up as the active litho model's `kind='geotechnical'` child). The endpoints already serve geotech ids with no kind gate (verified). Build `formationColorById` for geotech as `formation_id → nadClassColor(formation.nad_class)` and `formationLabelById` as `formation_id → nadClassName(formation.nad_class)`. Pass them + `axisMode='geotechnical'` into `SectionPanel`.
- [ ] **Step 3:** Wire the **build-then-subdivide gate**: the `geotech-not-built-hint` CanvasHints line (already added in D2) shows until the geotech model exists for the section; the verb (F4) is disabled until then.
- [ ] **Step 4:** Vitest smoke (mounts; shows the gate hint pre-build) + tsc on every changed file. **Commit per file.**

### Task F3: Relax the SectionPanel overlay gates for geotech + no-qc band state

**Files:** Modify `SectionPanel.tsx`.

- [ ] **Step 1:** Relax the `PartitionFillOverlay` mount gate (~3062) and the `CorrelationEdgesOverlay` gate (~3030) from `axisMode === 'lithostratigraphic'` to `(axisMode === 'lithostratigraphic' || axisMode === 'geotechnical')`. The engine is kind-agnostic; it renders the geotech layers/edges/body_ids exactly as litho. **Do not** alter the litho branch. Follow the existing `'lithostratigraphic' || 'geotechnical'` idiom already present at several sibling sites (~2759/2769/2778).
- [ ] **Step 2:** A borehole/no-qc geotech band (`nad_class == null` formation) renders in the **distinct "No qc — manual class"** state — `nadClassColor(null)` gives the neutral/hatched fill, `nadClassName(null)` the label; **never amber** (amber = unsaved invariant). The "CPT est." badge marks CPT-derived bands (a band whose formation has a non-null `nad_class`).
- [ ] **Step 3:** Vitest asserting a geotech-axis SectionPanel renders `PartitionFillOverlay` with NAD colours + the no-qc state; tsc. (No `ContactsLayer` hook changes expected; if any are made, run `react-hook-order-check`.) **Run `strix-section-geometry-check`.** **Commit.**

### Task F4: "Subdivide all bodies" toolbar verb

**Files:** Modify the section toolbar + the coordinator handler (mirror `useLithoSuggestions.handleAcceptAllLithoSuggestions`).

- [ ] **Step 1:** Read `SectionsToolbar.tsx` — mirror the `handleAcceptCorrelations` template (guard → `setBusy(true)` → `await api.geology.<call>` → refetch → toast → `finally setBusy(false)`). Add a **headline** "Subdivide all bodies" verb gated on `sectionModelAxis === 'geotechnical'`, disabled until the geotech model is built for the section (F2 gate). Pair it with the existing **Build** verb (the two-step flow).
- [ ] **Step 2:** The handler calls `api.geology.subdivideAllBodies(projectId, lithoModelId, sectionId)`, then refetches the geotech **layers + edges + formations** (so the bands + body colours re-render), records created rows into session-imports + `markMutated` (mirror `recordCreatedRows`), and toasts `split_body_count` split / `one_class_body_count` single-class.
- [ ] **Step 3:** Vitest on the toolbar (verb present, disabled pre-build, fires the call) + tsc. **Commit.**

### Task F5: Geotech inspector roster

**Files:** Create a geotech inspector (mirror `LithologyInspector.tsx`).

- [ ] **Step 1:** Mirror `LithoFormationRoster`/`LithoUnitRow`: list the geotech `geological_formation` rows with a colour swatch (`nadClassColor`), the **packing-class name** (`nadClassName(nad_class)`) with raw `NAD {n}` as the `title` tooltip + a **"CPT est."** badge, and a body/contact-count badge. Borehole/no-qc units show the "No qc — manual class" label. (The grouped-by-body legend can mirror `LithoSolidLegend` later; the flat formation roster is the S1 deliverable.)
- [ ] **Step 2:** Vitest pinning the packing-name label + CPT-est badge + no-qc row; tsc. **Commit.**

### Task F6: e2e spec + fixture

**Files:** Create `desktop/tests/e2e/flow_geotech_subdivide_all_bodies.spec.ts` + a DOV-free fixture (mirror a `flow_*` litho spec + fixture).

- [ ] **Step 1:** Mirror an existing litho `flow_*` spec: open the geotech stage on a seeded section, click **Build**, assert the gate hint clears, click **Subdivide all bodies**, assert ≥1 connected geotech body-band renders with an NAD packing-name label + "CPT est." badge. (No drag needed.)
- [ ] **Step 2:** Run `.\scripts\run-e2e.ps1 flow_geotech_subdivide_all_bodies` — **close the dev app first** (:8765; the runner aborts if busy). Re-seed the fixture if integration tests wiped it (shared `groundmodel_integration`).
- [ ] **Step 3: Commit** the spec + fixture.

---

## Phase G — Docs + debt + memory

- [ ] **G1:** Update the geotech plan status banner (`docs/superpowers/plans/2026-06-23-geotech-stage-slice-1.md`) + spec §0.1 step 5 to record the Option-A decision (geotech bodies materialised via litho machinery; same-position-edge-only rule). Commit each doc.
- [ ] **G2:** Add to `docs/debt.md` (Tier-D, post-S1): **What** — the Parameters-stage `parameter_group` + membership + lab-test association (p-q regression, grain-size comparison, merge non-contiguous lenses) is deferred to Slice 3; it will reference the geotech `body_id` persisted in S1. **Why deferred** — triaxial/lab tests aren't imported yet; designing the group/membership + merge-split gesture blind to that data is premature. **When to revisit** — when lab-test import lands (design the `parameter_group` table + the merge/split gesture together — architect note: a read-only grouping without the gesture is not shippable). Commit.
- [ ] **G3:** Update `CLAUDE.md` (geotech line / "Recently resolved") + the `project_geotech_stage_body_centric` memory file: `SubdivideAllBodies` shipped, Option A (real geotech bodies via litho machinery, same-position edges), the E5 eval numbers, and the deferred `parameter_group` (Slice 3). Commit the CLAUDE.md change.

---

## Self-review notes (gaps the executor must honour)

- **SAB-7 over-merge is the #1 trap** — same-band-position edges only. If two packing classes of one body share a `body_id`, the edge derivation crossed positions. The test must assert distinct `body_id`s.
- **Write layers, let contacts derive** — the LL→FC trigger is ungated; do NOT also write the split contacts directly (double-write). The FC→LL trigger IS kind-gated, so geotech contacts never derive layers — layers must be explicit, `status='accepted'`.
- **Contiguity** — geotech layers must tile each investigation's geo-bounded extent (clamp the top/base sub-intervals to it). SAB-9 pins it.
- **Resolver runs on geotech (no kind guard)** — the earlier draft's "add a guard blocking non-litho" is wrong; the resolver is the mechanism that gives geotech `body_id`.
- **Consensus = exact band-class sequence (v1)** — ±1-band fuzzy is the documented refinement; change only after the E5 eval + owner confirmation.
- **TIN <3 points → flat mean** — single/double-CPT groups + boreholes still get a connected split.
- **Frontend render is verbatim reuse** — `computeSectionFill`/`PartitionFillOverlay` are kind-agnostic; the only geotech-specific UI is NAD colour/label/badge/no-qc. No clip function, no new geometry.
- **Wrapper exit code lies** — grep `run-integration-tests.ps1` output for "passed/failed/error".
- **Pre-existing `test_import_progress` order-flake** — if it's the SOLE pre-commit failure, `--no-verify` with a note; any other failure = fix.
- **Out of this slice:** `parameter_group` / merge-split / regressions / lab-test association (Slice 3), displayed Ic/Dr/γ indicators (Slice 4), horizontal-correlation-into-larger-bodies authoring (Slice 2), 3D geotech build, the Qtn toggle.
```