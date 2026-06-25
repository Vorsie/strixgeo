# Conservative per-threshold NAD segmentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the geotech NAD segmenter's classify→median-of-class pipeline with a conservative per-threshold construction that recovers erased packing bands, places boundaries where the engineer would, and stops over-splitting on threshold noise.

**Architecture:** Pure-domain rewrite of `suggest_geotech_subdivision` (one geo-bounded litho segment per call) built from four new pure helpers; a small read-through in the `SubdivideAllBodies` use case for the new gradient-snap knobs; and a new "Geotechnical" Settings section mirroring the existing litho-segmenter prefs.

**Tech Stack:** Python 3.11 (pure stdlib — `statistics.median`, no numpy in the domain module), pytest; React/TypeScript + Vitest for the Settings UI.

**Spec:** `docs/superpowers/specs/2026-06-25-conservative-nad-segmentation-design.md`
**Reference implementation (validated on real CPT):** `scripts/throwaway_geotech_final.py::conservative_bands`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/groundmodel/domain/services/geotech_subdivision.py` | the segmenter + its pure helpers | rewrite `suggest_geotech_subdivision`, add 4 helpers, drop dead helpers/imports |
| `tests/unit/domain/test_geotech_subdivision.py` | segmenter unit tests | replace weld-only tests with pipeline tests |
| `scripts/eval_geotech_nad_segmentation.py` | real-data acceptance (GEO-22/115-S10) | new guarded eval script |
| `src/groundmodel/application/subdivide_all_bodies.py` | reads view-state knobs, calls the segmenter | add gradient-snap read-through + pass-through |
| `desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts` | geotech view-state prefs (read/patch) | new file (mirrors `lithoSegmenterPrefs.ts`) |
| `desktop/src/renderer/src/utils/geotechSubdivisionPrefs.test.ts` | prefs tests | new file |
| `desktop/src/renderer/src/components/SettingsDialog.tsx` | settings UI | add a `geotech` section |
| `desktop/src/renderer/src/App.tsx` | wires SettingsDialog | add geotech initial prop + submit handler at both render sites |

---

## Phase A — Domain algorithm

All Phase-A work is in `geotech_subdivision.py`. Current imports at the top of that
file include `_greedy_merge, _rolling_median_zones, _run_length_encode` (from
`litho_segmentation`) and the module defines `_SMOOTH_HALF_WINDOW` and
`_merge_adjacent_same_class`. Tasks 1–4 add the new pipeline; Task 4 removes the
now-dead `_rolling_median_zones`/`_greedy_merge`/`_run_length_encode` imports,
`_SMOOTH_HALF_WINDOW`, and the RLE-based `_merge_adjacent_same_class`.

### Task 1: persistence filter helper

**Files:**
- Modify: `src/groundmodel/domain/services/geotech_subdivision.py`
- Test: `tests/unit/domain/test_geotech_subdivision.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/domain/test_geotech_subdivision.py`:

```python
from groundmodel.domain.services.geotech_subdivision import _persistence_filter


def test_persistence_filter_flips_short_interior_run():
    """A 1-sample True spike between long False runs is flipped to False."""
    mask = [False, False, False, True, False, False, False]
    assert _persistence_filter(mask, persist=3) == [False] * 7


def test_persistence_filter_keeps_runs_at_or_above_persist():
    """A run >= persist samples survives."""
    mask = [False, False, True, True, True, False, False]
    assert _persistence_filter(mask, persist=3) == mask


def test_persistence_filter_never_flips_edge_runs():
    """A short run at the very top/bottom is kept (no preceding/following anchor)."""
    mask = [True, False, False, False, False]
    assert _persistence_filter(mask, persist=3)[0] is True


def test_persistence_filter_empty():
    assert _persistence_filter([], persist=2) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -k persistence_filter -q`
Expected: FAIL — `ImportError: cannot import name '_persistence_filter'`.

- [ ] **Step 3: Write minimal implementation**

Add to `geotech_subdivision.py` (after the imports, before `GeotechSplit`):

```python
def _persistence_filter(mask: list[bool], persist: int) -> list[bool]:
    """Flip interior runs shorter than ``persist`` samples to the preceding value.

    Run-length scans ``mask`` and, for any interior run shorter than ``persist``
    samples, adopts the value of the run before it. Edge runs (first/last) are
    never flipped — they have no anchor. This is the "ignore a small dip/spike"
    rule: a brief excursion across a qc threshold no longer moves a boundary.

    Parameters
    ----------
    mask : list[bool]
        Per-sample boolean (e.g. ``qc >= threshold``).
    persist : int
        Minimum run length (samples) to survive; shorter interior runs flip.

    Returns
    -------
    list[bool]
        The persistence-filtered mask, same length as ``mask``.
    """
    n = len(mask)
    if n == 0:
        return []
    runs: list[list[int]] = []  # [value(0/1), start, end_exclusive]
    s = 0
    for j in range(1, n):
        if mask[j] != mask[s]:
            runs.append([int(mask[s]), s, j])
            s = j
    runs.append([int(mask[s]), s, n])
    for i in range(len(runs)):
        _v, a, b = runs[i]
        if (b - a) < persist and 0 < i < len(runs) - 1:
            runs[i][0] = runs[i - 1][0]
    out = [False] * n
    for v, a, b in runs:
        for k in range(a, b):
            out[k] = bool(v)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -k persistence_filter -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/geotech_subdivision.py tests/unit/domain/test_geotech_subdivision.py
