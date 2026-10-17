"""CPT interpretation benchmarks.

Run with: uv run pytest tests/benchmarks/ --benchmark-enable -v
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.cpt_interpretation import (
    calculate_ic,
    calculate_ic_series,
    classify_soil_ic,
)

# ---------------------------------------------------------------------------
# Deterministic series helpers
# ---------------------------------------------------------------------------


def _make_series(n: int) -> tuple[list[float], list[float], list[float]]:
    """Generate depth/qc/fs series that produce valid Ic values throughout."""
    depths = [i * 0.02 for i in range(1, n + 1)]
    # Cycle qc 2–20 MPa and fs proportionally — avoids all-None Ic output.
    qc = [2.0 + (i % 90) * 0.2 for i in range(n)]
    fs = [max(0.001, q * 0.01) for q in qc]
    return depths, qc, fs


# Pre-build series once — construction cost excluded from timing.
_D100, _QC100, _FS100 = _make_series(100)
_D1K, _QC1K, _FS1K = _make_series(1_000)
_D10K, _QC10K, _FS10K = _make_series(10_000)
_D100K, _QC100K, _FS100K = _make_series(100_000)

# ---------------------------------------------------------------------------
# Single-point baselines
# ---------------------------------------------------------------------------


def test_bench_calculate_ic_single(benchmark: pytest.fixture) -> None:
    """Cost of one Ic calculation (inner loop body)."""
    result = benchmark(calculate_ic, 100.0, 1.0)
    assert result > 0


def test_bench_classify_soil_ic_single(benchmark: pytest.fixture) -> None:
    """Cost of one SBT zone lookup."""
    result = benchmark(classify_soil_ic, 2.3)
    assert result


# ---------------------------------------------------------------------------
# Series benchmarks — identifies when Python loop becomes the bottleneck
# ---------------------------------------------------------------------------


def test_bench_ic_series_100(benchmark: pytest.fixture) -> None:
    """100 points — very short CPT or shallow investigation."""
    result = benchmark(calculate_ic_series, _D100, _QC100, _FS100)
    assert len(result) == 100


def test_bench_ic_series_1k(benchmark: pytest.fixture) -> None:
    """1 000 points — typical 20 m Belgian CPT at 0.02 m increment."""
    result = benchmark(calculate_ic_series, _D1K, _QC1K, _FS1K)
    assert len(result) == 1_000


def test_bench_ic_series_10k(benchmark: pytest.fixture) -> None:
    """10 000 points — deep CPT or 10 CPTs batched."""
    result = benchmark(calculate_ic_series, _D10K, _QC10K, _FS10K)
    assert len(result) == 10_000


def test_bench_ic_series_100k(benchmark: pytest.fixture) -> None:
    """100 000 points — large project batch; Rust candidate if > ~200 ms."""
    result = benchmark(calculate_ic_series, _D100K, _QC100K, _FS100K)
    assert len(result) == 100_000
