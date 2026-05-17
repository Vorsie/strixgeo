"""Lithostratigraphic CPT-segmenter performance benchmarks (#55).

Run with::

    uv run pytest tests/benchmarks/bench_litho_segmentation.py --benchmark-enable -v

The litho segmenter is the one genuinely CPU-bound per-element surface
the litho feature added — it runs the Robertson-2015 iterative
stress-normalisation (a per-depth-point convergence loop), then a
rolling-median smooth + run-length-encode + greedy thin-run merge over
the whole series. Per the CLAUDE.md "when to add a benchmark" rule
(CPU-bound per-row interpretation service / batch transform) it gets a
bench. A *bigger project* is the stress: a 500-CPT DOV import segments
500 series; per-call cost × 500 is what the user feels when they hit
"Suggest litho" across a corridor.

CPT series are ~2 cm sampled, so:

* small  — 1 000 rows  (~20 m CPT — the common case).
* medium — 10 000 rows (~200 m, or a dense over-sampled log).
* large  — 50 000 rows (stress upper bound; shape, not realism).

Two benches: the full ``segment_cpt`` pipeline, and the isolated
``qtn_f_ic_series`` iterative core (the per-point n-convergence loop —
the only Numba/Rust-shaped hot path if profiling ever flags one;
see CLAUDE.md "Performance Escape Hatches").

Baseline numbers land in CLAUDE.local.md after a stable run.
"""

from __future__ import annotations

import math

import pytest

from groundmodel.domain.services.litho_segmentation import segment_cpt
from groundmodel.domain.services.robertson_2015 import (
    qtn_f_ic_series,
    sbt_zone_series,
    stress_profile,
)


def _synthetic_cpt(n: int) -> tuple[list[float], list[float], list[float | None]]:
    """Build an ``n``-row CPT (2 cm increment) with alternating
    sand/clay bands so the classifier + smoother + merge all do real
    work — a single-zone series would under-measure the merge/RLE
    cost. qc/fs vary smoothly within each ~2 m band.
    """
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float | None] = []
    for i in range(n):
        d = i * 0.02
        band = int(d // 2.0)  # flip lithology every 2 m
        if band % 2 == 0:  # dense-ish sand
            base_qc = 18.0 + 4.0 * math.sin(d * 0.7)
            base_fs = 0.09
        else:  # soft clay
            base_qc = 0.8 + 0.3 * math.sin(d * 1.1)
            base_fs = 0.045
        depths.append(round(d, 2))
        qc.append(max(0.1, base_qc))
        fs.append(base_fs)
    return depths, qc, fs


@pytest.mark.parametrize(
    "size",
    [1_000, 10_000, 50_000],
    ids=["small-1k", "medium-10k", "large-50k"],
)
def test_bench_segment_cpt(benchmark, size: int) -> None:
    """Full pipeline: Robertson-2015 classify → median-smooth → RLE →
    greedy min-thickness merge → per-layer Dr/NAD. Target: well under
    a second even at 50k so an "accept across the corridor" sweep of
    many CPTs stays interactive (segment is per-investigation; the UI
    fires it on demand, not per render frame).
    """
    depths, qc, fs = _synthetic_cpt(size)
    layers = benchmark(
        segment_cpt,
        depths,
        qc,
        fs,
        10.0,  # niveau_m
        8.0,  # yw_m
        0.5,  # minimum_layer_thickness_m
    )
    # Sanity: alternating 2 m bands over a deep series → many layers.
    assert len(layers) >= 2


@pytest.mark.parametrize(
    "size",
    [1_000, 10_000, 50_000],
    ids=["small-1k", "medium-10k", "large-50k"],
)
def test_bench_qtn_f_ic_core(benchmark, size: int) -> None:
    """Isolated Robertson-2015 iterative core (stress profile + the
    per-point n-convergence while-loop + 2009 chart-zone attribution).
    This is the hottest inner path and the only escape-hatch candidate
    if a Phase-5 bigger-project profile ever flags the segmenter.
    """
    depths, qc, fs = _synthetic_cpt(size)
    stress = stress_profile(depths, qc, fs, 10.0, 8.0)

    def _core() -> list[int | None]:
        return sbt_zone_series(qtn_f_ic_series(depths, qc, fs, stress))

    zones = benchmark(_core)
    assert len(zones) == size