git commit -m "feat(geotech): add persistence filter for NAD threshold crossings"
```

### Task 2: sustained per-threshold cuts

**Files:**
- Modify: `src/groundmodel/domain/services/geotech_subdivision.py`
- Test: `tests/unit/domain/test_geotech_subdivision.py`

- [ ] **Step 1: Write the failing test**

```python
from groundmodel.domain.services.geotech_subdivision import _sustained_threshold_cuts


def test_sustained_threshold_cuts_one_crossing():
    """A clean rise across the sand 10 MPa bound yields a cut at the crossing depth.

    depths 0.0..2.0 @ 0.1 m; qc 8 (matig) for the top metre, 12 (dicht) below.
    Persistence 0.35 m (= 3-4 samples). The cut sits at the first sustained
    >=10 sample (~1.0 m). Top/base of the window are always cuts.
    """
    depths = [round(0.1 * i, 2) for i in range(21)]  # 0.0..2.0
    qc = [8.0 if d < 1.0 else 12.0 for d in depths]
    cuts = _sustained_threshold_cuts(depths, qc, "ZAND", (), min_thickness_m=0.35)
    assert cuts[0] == 0.0 and cuts[-1] == 2.0
    interior = [c for c in cuts if 0.0 < c < 2.0]
    assert len(interior) == 1
    assert abs(interior[0] - 1.0) <= 0.15


