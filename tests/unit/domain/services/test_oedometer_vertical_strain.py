"""Unit tests for the oedometer vertical strain (owner 2026-09-29).

Owner: "can we add delta_h/h0 from il-oedometer?" — for the incremental-loading
oedometer Strix adds the vertical strain epsilon = delta_h / h0, delta_h the
cumulative settlement since the start of the test (the parsed total column,
which already bridges a dial re-zero) and h0 the initial specimen height from
the header. A DERIVED channel, never the lab's own value.

The hand-worked example is 20/0568: h0 = 19,96 mm; the last loading stage
(16) ends at 1,771 mm cumulative → epsilon = 1,771 / 19,96 = 0,0887274549.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from groundmodel.domain.services.oedometer_vertical_strain import vertical_strain
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_control_listing_parser import (
    OedometerControlListingParser,
)

_S0568 = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "lab"
    / "oedometer"
    / "200568B7-LstSMControleListing.txt"
)


def test_strain_is_the_cumulative_settlement_over_the_initial_height() -> None:
    """epsilon = delta_h / h0, element by element."""
    assert vertical_strain([0.0, 0.5, 1.0], 20.0) == pytest.approx([0.0, 0.025, 0.05])


def test_end_of_last_loading_stage_on_20_0568_matches_the_hand_worked_value() -> None:
    """On 20/0568 the end-of-stage strain of the last loading stage equals the
    parsed cumulative settlement over the header height to 1e-6 — and the
    hand-worked 1,771 / 19,96."""
    r = OedometerControlListingParser().parse(_S0568)
    h0 = r.header.initial_height_mm
    last_loading = [s for s in r.stages if s.direction == "Belasting"][-1]
    strain = vertical_strain(last_loading.total_settlement_mm, h0)
    assert strain[-1] == pytest.approx(last_loading.total_settlement_mm[-1] / h0, abs=1e-6)
    assert strain[-1] == pytest.approx(1.771 / 19.96, abs=1e-6)


def test_strain_is_zero_at_the_first_reading_of_stage_one() -> None:
    """Nothing has settled at the first reading of the test."""
    r = OedometerControlListingParser().parse(_S0568)
    first = r.stages[0]
    assert vertical_strain(first.total_settlement_mm, r.header.initial_height_mm)[0] == 0.0


def test_a_missing_reading_stays_missing() -> None:
    """An unreadable cell (None) is not invented — it stays None."""
    assert vertical_strain([0.1, None], 10.0) == [pytest.approx(0.01), None]


@pytest.mark.parametrize("h0", [0.0, -1.0, None])
def test_no_usable_initial_height_raises(h0) -> None:
    """Without a positive h0 there is no strain to compute — refuse, never divide by zero."""
    with pytest.raises(ValueError):
        vertical_strain([0.1], h0)
