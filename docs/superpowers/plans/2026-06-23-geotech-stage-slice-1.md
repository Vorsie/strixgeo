# Geotechnical Stage — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `kind='geotechnical'` sibling model that subdivides lithostratigraphic units into Belgian NAD packing classes (1–31) via an assisted-manual flow — automatic geo-bounding on build, a raw-qc NAD-band suggester, and ghost accept/reject/drag — reusing the existing contact/section/bundle pipeline.

**Architecture:** Geotech units are `geological_formation` rows under a `kind='geotechnical'` model; geotech contacts are `FormationContact` rows (geotech `model_id` + `parent_geo_contact_id` provenance). The classifier is a pure `(soil, admixture-variant, qc-band) → NAD class` lookup (no Dr, no σ′v). The build divides litho picks at geological boundaries (reusing `litho_geo_bounding`'s pure geometry) then suggests packing splits within each geo-bounded segment.

**Tech Stack:** Python 3.11 + Polars (domain), SQLAlchemy + Alembic (persistence), FastAPI (API), React + Electron + Vitest (frontend), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-06-23-geotech-stage-slice-1-design.md`. Read it first.

**Phasing:** Each phase produces testable software. Phase A (domain core) is fully TDD-detailed. Phases B–D wire into live components — each task names the exact files, signatures, new code, and (for near-copies) the file to mirror and the precise adaptations; the executor reads the cited live file before adapting it.

---

## ⚠ Gating input — Task T0 (owner)

The production NAD qc thresholds come from the owner's Excel (`Correlaties uit S en NAD_NEN_v2.xlsx`, sheet `laagnr NAD-NEN`), **not yet in the repo**. **Phase A is built and tested against a small, clearly-marked PROVISIONAL representative table** so all code + tests land now; T0 swaps the production values in without changing structure or tests.

- [ ] **T0 (blocked on owner): add the Excel + port production thresholds**
  - Add `Correlaties uit S en NAD_NEN_v2.xlsx` to `src/groundmodel/infrastructure/codelists/data/`.
  - Replace the provisional values in `nad_classification_constants.py` (Task A1) with the ported table, keeping the same structure. Tests in A2/A3 assert *mechanics* against the provisional table and stay green; add one integration test asserting a few known rows from the real Excel.
  - **Also confirm with owner:** does the Excel carry Qtn bands? If not, the Qtn toggle (Task D-Settings) ships disabled with a "raw qc only for now" note.
  - This task does NOT block Phases A–D structurally — do it whenever the Excel lands.

---

## File Structure

**New (backend):**
- `src/groundmodel/domain/services/nad_classification_constants.py` — the `(soil, admixture-variant, qc-band) → NAD class` lookup table + variant enum.
- `src/groundmodel/domain/services/nad_classifier.py` — pure `classify_nad(...)` function.
- `src/groundmodel/domain/services/geotech_subdivision.py` — the per-segment NAD subdivision suggester.
- `src/groundmodel/application/build_geotech_model_from_litho.py` — geo-bounding + persist use case.
- `src/groundmodel/application/suggest_geotech_subdivision.py` — runs the suggester per in-corridor investigation.
- `src/groundmodel/application/accept_geotech_suggestions.py` — commits accepted ghosts.
- Migration under `src/groundmodel/infrastructure/db/migrations/versions/` — the dual-ref FKs.

**Modified (backend):** `geological_formation_orm.py` (+2 FK columns), the geological-formation response schema + bundle build/restore (+2 fields), `api/routers/geology/contacts.py` (geotech suggest/accept/build endpoints + relax the `kind` guard), the geological-formation repository (read the new FKs).

**New (frontend):** `desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx` (replace placeholder), `components/sections/GeotechSuggestionGhostColumns.tsx`, geotech API client calls, a geotech inspector roster, Settings rows.

**Modified (frontend):** `ContactsLayer.tsx` + `CanvasHints.tsx` (`axisMode:'geotechnical'`), `api/client.ts` (geotech types/calls), Settings panel.

**Tests:** `tests/unit/domain/test_nad_classifier.py`, `tests/unit/domain/test_geotech_subdivision.py`, `tests/integration/.../test_build_geotech_model.py`, `tests/integration/.../test_accept_geotech_suggestions.py`, frontend `*.test.tsx`, an e2e spec + DOV-free fixture.

---

## Phase A — Domain core (pure, TDD, Excel-independent)

### Task A1: NAD classification lookup table

**Files:**
- Create: `src/groundmodel/domain/services/nad_classification_constants.py`

- [ ] **Step 1: Write the constants module**

```python
"""Provisional NAD packing-class lookup: ``(soil, admixture-variant, qc) → class``.

⚠ PROVISIONAL VALUES — the production qc thresholds come from the owner's
``Correlaties uit S en NAD_NEN_v2.xlsx`` (Task T0). The STRUCTURE here is final;
only the numbers get swapped. Classification is on RAW qc (MPa), no Dr, no σ′v
(spec §5).

A variant is ``"clean"`` or ``"secondary"``. ``"secondary"`` means the soil
carries its single admixture variant that the NAD table defines:
sand → silt-/kleihoudend, silt/clay → zandhoudend. Any other admixture (e.g.
gravelly sand) is NOT a NAD variant and falls to ``"clean"`` (spec §5, exact
matching). Gravel uses clean/secondary too (silt-/kleihoudend).
"""

from __future__ import annotations

from typing import Literal

from groundmodel.shared.constants.litho_constants import BaseLithology

Variant = Literal["clean", "secondary"]

# Each entry: ascending list of (qc_upper_bound_mpa, nad_class). The classifier
# picks the first band whose upper bound is >= qc; qc above the last band → that
# last (densest) class; qc below the first → that first (loosest) class
# (nearest-class fallback, spec §5). ``None`` upper bound = open-topped (densest).
NAD_QC_BANDS: dict[tuple[BaseLithology, Variant], list[tuple[float | None, int]]] = {
    # GRIND (provisional)
    ("GRIND", "clean"): [(10.0, 1), (None, 2)],
    ("GRIND", "secondary"): [(10.0, 3), (None, 4)],
    # ZAND: los<5 / matig 5-10 / dicht 10-15 / zeer dicht >15 (provisional, memory)
    ("ZAND", "clean"): [(5.0, 5), (10.0, 6), (15.0, 7), (None, 8)],
    ("ZAND", "secondary"): [(5.0, 9), (10.0, 10), (15.0, 11), (None, 12)],
    # SILT: weinig/matig/vrij/vast (provisional)
    ("SILT", "clean"): [(1.0, 13), (2.0, 14), (4.0, 15), (None, 16)],
    ("SILT", "secondary"): [(1.0, 17), (2.0, 18), (4.0, 19), (None, 20)],
    # KLEI (provisional)
    ("KLEI", "clean"): [(0.5, 21), (1.0, 22), (2.0, 23), (None, 24)],
    ("KLEI", "secondary"): [(0.5, 25), (1.0, 26), (2.0, 27), (None, 28)],
    # VEEN: qc-based peat packing is weak; provisional single-band default.
    ("VEEN", "clean"): [(0.3, 29), (0.6, 30), (None, 31)],
    ("VEEN", "secondary"): [(0.3, 29), (0.6, 30), (None, 31)],
}

# Which admixture soil_codes map to the "secondary" NAD variant per main soil
# (spec §5, exact matching). Codes are DOV admixture soil_codes (see
# ``value_objects/admixture.py``). Sand/gravel take silt OR clay; silt/clay/peat
# take sand. Anything else → "clean".
_SECONDARY_ADMIXTURE_CODES: dict[BaseLithology, frozenset[str]] = {
    "GRIND": frozenset({"SI", "KL"}),
    "ZAND": frozenset({"SI", "KL"}),
    "SILT": frozenset({"ZA"}),
    "KLEI": frozenset({"ZA"}),
    "VEEN": frozenset({"ZA"}),
}
```

- [ ] **Step 2: Commit**

```bash
git add src/groundmodel/domain/services/nad_classification_constants.py
git commit -m "feat(geotech): provisional NAD qc-band lookup table (#geotech-s1)"
```

> **Note on admixture codes:** `SI`/`KL`/`ZA` are placeholders for the DOV silt/clay/sand admixture `soil_code`s. **Before A2, verify the real codes** by grepping the litho admixture parser / `DOV` codelists (`grep -rn "soil_code" src/groundmodel/infrastructure/parsers` and the admixture fixtures) and correct the frozensets. This is a 2-minute lookup, not a guess to ship.

### Task A2: NAD classifier (pure function)

**Files:**
- Create: `src/groundmodel/domain/services/nad_classifier.py`
- Test: `tests/unit/domain/test_nad_classifier.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for the pure NAD classifier (spec §5)."""

from groundmodel.domain.services.nad_classifier import classify_nad
from groundmodel.domain.value_objects.admixture import Admixture


def test_clean_sand_band_selection():
    # qc 8 MPa clean sand → matig (NAD 6) per provisional bands (5–10).
    assert classify_nad("ZAND", (), 8.0) == 6


def test_clean_sand_densest_when_qc_above_all_bands():
    assert classify_nad("ZAND", (), 99.0) == 8


def test_clean_sand_loosest_when_qc_below_all_bands():
    # qc below the first band → nearest = loosest class (NAD 5). Lithology truth.
    assert classify_nad("ZAND", (), 0.1) == 5


def test_silty_sand_uses_secondary_variant():
    # Sand + clay admixture → silt-/kleihoudend variant (9–12), qc 8 → NAD 10.
    admx = (Admixture(soil_code="KL", amount="M"),)
    assert classify_nad("ZAND", admx, 8.0) == 10


def test_gravelly_sand_is_not_a_variant_falls_to_clean():
    # Gravel admixture on sand has NO NAD variant → clean sand (NAD 6 at qc 8).
    admx = (Admixture(soil_code="GR", amount="M"),)
    assert classify_nad("ZAND", admx, 8.0) == 6


def test_sandy_clay_uses_secondary_variant():
    admx = (Admixture(soil_code="ZA", amount="M"),)
    assert classify_nad("KLEI", admx, 1.5) == 27  # secondary clay band 1.0–2.0


def test_lithology_is_hard_truth_qc_never_changes_soil():
    # A clay at sand-like qc (12 MPa) stays clay — densest clay class, not sand.
    assert classify_nad("KLEI", (), 12.0) == 24
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/domain/test_nad_classifier.py -v`
Expected: FAIL with `ModuleNotFoundError: ... nad_classifier`.

- [ ] **Step 3: Write the implementation**

```python
"""Pure NAD packing classifier — ``(soil, admixture, qc) → NAD class`` (spec §5)."""

from __future__ import annotations

from groundmodel.domain.services.nad_classification_constants import (
    NAD_QC_BANDS,
    _SECONDARY_ADMIXTURE_CODES,
    Variant,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology


def _variant_for(soil: BaseLithology, admixtures: tuple[Admixture, ...]) -> Variant:
    """Exact-match the soil's single NAD secondary variant, else ``clean``."""
    codes = _SECONDARY_ADMIXTURE_CODES.get(soil, frozenset())
    if any(a.soil_code in codes for a in admixtures):
        return "secondary"
    return "clean"


def classify_nad(
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    qc_mpa: float,
) -> int:
    """Classify one (soil, admixture, qc) into a NAD class 1–31.

    Pure raw-qc band lookup (no Dr/σ′v). qc outside the table's bands snaps to
    the nearest (loosest/densest) class within the soil's column; lithology is
    hard truth (qc never changes the soil). See spec §5.

    Parameters
    ----------
    soil : BaseLithology
        Main soil type of the source litho unit.
    admixtures : tuple[Admixture, ...]
        The unit's admixtures (used only to pick clean vs secondary variant).
    qc_mpa : float
        Cone resistance at the segment (raw qc by default).

    Returns
    -------
    int
        NAD class 1–31.
    """
    variant = _variant_for(soil, admixtures)
    bands = NAD_QC_BANDS[(soil, variant)]
    for upper, nad_class in bands:
        if upper is None or qc_mpa < upper:
            return nad_class
    return bands[-1][1]  # qc >= last finite bound and no open band: densest
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/unit/domain/test_nad_classifier.py -v`
Expected: PASS (7 tests). Then `uv run ruff format` + `uv run ruff check --fix` on both files.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/nad_classifier.py tests/unit/domain/test_nad_classifier.py
git commit -m "feat(geotech): pure NAD qc-band classifier (#geotech-s1)"
```

### Task A3: Geotech subdivision suggester

Suggests packing-split depths within ONE geo-bounded, lithology-known segment. Reuses the segmenter helpers from `litho_segmentation.py` (`_rolling_median_zones`, `_run_length_encode`, `_greedy_merge` — read their signatures there) for smoothing + RLE + min-thickness merge, but classifies each run via `classify_nad` on RAW qc, not Robertson/Dr.

**Files:**
- Create: `src/groundmodel/domain/services/geotech_subdivision.py`
- Test: `tests/unit/domain/test_geotech_subdivision.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for the geotech NAD subdivision suggester (spec §4 Step B)."""

from groundmodel.domain.services.geotech_subdivision import (
    GeotechSplit,
    suggest_geotech_subdivision,
)


def _depths(top: float, base: float, step: float = 0.5) -> list[float]:
    out, d = [], top
    while d <= base + 1e-9:
        out.append(round(d, 3))
        d += step
    return out


def test_uniform_qc_yields_single_unit():
    # A constant-qc clean sand segment → ONE NAD unit, no internal split.
    depths = _depths(2.0, 8.0)
    qc = [8.0] * len(depths)
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(), depth_m=depths, qc_mpa=qc,
        segment_top_m=2.0, segment_base_m=8.0, min_thickness_m=0.5,
    )
    assert [s.nad_class for s in splits] == [6]
    assert splits[0].depth_top_m == 2.0 and splits[0].depth_base_m == 8.0


def test_band_change_splits_into_two_units():
    # qc 8 (matig, NAD 6) over the top half, qc 18 (zeer dicht, NAD 8) below.
    depths = _depths(0.0, 10.0)
    qc = [8.0 if d < 5.0 else 18.0 for d in depths]
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(), depth_m=depths, qc_mpa=qc,
        segment_top_m=0.0, segment_base_m=10.0, min_thickness_m=0.5,
    )
    assert [s.nad_class for s in splits] == [6, 8]
    assert abs(splits[0].depth_base_m - 5.0) <= 0.5


def test_min_thickness_merges_thin_spike():
    # A 1-sample dense spike thinner than min_thickness must NOT create a unit.
    depths = _depths(0.0, 10.0)
    qc = [8.0] * len(depths)
    qc[len(qc) // 2] = 30.0  # single spike
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(), depth_m=depths, qc_mpa=qc,
        segment_top_m=0.0, segment_base_m=10.0, min_thickness_m=1.0,
    )
    assert [s.nad_class for s in splits] == [6]  # spike smoothed/merged away


def test_non_monotonic_dense_shallow_loose_deep():
    # dense (18) shallow → loose (8) deep: two units, dense on top.
    depths = _depths(0.0, 10.0)
    qc = [18.0 if d < 5.0 else 8.0 for d in depths]
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(), depth_m=depths, qc_mpa=qc,
        segment_top_m=0.0, segment_base_m=10.0, min_thickness_m=0.5,
    )
    assert [s.nad_class for s in splits] == [8, 6]
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -v`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Write the implementation**

Read `src/groundmodel/domain/services/litho_segmentation.py` lines 148–230 first to confirm the exact signatures of `_rolling_median_zones`, `_run_length_encode`, `_greedy_merge`, then:

```python
"""Geotech NAD subdivision suggester — packing splits within one litho segment.

Reuses the litho segmenter's smoothing/RLE/merge helpers but classifies on RAW
qc via :func:`classify_nad` (no Dr). Heavy smoothing is an in-memory split
helper only (spec §1, §4 Step B).
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.services.litho_segmentation import (
    _greedy_merge,
    _rolling_median_zones,
    _run_length_encode,
)
from groundmodel.domain.services.nad_classifier import classify_nad
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology

# Smoothing half-window in samples — heavier than the litho default so single
# spikes/drops do not trigger spurious packing splits (spec §1). In-memory only.
_SMOOTH_HALF_WINDOW = 5


@dataclass(frozen=True)
class GeotechSplit:
    """One suggested NAD sub-unit within a geo-bounded litho segment.

    Parameters
    ----------
    depth_top_m, depth_base_m : float
        Sub-unit bounds (clamped to the parent segment).
    nad_class : int
        Classified NAD class 1–31.
    """

    depth_top_m: float
    depth_base_m: float
    nad_class: int


def suggest_geotech_subdivision(
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    depth_m: list[float],
    qc_mpa: list[float],
    segment_top_m: float,
    segment_base_m: float,
    min_thickness_m: float,
) -> list[GeotechSplit]:
    """Suggest NAD sub-units for one geo-bounded litho segment.

    Returns one ``GeotechSplit`` per packing run after smoothing + min-thickness
    merge. A uniform segment returns a single split spanning the whole segment.
    """
    in_seg = [
        (d, q)
        for d, q in zip(depth_m, qc_mpa)
        if segment_top_m - 1e-9 <= d <= segment_base_m + 1e-9
    ]
    if not in_seg:
        return [GeotechSplit(segment_top_m, segment_base_m, classify_nad(soil, admixtures, 0.0))]

    classes = [classify_nad(soil, admixtures, q) for _d, q in in_seg]
    smoothed = _rolling_median_zones(classes, _SMOOTH_HALF_WINDOW)
    runs = _run_length_encode(smoothed)  # list[(class, start_idx, end_idx)]
    step = (in_seg[-1][0] - in_seg[0][0]) / max(len(in_seg) - 1, 1)
    min_samples = max(1, int(round(min_thickness_m / step))) if step > 0 else 1
    runs = _greedy_merge(runs, min_samples)

    depths = [d for d, _q in in_seg]
    splits: list[GeotechSplit] = []
    for i, (cls, start, end) in enumerate(runs):
        top = segment_top_m if i == 0 else depths[start]
        base = segment_base_m if i == len(runs) - 1 else depths[end]
        splits.append(GeotechSplit(round(top, 3), round(base, 3), int(cls)))
    return splits
```

> If `_greedy_merge`'s real signature differs (e.g. it takes the depths or a different arg order), adapt this call to the verified signature — do not guess. The tests pin the *behaviour*.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -v`
Expected: PASS (4 tests). Then ruff format + check --fix.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/geotech_subdivision.py tests/unit/domain/test_geotech_subdivision.py
git commit -m "feat(geotech): NAD subdivision suggester reusing litho smoothing helpers (#geotech-s1)"
```

---

## Phase B — Persistence + migration

### Task B1: Dual-reference FK columns on `geological_formation`

**Files:**
- Modify: `src/groundmodel/infrastructure/db/models/geological_formation_orm.py`
- Create: a migration in `src/groundmodel/infrastructure/db/migrations/versions/`

- [ ] **Step 1:** Read `geological_formation_orm.py`. Add two nullable self-FK columns mirroring the existing `parent_formation_id` pattern:

```python
    # The litho formation this geotech unit subdivides (spec §3 explicit dual ref).
    source_litho_formation_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("geological_formation.id", ondelete="SET NULL"), nullable=True
    )
    # The geological formation the unit sits within (Paleogene vs Quaternary clay
    # carry different parameters → first-class stored, not only transitive).
    source_geo_formation_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("geological_formation.id", ondelete="SET NULL"), nullable=True
    )