def test_sustained_threshold_cuts_ignores_transient_spike():
    """A single-sample spike above a bound creates no cut (persistence filter)."""
    depths = [round(0.1 * i, 2) for i in range(21)]
    qc = [8.0] * 21
    qc[10] = 30.0  # 1-sample spike
    cuts = _sustained_threshold_cuts(depths, qc, "ZAND", (), min_thickness_m=0.35)
    assert cuts == [0.0, 2.0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -k sustained_threshold -q`
Expected: FAIL — `ImportError: cannot import name '_sustained_threshold_cuts'`.

- [ ] **Step 3: Write minimal implementation**

Add to `geotech_subdivision.py`. Import the variant helper + bands table at the top
of the file (add these imports):

```python
from groundmodel.domain.services.nad_classification_constants import NAD_QC_BANDS
from groundmodel.domain.services.nad_classifier import _variant_for, classify_nad
```

(`classify_nad` is already imported — keep one import line.) Then:

```python
def _median_increment(depths: list[float]) -> float:
    """Median sample spacing (m). Falls back to 0.02 m for a degenerate series."""
    diffs = [b - a for a, b in zip(depths, depths[1:]) if b > a]
    if not diffs:
        return 0.02
    diffs.sort()
    return diffs[len(diffs) // 2]


def _sustained_threshold_cuts(
    depths: list[float],
    qc: list[float],
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    min_thickness_m: float,
) -> list[float]:
    """Boundary depths where qc *sustainably* crosses each NAD band threshold.

    For every finite qc upper-bound of the soil's NAD column, the raw-qc
    ``>= bound`` mask is persistence-filtered (a crossing must hold for
    ``min_thickness_m`` to count), and each surviving transition contributes a
    cut depth. The window top and bottom are always cuts.

    Parameters
    ----------
    depths, qc : list[float]
        Parallel sample series already restricted to the segment.
    soil : BaseLithology
        Segment soil (fixes the NAD column + thresholds).
    admixtures : tuple[Admixture, ...]
        Segment admixtures (pick clean vs secondary NAD variant).
    min_thickness_m : float
        Persistence length — a crossing must hold this long to place a cut.

    Returns
    -------
    list[float]
        Sorted, de-duplicated cut depths (always includes the window ends).
    """
    if not depths:
        return []
    persist = max(1, round(min_thickness_m / _median_increment(depths)))
    variant = _variant_for(soil, admixtures)
    thresholds = [u for u, _c in NAD_QC_BANDS[(soil, variant)] if u is not None]
    cuts: set[float] = {depths[0], depths[-1]}
    for thr in thresholds:
        above = _persistence_filter([q >= thr for q in qc], persist)
        for j in range(1, len(above)):
            if above[j] != above[j - 1]:
                cuts.add(depths[j])
    return sorted(cuts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -k sustained_threshold -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/geotech_subdivision.py tests/unit/domain/test_geotech_subdivision.py
git commit -m "feat(geotech): add sustained per-threshold cut detection"
```

### Task 3: conservative merge + same-class weld (depth-band)

**Files:**
- Modify: `src/groundmodel/domain/services/geotech_subdivision.py`
- Test: `tests/unit/domain/test_geotech_subdivision.py`

A band is the 3-list `[top_m, base_m, nad_class]`.

- [ ] **Step 1: Write the failing test**

```python
from groundmodel.domain.services.geotech_subdivision import (
    _conservative_merge,
    _weld_same_class_bands,
)


def test_conservative_merge_absorbs_thin_into_weaker_neighbour():
    """A thin band between a weaker (n6) and a denser (n8) band joins the WEAKER.

    The n7 band is 0.2 m < 0.35 m min thickness; lower class number (n6) wins,
    so n6 extends over it.
    """
    bands = [[0.0, 1.0, 6], [1.0, 1.2, 7], [1.2, 3.0, 8]]
    merged = _conservative_merge(bands, min_thickness_m=0.35)
    assert merged == [[0.0, 1.2, 6], [1.2, 3.0, 8]]


def test_conservative_merge_keeps_thick_bands():
    bands = [[0.0, 1.0, 6], [1.0, 2.0, 7], [2.0, 3.0, 8]]
    assert _conservative_merge(bands, min_thickness_m=0.35) == bands


def test_weld_same_class_bands():
    bands = [[0.0, 1.0, 6], [1.0, 1.5, 6], [1.5, 3.0, 8]]
    assert _weld_same_class_bands(bands) == [[0.0, 1.5, 6], [1.5, 3.0, 8]]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -k "conservative_merge or weld_same_class" -q`
Expected: FAIL — import error.

- [ ] **Step 3: Write minimal implementation**

```python
def _conservative_merge(
    bands: list[list[float]], min_thickness_m: float
) -> list[list[float]]:
    """Absorb sub-min bands into their LOWER-density (lower NAD class) neighbour.

    Within one soil family the NAD class number is ordered loose->dense /
    weak->firm, so the lower number is the weaker class. Absorbing a thin band
    into the weaker neighbour makes the weaker class claim a threshold-oscillation
    zone — the conservative placement the owner asked for. Mutates a copy.

    Parameters
    ----------
    bands : list[list[float]]
        ``[top_m, base_m, nad_class]`` bands, ordered top-to-bottom, contiguous.
    min_thickness_m : float
        Minimum band thickness; thinner bands are absorbed.

    Returns
    -------
    list[list[float]]
        Bands all >= ``min_thickness_m`` (unless only one remains).
    """
    out = [list(b) for b in bands]
    changed = True
    while changed and len(out) > 1:
        changed = False
        for i, (top, base, _cls) in enumerate(out):
            if (base - top) >= min_thickness_m:
                continue
            prev = out[i - 1] if i > 0 else None
            nxt = out[i + 1] if i < len(out) - 1 else None
            candidates = [c for c in (prev, nxt) if c is not None]
            target = min(candidates, key=lambda c: c[2])  # lowest NAD class wins
            if target is prev:
                out[i - 1][1] = base  # extend prev's base over the thin band
            else:
                out[i + 1][0] = top  # extend next's top over the thin band
            del out[i]
            changed = True
            break
    return out


def _weld_same_class_bands(bands: list[list[float]]) -> list[list[float]]:
    """Weld adjacent bands of equal NAD class into one contiguous band."""
    if not bands:
        return []
    out = [list(bands[0])]
    for top, base, cls in bands[1:]:
        if cls == out[-1][2]:
            out[-1][1] = base
        else:
            out.append([top, base, cls])
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -k "conservative_merge or weld_same_class" -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/geotech_subdivision.py tests/unit/domain/test_geotech_subdivision.py
git commit -m "feat(geotech): add conservative band merge + same-class weld"
```

### Task 4: rewrite `suggest_geotech_subdivision` on the new pipeline

**Files:**
- Modify: `src/groundmodel/domain/services/geotech_subdivision.py`
- Test: `tests/unit/domain/test_geotech_subdivision.py`

- [ ] **Step 1: Write the failing test**

Replace the obsolete weld-only tests added 2026-06-25
(`test_merge_adjacent_same_class_*`, `test_absorbed_middle_band_*`) — delete those
four functions — and add the pipeline tests:

```python
def test_densifying_ramp_recovers_middle_band():
    """matig -> dicht -> zeer-dicht: the dicht band is NOT erased (the core bug).

    qc steps 8 (matig), 12 (dicht), 18 (zeer-dicht) over 1 m each. Expect three
    bands in ascending class, dicht (n7) present.
    """
    depths = [round(0.1 * i, 2) for i in range(31)]  # 0..3 m
    qc = [8.0 if d < 1.0 else (12.0 if d < 2.0 else 18.0) for d in depths]
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(), depth_m=depths, qc_mpa=qc,
        segment_top_m=0.0, segment_base_m=3.0, min_thickness_m=0.35,
        gradient_snap=False,
    )
    assert [s.nad_class for s in splits] == [6, 7, 8]


def test_conservative_holds_weaker_class_through_oscillation():
    """qc oscillating across 15 keeps the WEAKER (dicht) class until it sustains.

    dicht baseline 12, with a sub-min 0.2 m spike to 18, then sustained >=15.
    The spike must NOT create an early zeer-dicht band.
    """
    depths = [round(0.1 * i, 2) for i in range(31)]
    qc = []
    for d in depths:
        if 1.0 <= d < 1.2:
            qc.append(18.0)      # transient spike (<0.35 m) — must be ignored
        elif d >= 2.0:
            qc.append(18.0)      # sustained zeer-dicht
        else:
            qc.append(12.0)      # dicht
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(), depth_m=depths, qc_mpa=qc,
        segment_top_m=0.0, segment_base_m=3.0, min_thickness_m=0.35,
        gradient_snap=False,
    )
    # dicht then zeer-dicht; the zeer-dicht boundary is at the SUSTAINED entry (~2.0 m)
    assert [s.nad_class for s in splits] == [7, 8]
    boundary = splits[0].depth_base_m
    assert abs(boundary - 2.0) <= 0.2


def test_uniform_segment_one_band():
    depths = [round(0.1 * i, 2) for i in range(21)]
    qc = [8.0] * 21
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(), depth_m=depths, qc_mpa=qc,
        segment_top_m=0.0, segment_base_m=2.0, min_thickness_m=0.35,
        gradient_snap=False,
    )
    assert [s.nad_class for s in splits] == [6]
    assert splits[0].depth_top_m == 0.0 and splits[0].depth_base_m == 2.0


