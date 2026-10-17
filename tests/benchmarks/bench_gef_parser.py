"""GEF parser benchmarks — run with: uv run pytest tests/benchmarks/ --benchmark-enable -v"""

from __future__ import annotations

from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser

# ---------------------------------------------------------------------------
# Synthetic GEF helpers
# ---------------------------------------------------------------------------

_HEADER = (
    "#TESTID= CPT-BENCH\n"
    "#XYID= 32000, 200000.0, 100000.0\n"
    "#ZID= 32001, 5.0\n"
    "#MEASUREMENTVAR= 3, 0.80\n"
    "#COLUMN= 3\n"
    "#COLUMNINFO= 1, m, depth, 1\n"
    "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
    "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
    "#EOH=\n"
)


def _make_gef(n_rows: int) -> bytes:
    """Generate a valid CPTE GEF file with n_rows depth points."""
    rows = "\n".join(
        f"{i * 0.02:.3f}; {max(0.5, 15.0 - (i % 500) * 0.01):.4f}; 0.1500"
        for i in range(1, n_rows + 1)
    )
    return (_HEADER + rows + "\n").encode()


# Pre-build synthetic payloads once — construction cost excluded from timing.
_GEF_100 = _make_gef(100)
_GEF_1K = _make_gef(1_000)
_GEF_10K = _make_gef(10_000)
_GEF_100K = _make_gef(100_000)

# ---------------------------------------------------------------------------
# Synthetic benchmarks
# ---------------------------------------------------------------------------


def test_bench_parse_100_rows(benchmark: pytest.fixture) -> None:
    """Baseline: tiny CPT (100 rows)."""
    parser = GEFParser()
    result = benchmark(parser.parse_bytes, _GEF_100)
    assert len(result.data) == 100


def test_bench_parse_1k_rows(benchmark: pytest.fixture) -> None:
    """Typical Belgian CPT depth (~20 m at 0.02 m increment = 1 000 rows)."""
    parser = GEFParser()
    result = benchmark(parser.parse_bytes, _GEF_1K)
    assert len(result.data) == 1_000


def test_bench_parse_10k_rows(benchmark: pytest.fixture) -> None:
    """Deep or high-resolution CPT (10 000 rows)."""
    parser = GEFParser()
    result = benchmark(parser.parse_bytes, _GEF_10K)
    assert len(result.data) == 10_000


def test_bench_parse_100k_rows(benchmark: pytest.fixture) -> None:
    """Stress test: 100 000 rows — flag if > ~500 ms (Rust candidate)."""
    parser = GEFParser()
    result = benchmark(parser.parse_bytes, _GEF_100K)
    assert len(result.data) == 100_000


# ---------------------------------------------------------------------------
# Real-file benchmarks (skipped when data/cpt/ is absent or empty)
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).parents[2] / "data" / "cpt"
_REAL_FILES = sorted(_DATA_DIR.glob("*.gef")) if _DATA_DIR.exists() else []


@pytest.mark.skipif(not _REAL_FILES, reason="no real GEF files in data/cpt/")
def test_bench_parse_real_files(benchmark: pytest.fixture) -> None:
    """Parse all GEF files in data/cpt/ — measures realistic workload."""
    parser = GEFParser()
    payloads = [f.read_bytes() for f in _REAL_FILES]

    def parse_all() -> list:
        return [parser.parse_bytes(p) for p in payloads]

    results = benchmark(parse_all)
    assert len(results) == len(_REAL_FILES)