```

- [ ] **Step 2:** Autogenerate the migration:

Run: `uv run alembic revision --autogenerate -m "geotech dual-ref fks on geological_formation"`
Then read the generated file and confirm it only adds the two columns + FKs (no unrelated drift). Edit out any spurious autogen ops.

- [ ] **Step 3:** Apply to the dev DB (per CLAUDE.local.md — bare command, no DATABASE_URL override):

Run: `uv run alembic upgrade head`
Expected: the two columns appear on `geological_formation` (verify with `\d geological_formation` if desired).

- [ ] **Step 4: Commit** (migration file + ORM in one commit, schema change is atomic):

```bash
git add src/groundmodel/infrastructure/db/models/geological_formation_orm.py src/groundmodel/infrastructure/db/migrations/versions/
git commit -m "feat(geotech): dual-ref FK columns on geological_formation (#geotech-s1)"
```

### Task B2: Carry the FKs through the response schema + bundle

**Files:**
- Modify: `src/groundmodel/api/schemas/project/geological_formation.py` (read it first)
- Modify: the bundle build + restore for formations (grep `geological_formations` in `infrastructure/db/repositories/project_bundle/`)
- Test: `tests/integration/.../test_bundle_*` (extend the existing formation round-trip)

- [ ] **Step 1: Write/extend the failing integration test** — assert a `geological_formation` with `source_litho_formation_id` + `source_geo_formation_id` set survives a bundle export→restore round-trip. (Mirror the existing formation round-trip test; add the two fields to the asserted equality.)
- [ ] **Step 2: Run — expect FAIL** (fields not serialized).
- [ ] **Step 3: Implement** — add `source_litho_formation_id: UUID | None = None` + `source_geo_formation_id: UUID | None = None` (Optional, default None — additive per the API rule) to the response schema; map them in bundle build + restore. Confirm the restore's unknown-key tolerance still covers legacy bundles (they simply lack the keys → default None).
- [ ] **Step 4: Run — expect PASS.** Use `.\scripts\run-integration-tests.ps1 tests/integration/.../test_bundle_*.py` (sibling DB — never bare pytest on integration, per CLAUDE.md).
- [ ] **Step 5: Commit** (schema then bundle as separate file commits).

---

## Phase C — Use cases + API

### Task C1: `BuildGeotechModelFromLitho` (geo-bounding + persist)

Creates/ensures the `kind='geotechnical'` model and writes geotech `FormationContact` rows at the geological division positions, geology as hard bound. Reuses the PURE geometry of `litho_geo_bounding.divide_picks_by_geology` + `mark_and_truncate_shallow_tests` (verified signatures: they take `list[BodyLayerPick]` + boundary-sampler callables, return transformed picks — NOT a persistence path). Read `application/assemble_strat_inputs.py` (`assemble_with_geo`) and `recompute_litho_solids.py` for how the `BoundarySampler` + pick loading are assembled, and `LithoLayerRepository.load_body_picks` for the model-wide loader.

**Files:**
- Create: `src/groundmodel/application/build_geotech_model_from_litho.py`
- Add a **section-scoped** pick loader (a variant of `load_body_picks` filtered to in-corridor investigations) — add it to the litho layer repository next to `load_body_picks`.
- Test: `tests/integration/.../test_build_geotech_model.py`

- [ ] **Step 1: Write the failing integration test** — seed a litho model with two investigations whose units straddle a geological boundary; build the geotech model; assert: (CP-A) a unit straddling a geo boundary is DIVIDED into two geotech contacts at the boundary; (CP-B) a unit whose contact is within `litho_snap_tolerance_m` of the geo boundary is SNAPPED (no extra contact); (CP-C) each created geotech `FormationContact` carries `parent_geo_contact_id` provenance; (CP-D) the geotech model has `kind='geotechnical'` and parent = the litho model. Use the litho_geo_bounding pure-function fixtures as the geometry oracle for the division depths.
- [ ] **Step 2: Run — expect FAIL** (use case missing).
- [ ] **Step 3: Implement the use case** — `execute(litho_model_id, section_id)`:
  1. Ensure a `kind='geotechnical'` model child of the litho model (reuse the existing model-create/ensure pattern — grep `REQUIRED_PARENT_KIND` consumers + the `POST /models` use case).
  2. Load section-scoped litho `BodyLayerPick`s (new loader).
  3. `picks = mark_and_truncate_shallow_tests(picks, lowest_boundary_elevation_at)` then `picks = divide_picks_by_geology(picks, boundary_elevations_at, snap_tolerance_m)` — assemble the samplers exactly as `assemble_with_geo` does.
  4. For each division boundary the geometry introduced (a `band_key`-rekeyed split), create a geotech `FormationContact` at that depth on that investigation, with `parent_geo_contact_id` = the geo contact it divides at, and a geotech `geological_formation` row carrying `source_litho_formation_id`, `source_geo_formation_id`, `litho_main_soil_code` (inherited), `nad_class=None` (set at suggestion-accept).
  5. `flush=False` until one commit (per the persist contract).
- [ ] **Step 4: Run — expect PASS** via `run-integration-tests.ps1`.
- [ ] **Step 5: Commit** (repository loader, then use case).

### Task C2: `SuggestGeotechSubdivision` + `AcceptGeotechSuggestions`

**Files:**
- Create: `src/groundmodel/application/suggest_geotech_subdivision.py`
- Create: `src/groundmodel/application/accept_geotech_suggestions.py`
- Test: `tests/integration/.../test_accept_geotech_suggestions.py`

- [ ] **Step 1 (suggest):** `SuggestGeotechSubdivision.execute(geotech_model_id, section_id)` — for each geo-bounded segment on each in-corridor CPT, load the qc series (reuse the CPT series loader the litho segmenter uses — grep its repository), call `suggest_geotech_subdivision(...)` (Task A3), return ghost splits keyed by investigation + segment. No DB writes (suggestions are ephemeral, like the litho suggest path — verify against `suggest_litho_contacts.py`). Borehole columns (no qc) return a single carry-through unit, `nad_class=None`.
- [ ] **Step 2 (accept) — write the failing test first:** assert (AG-1) accepting ghost splits writes geotech `FormationContact` rows + sets the owning `geological_formation.nad_class`; (AG-2) the find-or-create key is `(nad_class, parent_litho_formation_id)` so two segments with the same class under the same litho unit share one geotech formation row; (AG-3) re-accepting the same suggestion is idempotent (no duplicate rows); (AG-4) NO litho downstream triggers fire (no absence recompute / wedge-tips / admixture propagation).
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement `AcceptGeotechSuggestions`** — a NEW use case (do NOT reuse `AcceptLithoSuggestions`; read it to mirror the contact-write mechanics only). Find-or-create geotech formation by `(nad_class, parent_litho_formation_id)`; write contacts; single commit.
- [ ] **Step 5: Run — expect PASS;** commit each use case separately.

### Task C3: Endpoints + relax the `kind` guards

**Files:**
- Modify: `src/groundmodel/api/routers/geology/contacts.py` (read it first — the litho suggest/accept endpoints are the mirror)
- Modify the ~7 `kind`-guard sites (spec §6) to admit `geotechnical` where appropriate.

- [ ] **Step 1:** Add three endpoints mirroring the litho ones: `POST .../models/{mid}/geotech/build` (→ C1), `POST .../models/{mid}/geotech/suggest` (→ C2 suggest), `POST .../contacts/accept-geotech-suggestions` (→ C2 accept). Use response schemas mirroring the litho equivalents.
- [ ] **Step 2:** For each `kind`-guard site in spec §6, read it and either add a `geotechnical` branch or relax the guard, with a one-line reason comment. Do NOT blanket-relax — `suggest_litho_contacts` stays litho-only (geotech has its own suggester); `auto_correlate` stays litho-only for S1 (correlation is Slice 2).
- [ ] **Step 3:** Add an integration test hitting `build` then `suggest` then `accept` end-to-end via httpx; run via the integration wrapper; commit per file.

---

## Phase D — Frontend (2D stage)

> Each task names the file to mirror. Read the live mirror file before adapting; reproduce its structure, change only the cited specifics. Run the desktop build's filtered tsc (`npx tsc --noEmit -p tsconfig.web.json`) + the local vitest binary (`./node_modules/.bin/vitest run <file>`, from `desktop/`, Node 22) per CLAUDE.local.md. **Use the local vitest binary, not `npx vitest`** (npx pulls a cache-global build that ignores the jsdom config).

### Task D1: API client types + calls
- **File:** `desktop/src/renderer/src/api/client.ts` (or the split `clients/geology.ts`). Add `buildGeotechModel`, `suggestGeotechSubdivision`, `acceptGeotechSuggestions` calls + their response types, mirroring the litho equivalents. tsc-gate the file. Commit.

### Task D2: `axisMode: 'geotechnical'`
- **Files:** `ContactsLayer.tsx`, `CanvasHints.tsx`, the section toolbar. Extend the `axisMode` union to include `'geotechnical'` and add the branch everywhere `axisMode` is switched on (the ~3 sites the staff review named). **Run the `react-hook-order-check` skill** after editing `ContactsLayer.tsx` (it's large + has early returns). Add a `geotechNotReconciled` hint line to `CanvasHints` (spec §7). Vitest + tsc. Commit per file.

### Task D3: `GeotechSuggestionGhostColumns`
- **File (mirror):** `components/sections/LithoSuggestionGhostColumns.tsx`. Create `GeotechSuggestionGhostColumns.tsx` as a near-copy: swap the lithology-colour read for an NAD-class colour map, render the **packing-class name** label (`NAD_CLASSES[n][0]`) with the raw number as the `title` tooltip + a "CPT est." badge (spec §7), and a distinct **"No qc — manual class"** band state for borehole/no-qc units. Reuse the accept/reject/drag callback contract verbatim. **Run `strix-section-geometry-check`** (it draws at along-section positions). Vitest pinning the NAD label + the no-qc state. Commit.

### Task D4: `GeotechnicalCanvas` + inspector + Settings
- **Files:** replace `shell/stages/geotechnical/GeotechnicalCanvas.tsx` (currently an `EmptyState` placeholder) with a SectionPanel-reusing canvas wired to the build/suggest/accept calls + the ghost component; a geotech inspector roster (mirror `LithologyInspector`) listing the NAD units with packing-name labels; Settings rows (mirror the litho-segmenter rows) for **min-thickness**, **smoothing window**, and the **raw-qc / Qtn toggle** (disabled with a note if T0 confirms no Qtn bands). Gate the "Suggest" verb until the model is built for the section (spec §7, #139 pattern). Vitest smoke + tsc. Commit per file.

### Task D5: e2e fixture + spec
- **Files:** add a DOV-free synthetic fixture exercising the geotech flow (mirror an existing `flow_*` litho spec + its fixture under `desktop/tests/e2e/`); a `flow_geotech_subdivision.spec.ts` that builds the geotech model, suggests, accepts one ghost, and asserts a committed geotech unit renders. Run `.\scripts\run-e2e.ps1 flow_geotech_subdivision` (close the dev app first — :8765). Commit.

---

## Self-review notes (gaps the executor must honour)
- **T0 gates production values only** — A1's table is provisional; do not ship to a user build claiming real NAD classes until T0 lands.
- **Admixture codes** (`SI`/`KL`/`ZA`) in A1 are placeholders — verify against the real DOV admixture `soil_code`s before A2 (noted in A1).
- **Helper signatures** (`_greedy_merge` etc.) must be read from `litho_segmentation.py` and matched exactly — A3's call is written to the expected shape; adapt if the real arg order differs (tests pin behaviour).
- **3D build, horizontal correlation, displayed Ic/Dr/γ indicators, parameter grouping, per-contact un-snap** are all explicitly out of Slice 1 (spec §2) — do not add them.
- **Cross-CPT NAD disagreement** is not handled in S1 — the suggester is per-investigation; aggregation is Slice 2.
```