def test_no_samples_returns_fallback_band():
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(), depth_m=[], qc_mpa=[],
        segment_top_m=5.0, segment_base_m=10.0, min_thickness_m=0.35,
    )
    assert len(splits) == 1
    assert splits[0].depth_top_m == 5.0 and splits[0].depth_base_m == 10.0
```

Keep the existing `test_mismatched_depths_and_qc_raises`. Delete the old
`test_uniform_qc_yields_single_unit`, `test_band_change_splits_into_two_units`,
`test_min_thickness_merges_thin_spike`, `test_non_monotonic_dense_shallow_loose_deep`,
`test_no_cpt_coverage_returns_fallback_single_unit` (superseded by the above).

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -q`
Expected: FAIL — `suggest_geotech_subdivision` has no `gradient_snap` kwarg / wrong band shape.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `suggest_geotech_subdivision` from the `# --- classify, smooth,
RLE, merge` comment through the final `return splits`, and update the signature.
New signature:

```python
def suggest_geotech_subdivision(
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    depth_m: list[float],
    qc_mpa: list[float],
    segment_top_m: float,
    segment_base_m: float,
    min_thickness_m: float,
    *,
    gradient_snap: bool = True,
    gradient_snap_window_m: float = 0.5,
) -> list[GeotechSplit]:
```

Keep the docstring intro + the length check + the empty-`pairs` fallback exactly as
they are. Replace everything after `seg_qc` is built with:

```python
    from statistics import median

    # 1. Sustained per-threshold crossings -> cut depths (conservative placement).
    cuts = _sustained_threshold_cuts(seg_depths, seg_qc, soil, admixtures, min_thickness_m)

    # 2. Bands between consecutive cuts, each classified by its MEDIAN qc (robust
    #    to spikes without the harmonic over-suppression).
    bands: list[list[float]] = []
    for a, b in zip(cuts, cuts[1:]):
        in_band = [q for d, q in zip(seg_depths, seg_qc) if a <= d < b]
        if not in_band:
            continue
        cls = classify_nad(soil, admixtures, median(in_band))
        bands.append([a, b, cls])
    if not bands:  # degenerate (e.g. single sample) — one band over the segment
        bands = [[segment_top_m, segment_base_m, classify_nad(soil, admixtures, median(seg_qc))]]

    # 3. Conservative min-thickness merge (thin -> weaker neighbour) + 4. weld.
    bands = _weld_same_class_bands(_conservative_merge(bands, min_thickness_m))

    # 5. Optional bounded gradient snap (sharpens real contacts, never less conservative).
    if gradient_snap:
        bands = _gradient_snap(
            bands, seg_depths, seg_qc, gradient_snap_window_m, min_thickness_m
        )

    # Clamp the outer edges to the fixed litho-segment bounds, then emit.
    bands[0][0] = segment_top_m
    bands[-1][1] = segment_base_m
    return [
        GeotechSplit(round(top, 3), round(base, 3), int(cls)) for top, base, cls in bands
    ]
```

For this task, add a TEMPORARY no-op `_gradient_snap` so the pipeline runs (Task 5
replaces it):

```python
def _gradient_snap(bands, depths, qc, window_m, min_thickness_m):  # noqa: D103, ANN001
    return bands
```

Then remove the now-dead `_SMOOTH_HALF_WINDOW` constant, the
`_merge_adjacent_same_class` function, and the `_greedy_merge, _rolling_median_zones,
_run_length_encode` import line.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -q`
Expected: PASS (all pipeline + helper tests green).

- [ ] **Step 5: Verify nothing else imported the removed helper**

Run: `uv run ruff check src/groundmodel/domain/services/geotech_subdivision.py`
Expected: `All checks passed!` (no unused imports). Also:
Run: `grep -rn "_merge_adjacent_same_class\|_SMOOTH_HALF_WINDOW" src tests`
Expected: no matches outside this file's history.

- [ ] **Step 6: Commit**

```bash
git add src/groundmodel/domain/services/geotech_subdivision.py tests/unit/domain/test_geotech_subdivision.py
git commit -m "feat(geotech): conservative per-threshold NAD segmentation pipeline"
```

### Task 5: bounded gradient snap

**Files:**
- Modify: `src/groundmodel/domain/services/geotech_subdivision.py`
- Test: `tests/unit/domain/test_geotech_subdivision.py`

- [ ] **Step 1: Write the failing test**

```python
def test_gradient_snap_sharpens_toward_a_break_when_more_conservative():
    """A densifying boundary snaps DEEPER toward a sharp qc break (more conservative).

    matig (8) then a sharp jump to zeer-dicht (20) at 1.5 m, but the crossing was
    placed at 1.3 m. Snapping deeper to the break (1.5 m) holds matig longer =
    conservative, so it IS applied.
    """
    depths = [round(0.1 * i, 2) for i in range(31)]
    qc = [8.0 if d < 1.5 else 20.0 for d in depths]
    bands = [[0.0, 1.3, 6], [1.3, 3.0, 8]]
    snapped = _gradient_snap(bands, depths, qc, window_m=0.5, min_thickness_m=0.35)
    assert abs(snapped[0][1] - 1.5) <= 0.15  # moved deeper to the break


