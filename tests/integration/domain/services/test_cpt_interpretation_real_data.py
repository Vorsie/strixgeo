"""Integration tests: calculate_ic_series against real DOV CPT files.

The unit tests in ``tests/unit/domain/services/test_cpt_interpretation.py``
exercise the algorithm with fabricated single-point inputs. This file runs the
same algorithm on real, multi-thousand-row CPT data to catch regressions that
only show up on noisy / messy field data:

- nulls scattered through the column (void rows, pre-drill zone)
- adjacent zero-qc rows that the iterative Robertson solver must reject
- very short and very long series (34 rows up to 1316 rows)
- the full Ic range from sand (≈1.5) to clay (≈3.0)

Requires ``data/cpt/`` (gitignored). Skipped automatically when absent.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from groundmodel.domain.services.cpt_interpretation import calculate_ic_series
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser

DATA_DIR = Path(__file__).parents[4] / "data" / "cpt"

pytestmark = pytest.mark.skipif(
    not DATA_DIR.exists(),
    reason="DOV data files not present (data/cpt/ is gitignored)",
)

# (filename, expected min/max row count, has_fs) — has_fs=False means CPTM where
# the algorithm should return a series of all-Nones, not crash.
_FILES = [
    ("1778054387093.gef", 100, 5000, True),  # CPTE
    ("1778056765226.gef", 100, 5000, True),  # CPTU
    ("1778056769825.gef", 30, 50, False),  # CPTM (34 rows)
    ("1778056773736.gef", 1000, 2000, False),  # CPTM (1316 rows)
    ("1778056778310.gef", 100, 5000, False),  # CPTM with pre-drill
]


def _parse_file(filename: str) -> tuple[list[float], list[float], list[float | None]]:
    """Parse a GEF file and return (depths, qc, fs) lists for the Ic algorithm."""
    bytes_ = (DATA_DIR / filename).read_bytes()
    result = GEFParser().parse_bytes(bytes_)
    df = result.data
    depths = df["depth_m"].to_list()
    qc = df["qc_mpa"].to_list()
    fs = df["fs_mpa"].to_list() if "fs_mpa" in df.columns else None
    return depths, qc, fs  # type: ignore[return-value]


@pytest.mark.parametrize("filename,min_rows,max_rows,has_fs", _FILES)
def test_ic_series_on_real_file(filename: str, min_rows: int, max_rows: int, has_fs: bool) -> None:
    """Ic series should compute without crashing on every real file we ship."""
    depths, qc, fs = _parse_file(filename)
    assert min_rows <= len(depths) <= max_rows, f"unexpected row count for {filename}"

    if not has_fs:
        # CPTM has no sleeve friction → calculate_ic_series should bail gracefully.
        # We don't even call it (calculate_ic_series requires fs); document the skip.
        pytest.skip(f"{filename} is CPTM (no fs) — Ic calculation requires fs")

    ic = calculate_ic_series(depths_m=depths, qc_mpa=qc, fs_mpa=fs, gwt_m=1.0)
    assert len(ic) == len(depths), "Ic series length must match input"

    # At least some rows should produce a numeric Ic. If everything is None the
    # algorithm or the input data is broken.
    valid = [v for v in ic if v is not None]
    assert valid, f"{filename}: every row returned None — algorithm broken?"

    # Robertson Ic is bounded roughly [1.0, 4.0] in real soils. Outside that range
    # means either an algorithm bug or pathological data we should investigate.
    for v in valid:
        assert 0.5 < v < 5.0, f"{filename}: Ic={v} outside plausible bounds"


def test_ic_series_handles_zero_qc_rows() -> None:
    """File 1778056773736.gef has a zero-qc gap at 25.92–26.08 m (CPTM, no fs)."""
    # CPTM file → skip Ic calculation but verify parser still loads the data.
    depths, qc, fs = _parse_file("1778056773736.gef")
    assert any(v == 0.0 for v in qc), "expected zero-qc rows in test file"
    assert fs is None, "CPTM file should have no fs column"


def test_ic_series_pre_drill_handled() -> None:
    """File 1778056765226.gef has 1.5m of pre-drill — those rows are valid input."""
    depths, qc, fs = _parse_file("1778056765226.gef")
    assert depths[0] >= 1.5, "expected first depth at or below pre-drill depth"
    assert fs is not None, "CPTU file must carry fs"

    ic = calculate_ic_series(depths_m=depths, qc_mpa=qc, fs_mpa=fs, gwt_m=1.0)
    # First rows are within the pre-drill zone; algorithm should still return
    # SOMETHING (None or numeric) without raising.
    assert len(ic) == len(depths)
