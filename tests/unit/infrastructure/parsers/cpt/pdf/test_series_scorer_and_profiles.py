"""Scoring against a GEF and choosing the per-company layout profile.

Score: RMS and max error on a common depth grid, plus the depth offset that
minimises the error ("a systematic offset means the depth calibration is off").
Profiles: "every company's report will be slightly different" -> a registry
keyed by a fingerprint in the text layer, with a generic fallback.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_registry import (
    LayoutProfileRegistry,
)
from groundmodel.infrastructure.parsers.cpt.pdf.series_scorer import SeriesScorer


def _series(shift_m: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    depth = np.arange(0.02, 20.0, 0.02)
    return depth + shift_m, 5.0 + 3.0 * np.sin(depth * 1.7) + np.sin(depth * 5.3)


def test_identical_series_score_zero_error_at_zero_offset() -> None:
    """Identical series score zero error at zero offset."""
    d, v = _series()
    score = SeriesScorer().score(d, v, d, v)
    assert score.rms == pytest.approx(0.0, abs=1e-9)
    assert score.best_offset_m == pytest.approx(0.0, abs=1e-9)


def test_a_depth_shift_shows_as_the_best_offset_with_the_error_gone() -> None:
    """A depth shift shows as the best offset with the error gone."""
    ref_d, ref_v = _series()
    test_d, test_v = _series(shift_m=0.10)  # digitised reads 10 cm too deep
    score = SeriesScorer().score(ref_d, ref_v, test_d, test_v)
    assert score.rms > 0.3
    assert score.best_offset_m == pytest.approx(-0.10, abs=0.011)
    assert score.rms_at_best_offset < 0.05


def test_points_flagged_excluded_do_not_count() -> None:
    """Points flagged excluded do not count."""
    d, v = _series()
    bad = v.copy()
    bad[100:120] = 99.0
    mask = np.zeros_like(v, dtype=bool)
    mask[100:120] = True
    score = SeriesScorer().score(d, v, d, bad, exclude=mask)
    assert score.max_abs < 1e-9


@pytest.mark.parametrize(
    ("text", "name"),
    [
        ("Van der Straaten Geotechniek B.V.  Telefoon (0031) 113-382510", "van-der-straaten"),
        ("DATABANK ONDERGROND VLAANDEREN  21/08/23  p.1", "dov"),
        ("Some other Sondeerbedrijf NV", "generic"),
    ],
)
def test_the_registry_picks_the_profile_from_the_text_layer(text: str, name: str) -> None:
    """The registry picks the profile from the text layer."""
    assert LayoutProfileRegistry.default().match(text).name == name