def test_gradient_snap_refuses_less_conservative_move():
    """A snap that would move a densifying boundary SHALLOWER is rejected."""
    depths = [round(0.1 * i, 2) for i in range(31)]
    qc = [8.0 if d < 1.5 else 20.0 for d in depths]
    bands = [[0.0, 1.7, 6], [1.7, 3.0, 8]]  # boundary already deep
    snapped = _gradient_snap(bands, depths, qc, window_m=0.5, min_thickness_m=0.35)
    assert snapped[0][1] == 1.7  # peak at 1.5 is shallower -> not applied
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -k gradient_snap -q`
Expected: FAIL — the no-op `_gradient_snap` returns bands unchanged.

- [ ] **Step 3: Write the implementation** (replace the no-op)

```python
def _gradient_snap(
    bands: list[list[float]],
    depths: list[float],
    qc: list[float],
    window_m: float,
    min_thickness_m: float,
) -> list[list[float]]:
    """Snap each interior boundary to a nearby sharp |dqc/dz| peak, conservatively.

    A snap is applied only when it does NOT make the boundary less conservative:
    for a densifying boundary (weaker class above, denser below) a snap may move
    the boundary deeper (weaker holds longer) but never shallower; for a softening
    boundary the reverse. Re-runs the conservative merge + weld afterward.

    Parameters
    ----------
    bands : list[list[float]]
        ``[top, base, nad_class]`` bands after Step 4.
    depths, qc : list[float]
        Segment sample series.
    window_m : float
        Max distance a boundary may snap.
    min_thickness_m : float
        Re-applied to keep bands valid after snapping.

    Returns
    -------
    list[list[float]]
        Bands with eligible interior boundaries snapped.
    """
    if len(bands) < 2 or len(depths) < 3:
        return bands
    # |dqc/dz| via central differences on raw qc.
    grad = [0.0] * len(depths)
    for i in range(1, len(depths) - 1):
        dz = depths[i + 1] - depths[i - 1]
        grad[i] = abs((qc[i + 1] - qc[i - 1]) / dz) if dz > 1e-9 else 0.0
    ordered = sorted(g for g in grad if g > 0.0)
    if not ordered:
        return bands
    thr = ordered[int(0.92 * (len(ordered) - 1))]
    peaks = [
        depths[i]
        for i in range(2, len(grad) - 2)
        if grad[i] > thr and grad[i] >= grad[i - 1] and grad[i] >= grad[i + 1]
    ]
    for k in range(len(bands) - 1):
        d = bands[k][1]  # boundary between band k (above) and k+1 (below)
        densifying = bands[k + 1][2] > bands[k][2]
        near = [p for p in peaks if abs(p - d) <= window_m]
        if not near:
            continue
        peak = min(near, key=lambda p: abs(p - d))
        more_conservative = (peak > d) if densifying else (peak < d)
        if more_conservative:
            bands[k][1] = peak
            bands[k + 1][0] = peak
    return _weld_same_class_bands(_conservative_merge(bands, min_thickness_m))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_geotech_subdivision.py -q`
Expected: PASS (whole file green).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/geotech_subdivision.py tests/unit/domain/test_geotech_subdivision.py
git commit -m "feat(geotech): add bounded conservative gradient snap"
```

### Task 6: real-data acceptance (the arbiter)

**Files:**
- Create: `scripts/eval_geotech_nad_segmentation.py`

This guards the spec §2 anchor against the real CPT. It reuses the qc dump the
brainstorm produced (`scripts/throwaway_geotech_qc.json`); if absent, it prints the
one-line psql command to regenerate it and exits.

- [ ] **Step 1: Write the eval script**

