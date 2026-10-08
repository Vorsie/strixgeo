"""Comparing a borehole printed twice (owner 2026-10-08, ruling 5), on hand-built prints.

"If the repeated print carries EXACTLY the same data (rows identical over the
overlap) drop it with a notice; if anything differs, alert the user." A sample
bar is read through the sheet's axis, so "the same data" means the same within
what the coarser print can draw: the 24.13-002 overview (16 pt per m) draws
each bar about 1 pt shorter at each end than the full print (113 pt per m).
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_header import (
    BoreholePdfHeader,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_repeat_helpers import (
    repeat_differences,
)
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole import DigitisedBorehole
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_interval import DigitisedInterval
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_sample import DigitisedSample

SAND = "Zand fijn 150-200, siltig, grijs, Pulsinstallatie machinaal"


def _print(
    pt_per_cm: float, sample: tuple[float, float], text: str = SAND, key: str = "B@p1"
) -> DigitisedBorehole:
    """Return one print: a sand row 32.00-34.00 m and one open sample bar."""
    row = DigitisedInterval(32.0, 34.0, -2571.0, -2771.0, "-2571", "-2771", text, (text,), (1,))
    bar = DigitisedSample("66-", sample[0], sample[1], "open", "geroerd", (1,))
    axis = {"slope_pt_per_unit": pt_per_cm, "unit_m": 0.01}
    return DigitisedBorehole(
        key=key,
        header=BoreholePdfHeader(name="B"),
        intervals=[row],
        samples=[bar],
        provenance={"sheets": [{"axis": axis}]},
    )


def test_an_overview_drawing_the_bar_a_point_shorter_is_the_same_data() -> None:
    """Full print 113 pt/m: bar 32.509-32.992; overview 16 pt/m: 32.564-32.949 (< 1.5 pt)."""
    kept = _print(1.134713, (32.509, 32.992))
    overview = _print(0.16201, (32.564, 32.949), key="B@p102")
    assert repeat_differences(kept, overview) == []


def test_the_same_shift_at_the_full_scale_is_a_difference() -> None:
    """At 113 pt/m a 0.055 m shift is 6 pt: another bar, reported."""
    kept = _print(1.134713, (32.509, 32.992))
    again = _print(1.134713, (32.564, 32.949), key="B@p102")
    (diff,) = repeat_differences(kept, again)
    assert (diff["kind"], diff["sample_id"]) == ("sample", "66-")


def test_another_description_is_a_difference_whatever_the_scale() -> None:
    """The row text differs: reported with both texts."""
    kept = _print(1.134713, (32.509, 32.992))
    again = _print(0.16201, (32.564, 32.949), text=SAND + ", schelpen", key="B@p102")
    (diff,) = repeat_differences(kept, again)
    assert diff["kind"] == "interval"
    assert (diff["kept"], diff["repeat"]) == (SAND, SAND + ", schelpen")
