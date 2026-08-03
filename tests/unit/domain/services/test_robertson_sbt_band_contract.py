"""The backend's Ic bands match the cross-boundary Robertson contract.

Audit 2026-08-02, Class 4 ("one domain rule with two implementations that
drift").  The renderer and the backend both classify Ic, and they disagreed:
the Parameters chart labelled every band one step too coarse while
``classify_soil_ic`` carried the very same shift plus a phantom "Sensitive
fine-grained" class above Ic 3.60.  The parity test that existed compared the
renderer's table with a renderer function that iterates the same table — one
table agreeing with itself, structurally incapable of going red.

The fix is an arbiter neither side owns:
``tests/fixtures/contracts/robertson_sbt_bands.json``.  This module checks the
backend against it; ``CptIcSbtChart.sbtParity.test.tsx`` checks the renderer
against the same file.  A breakpoint or a label may only move by moving it
there first, which turns both suites red at once.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from groundmodel.domain.services.cpt_interpretation import classify_soil_ic
from groundmodel.domain.services.robertson_sbt_non_normalised import i_sbt_to_zone

# tests/unit/domain/services/ -> tests/
_CONTRACT_PATH = (
    Path(__file__).resolve().parents[3] / "fixtures" / "contracts" / "robertson_sbt_bands.json"
)


def _bands() -> list[dict[str, Any]]:
    """Load the contract's band list.

    Returns
    -------
    list[dict[str, Any]]
        One dict per band, ascending in Ic.
    """
    with _CONTRACT_PATH.open(encoding="utf-8") as handle:
        return list(json.load(handle)["bands"])


def _sample_points(band: dict[str, Any]) -> list[float]:
    """Ic values that must land inside ``band``.

    Bands are half-open ``[ic_min, ic_max)``, so the lower breakpoint itself is
    part of the band and the upper one is not — the midpoint alone would miss
    an off-by-one at either edge.

    Parameters
    ----------
    band : dict[str, Any]
        One entry of the contract's ``bands`` list.

    Returns
    -------
    list[float]
        The band's lower breakpoint, its midpoint, and a value just under its
        upper breakpoint (or a point well above it for the unbounded band).
    """
    low = float(band["ic_min"])
    if band["ic_max"] is None:
        return [low, low + 0.2, low + 1.0]
    high = float(band["ic_max"])
    return [low, (low + high) / 2.0, high - 0.001]


BANDS = _bands()


def test_contract_file_is_present_and_ordered() -> None:
    """The arbiter exists, is contiguous, and has no gaps between bands."""
    assert BANDS, f"no bands in {_CONTRACT_PATH}"
    for lower, upper in zip(BANDS, BANDS[1:]):
        assert lower["ic_max"] == upper["ic_min"], (
            f"gap between the {lower['renderer_label']} and {upper['renderer_label']} bands"
        )
    assert BANDS[-1]["ic_max"] is None, "the top band must be unbounded — Ic has no ceiling"


@pytest.mark.parametrize("band", BANDS, ids=[str(b["renderer_label"]) for b in BANDS])
def test_zone_mapping_matches_the_contract(band: dict[str, Any]) -> None:
    """``i_sbt_to_zone`` puts every point of a band in that band's SBT zone."""
    for ic in _sample_points(band):
        assert i_sbt_to_zone(ic) == band["zone"], (
            f"Ic {ic} should be zone {band['zone']} ({band['renderer_label']})"
        )


@pytest.mark.parametrize("band", BANDS, ids=[str(b["renderer_label"]) for b in BANDS])
def test_classifier_label_matches_the_contract(band: dict[str, Any]) -> None:
    """``classify_soil_ic`` names every point of a band with that band's label."""
    for ic in _sample_points(band):
        assert classify_soil_ic(ic) == band["backend_label"], (
            f"Ic {ic} should read '{band['backend_label']}'"
        )


def test_no_band_is_labelled_sensitive() -> None:
    """Robertson's zone 1 is a chart-position class, never an Ic band."""
    for band in BANDS:
        assert "Sensitive" not in str(band["renderer_label"])
        assert "Sensitive" not in str(band["backend_label"])