```python
"""Real-data acceptance: GEO-22/115-S10 deep sand must segment matig/dicht/zeer-dicht.

Reads scripts/throwaway_geotech_qc.json (qc dump of the CPT) and runs the production
suggest_geotech_subdivision over the deep sand litho segment (12.57-16.97 m, ZAND).
Asserts the spec anchor: n6 12.57-14.37 / n7 14.37-15.10 / n8 15.10-16.97 (+-0.1 m).

Run: uv run python scripts/eval_geotech_nad_segmentation.py
Regenerate the qc dump (dev DB) if missing:
  docker exec strix-db-1 psql -U groundmodel -d groundmodel -t -A -c \\
    "SELECT json_build_object('depths',depths_m,'qc',qc_mpa) FROM cpt_series \\
     WHERE cpt_id='019e932e-7c4a-75e4-bc8c-59ce4ba1231c';" > scripts/throwaway_geotech_qc.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from groundmodel.domain.services.geotech_subdivision import suggest_geotech_subdivision

_QC = _ROOT / "scripts" / "throwaway_geotech_qc.json"
_EXPECTED = [(12.57, 14.37, 6), (14.37, 15.10, 7), (15.10, 16.97, 8)]
_TOL = 0.1


def main() -> int:
    if not _QC.exists():
        print(f"MISSING {_QC} — see the regenerate command in this file's docstring.")
        return 2
    data = json.loads(_QC.read_text())
    splits = suggest_geotech_subdivision(
        soil="ZAND", admixtures=(),
        depth_m=data["depths"], qc_mpa=data["qc"],
        segment_top_m=12.57, segment_base_m=16.97, min_thickness_m=0.35,
    )
    got = [(s.depth_top_m, s.depth_base_m, s.nad_class) for s in splits]
    print("GEO-22/115-S10 deep sand bands:")
    for t, b, c in got:
        print(f"  {t:.2f}-{b:.2f}  n{c}")
    ok = len(got) == len(_EXPECTED) and all(
        gc == ec and abs(gt - et) <= _TOL and abs(gb - eb) <= _TOL
        for (gt, gb, gc), (et, eb, ec) in zip(got, _EXPECTED)
    )
    print("\nACCEPTANCE:", "PASS" if ok else "FAIL (expected " + str(_EXPECTED) + ")")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run it**

Run: `uv run python scripts/eval_geotech_nad_segmentation.py`
Expected: prints the three bands and `ACCEPTANCE: PASS`. (If the qc dump is missing,
regenerate it with the command in the docstring, then re-run.)

- [ ] **Step 3: Commit**

```bash
git add scripts/eval_geotech_nad_segmentation.py
git commit -m "test(geotech): real-data acceptance for NAD segmentation (GEO-22/115-S10)"
```

---

## Phase B — Use-case wiring

### Task 7: `SubdivideAllBodies` reads + passes the gradient-snap knobs

**Files:**
- Modify: `src/groundmodel/application/subdivide_all_bodies.py`

- [ ] **Step 1: Add the read helper**

After `_read_min_thickness_m` (ends ~line 1636), add:

```python
    async def _read_gradient_snap(self, project_id: UUID) -> tuple[bool, float]:
        """Read the geotech gradient-snap knobs from the project view-state.

        Returns ``(enabled, window_m)`` from
        ``view_state["geotech_subdivision"]``, defaulting to ``(True, 0.5)`` when
        absent or malformed.
        """
        project = await ProjectRepository(self._session).get_by_id(project_id)
        seg = ((project.view_state if project is not None else None) or {}).get(
            "geotech_subdivision"
        ) or {}
        enabled = seg.get("gradient_snap_enabled", True)
        try:
            window = float(seg.get("gradient_snap_window_m", 0.5))
        except (TypeError, ValueError):
            window = 0.5
        return (bool(enabled), window if window > 0 else 0.5)
```

- [ ] **Step 2: Read the knobs in `execute` and pass them through**

After line 437 (`min_thickness_m = await self._read_min_thickness_m(...)`), add:

```python
        gradient_snap, gradient_snap_window_m = await self._read_gradient_snap(
            geotech_model.app_project_id
        )
```

In the `suggest_geotech_subdivision(...)` call (~line 502), add the two kwargs after
`min_thickness_m=min_thickness_m,`:

```python
                    gradient_snap=gradient_snap,
                    gradient_snap_window_m=gradient_snap_window_m,
```

- [ ] **Step 3: Verify the integration suite still passes**

Run: `.\scripts\run-integration-tests.ps1 tests/integration -k subdivide`
Expected: the SubdivideAllBodies integration tests pass (the knobs default to the
prior behaviour shape; band depths may shift — if an assertion pins exact depths,
update it to the new conservative output and note why).

- [ ] **Step 4: Commit**

```bash
git add src/groundmodel/application/subdivide_all_bodies.py
git commit -m "feat(geotech): wire gradient-snap knobs through SubdivideAllBodies"
```

---

## Phase C — Settings UI

### Task 8: `geotechSubdivisionPrefs.ts`

**Files:**
- Create: `desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts`
- Test: `desktop/src/renderer/src/utils/geotechSubdivisionPrefs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import {
  GEOTECH_SUBDIVISION_DEFAULTS,
  buildGeotechSubdivisionPatch,
  readGeotechSubdivisionPrefs,
} from './geotechSubdivisionPrefs'

describe('geotechSubdivisionPrefs', () => {
  it('returns defaults for missing view_state', () => {
    expect(readGeotechSubdivisionPrefs(null)).toEqual(GEOTECH_SUBDIVISION_DEFAULTS)
  })

  it('reads persisted values', () => {
    const vs = {
      geotech_subdivision: {
        minimum_layer_thickness_m: 0.5,
        gradient_snap_enabled: false,
        gradient_snap_window_m: 0.8,
      },
    }
    const p = readGeotechSubdivisionPrefs(vs)
    expect(p.minimumLayerThicknessM).toBe(0.5)
    expect(p.gradientSnapEnabled).toBe(false)
    expect(p.gradientSnapWindowM).toBe(0.8)
  })

  it('clamps out-of-range thickness to default', () => {
    const vs = { geotech_subdivision: { minimum_layer_thickness_m: 99 } }
    expect(readGeotechSubdivisionPrefs(vs).minimumLayerThicknessM).toBe(
      GEOTECH_SUBDIVISION_DEFAULTS.minimumLayerThicknessM,
    )
  })

  it('round-trips through the patch builder', () => {
    const prefs = {
      minimumLayerThicknessM: 0.4,
      gradientSnapEnabled: false,
      gradientSnapWindowM: 0.3,
    }
    expect(readGeotechSubdivisionPrefs(buildGeotechSubdivisionPatch(prefs))).toEqual(prefs)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `desktop/`): `npx vitest run src/renderer/src/utils/geotechSubdivisionPrefs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// Per-project preferences for the geotech NAD subdivision ("Subdivide all
// bodies"). Persists in ``project.view_state.geotech_subdivision`` — SEPARATE
// from the litho ``litho_segmenter`` bag so tuning packing never moves
// lithology. Same best-effort read pattern as lithoSegmenterPrefs.ts.

export interface GeotechSubdivisionPrefs {
  /** Thinnest NAD packing band kept; also the persistence a qc change must hold
   *  to move a boundary. Range 0.1–3.0 m. Default 0.35. */
  minimumLayerThicknessM: number
  /** Snap a boundary to a nearby sharp qc break (never less conservative). */
  gradientSnapEnabled: boolean
  /** Max distance a boundary may snap. Range 0.1–2.0 m. Default 0.5. */
  gradientSnapWindowM: number
}

export const GEOTECH_SUBDIVISION_DEFAULTS: GeotechSubdivisionPrefs = {
  minimumLayerThicknessM: 0.35,
  gradientSnapEnabled: true,
  gradientSnapWindowM: 0.5,
}

export const GEOTECH_SUBDIVISION_BOUNDS = {
  minimumLayerThicknessM: { min: 0.1, max: 3.0 },
  gradientSnapWindowM: { min: 0.1, max: 2.0 },
} as const

const VIEW_STATE_KEY = 'geotech_subdivision'

function readBounded(v: unknown, b: { min: number; max: number }, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max ? v : fallback
}

export function readGeotechSubdivisionPrefs(
  viewState: Record<string, unknown> | null | undefined,
): GeotechSubdivisionPrefs {
  const raw =
    viewState && typeof viewState === 'object'
      ? (viewState as Record<string, unknown>)[VIEW_STATE_KEY]
      : null
  if (!raw || typeof raw !== 'object') return { ...GEOTECH_SUBDIVISION_DEFAULTS }
  const d = raw as Record<string, unknown>
  return {
    minimumLayerThicknessM: readBounded(
      d.minimum_layer_thickness_m,
      GEOTECH_SUBDIVISION_BOUNDS.minimumLayerThicknessM,
      GEOTECH_SUBDIVISION_DEFAULTS.minimumLayerThicknessM,
    ),
    gradientSnapEnabled:
      typeof d.gradient_snap_enabled === 'boolean'
        ? d.gradient_snap_enabled
        : GEOTECH_SUBDIVISION_DEFAULTS.gradientSnapEnabled,
    gradientSnapWindowM: readBounded(
      d.gradient_snap_window_m,
      GEOTECH_SUBDIVISION_BOUNDS.gradientSnapWindowM,
      GEOTECH_SUBDIVISION_DEFAULTS.gradientSnapWindowM,
    ),
  }
}

export function buildGeotechSubdivisionPatch(
  prefs: GeotechSubdivisionPrefs,
): Record<string, unknown> {
  return {
    [VIEW_STATE_KEY]: {
      minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
      gradient_snap_enabled: prefs.gradientSnapEnabled,
      gradient_snap_window_m: prefs.gradientSnapWindowM,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/utils/geotechSubdivisionPrefs.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts desktop/src/renderer/src/utils/geotechSubdivisionPrefs.test.ts
git commit -m "feat(geotech): geotech-subdivision view-state prefs util"
```

### Task 9: Settings dialog "Geotechnical" section + App wiring

**Files:**
- Modify: `desktop/src/renderer/src/components/SettingsDialog.tsx`
- Modify: `desktop/src/renderer/src/App.tsx`

The dialog already keeps per-section draft state, a `SECTIONS` rail, per-section
`NumberRow`/`CheckboxRow` controls, and a per-section Save button (see the existing
`litho` section, ~lines 33–340). Mirror it.

- [ ] **Step 1: Extend SettingsDialog**

In `SettingsDialog.tsx`:
1. Add the import:
   ```typescript
   import {
     GEOTECH_SUBDIVISION_BOUNDS,
     GEOTECH_SUBDIVISION_DEFAULTS,
     type GeotechSubdivisionPrefs,
   } from '../utils/geotechSubdivisionPrefs'
   ```
2. Extend the `SectionKey` union and `SECTIONS` array with a `geotech` entry:
   ```typescript
   type SectionKey = 'litho' | 'geotech' | 'sections' | 'appearance'
   ```
   ```typescript
   { key: 'geotech', label: 'Geotechnical', icon: <SlidersHorizontal size={13} />, scope: 'project' },
   ```
3. Add two props to `Props`:
   ```typescript
   initialGeotechSubdivision: GeotechSubdivisionPrefs
   onSubmitGeotechSubdivision: (next: GeotechSubdivisionPrefs) => void
   ```
   and accept them in the function signature.
4. Add draft state next to `lithoDraft`:
   ```typescript
   const [geotechDraft, setGeotechDraft] = useState<GeotechSubdivisionPrefs>(initialGeotechSubdivision)
   ```
   and reset it in the existing `useEffect(... [open])` block that resets the other drafts (mirror the `setLithoDraft(initialLithoSegmenter)` line).
5. Add the `geotech` panel body — render when `active === 'geotech'`, mirroring the
   litho panel: a `NumberRow` for **Min layer thickness (m)** (bounds
   `GEOTECH_SUBDIVISION_BOUNDS.minimumLayerThicknessM`, step 0.05, default
   `GEOTECH_SUBDIVISION_DEFAULTS.minimumLayerThicknessM`, hint: "The thinnest NAD
   packing band kept; also the persistence a qc change must hold to move a boundary
   (ignores thinner dips/spikes)."), a `CheckboxRow` for **Gradient snap**
   (`geotechDraft.gradientSnapEnabled`, hint: "Snap a boundary to a nearby sharp qc
   break for precision; never moves it to a less-conservative depth."), and — shown
   only when `geotechDraft.gradientSnapEnabled` — a `NumberRow` for **Gradient snap
   window (m)** (bounds `GEOTECH_SUBDIVISION_BOUNDS.gradientSnapWindowM`, step 0.05).
   Add a Save button calling `onSubmitGeotechSubdivision(geotechDraft)`, mirroring
   the litho section's Save.

- [ ] **Step 2: Wire it in App.tsx**

In `App.tsx`:
1. Add to the existing prefs imports:
   ```typescript
   import {
     buildGeotechSubdivisionPatch,
     readGeotechSubdivisionPrefs,
   } from './utils/geotechSubdivisionPrefs'
   ```
2. Next to `handleSettingsLithoSegmenterSubmit` (~line 918), add:
   ```typescript
   const handleSettingsGeotechSubdivisionSubmit = (
     next: import('./utils/geotechSubdivisionPrefs').GeotechSubdivisionPrefs,
   ): void => {
     void applyViewStatePatch(buildGeotechSubdivisionPatch(next))
   }
   ```
3. At BOTH `<SettingsDialog ... />` render sites (~lines 1042 and 1103), add the two
   props mirroring `initialLithoSegmenter`/`onSubmitLithoSegmenter`:
   ```tsx
   initialGeotechSubdivision={readGeotechSubdivisionPrefs(project?.view_state)}
   onSubmitGeotechSubdivision={handleSettingsGeotechSubdivisionSubmit}
   ```
   (Use the same `project?.view_state` expression the litho prop uses at each site.)

- [ ] **Step 3: Typecheck + run the desktop suite**

Run (from `desktop/`):
```
npx tsc --noEmit -p tsconfig.web.json
npx vitest run src/renderer/src/components/SettingsDialog
```
Expected: tsc clean; SettingsDialog tests pass (add a render assertion that the
"Geotechnical" rail entry exists and shows the three controls if the existing test
file enumerates sections).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/src/components/SettingsDialog.tsx desktop/src/renderer/src/App.tsx
git commit -m "feat(geotech): Geotechnical settings section (min thickness + gradient snap)"
```

---

## Final verification

- [ ] `uv run pytest tests/unit/domain/test_geotech_subdivision.py -q` — all green.
- [ ] `uv run python scripts/eval_geotech_nad_segmentation.py` — `ACCEPTANCE: PASS`.
- [ ] Re-materialise the dev DB model and eyeball it (meta-rule): `uv run python scripts/eval_geotech_subdivision.py`, then dogfeed the geotech section — the deep sand of GEO-22/115-S10 shows matig/dicht/zeer-dicht, the klei 8.30 m over-split is gone, and the Settings → Geotechnical knobs change the output on a re-run.
- [ ] `uv run ruff check src tests` + `npx tsc --noEmit -p tsconfig.web.json` clean.
- [ ] Clean up the brainstorm throwaways (`scripts/throwaway_geotech_*.py`, `scripts/throwaway_geotech_qc.json`) once the eval script + dev-DB rematerialisation confirm the feature — the eval script is the keeper.

## Notes / out of scope (from the spec)
- Raw-vs-normalised (Qtn) classification toggle — separate follow-up slice.
- Auto-correlating adjacent CPTs with the same packing sequence; manual NAD-boundary editing — separate roadmap items.
- No litho-segmenter, partition-fill, or 3D-builder changes.
