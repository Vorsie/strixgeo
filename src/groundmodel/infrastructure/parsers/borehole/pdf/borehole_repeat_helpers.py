"""Pure helpers: compare a borehole printed twice in one report, row by row.

Owner 2026-10-08: "if the repeated print carries EXACTLY the same data (rows
identical over the overlap) drop it with a notice; if anything differs, alert
the user and let him choose which print to withhold. Never merge the two."

The repeat covers part of the first print's depth (an overview of a few
sheets). Over that overlap every repeat row must be a first-print row with
the same text and the same printed boundaries; only the repeat's very first
top and very last base may lie inside a row, because the repeat's sheets cut
the borehole there. Samples compare by id, mark and depth range (placed
through two axis fits, so within a tolerance); a sample the repeat's edges
cut may be shorter, and a first-print sample wholly inside the overlap must
be printed again.
"""

from __future__ import annotations

from typing import Any

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    LEVEL_MATCH_TOLERANCE_M,
    REPEAT_SAMPLE_TOLERANCE_M,
    REPEAT_SAMPLE_TOLERANCE_PT,
)
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole import DigitisedBorehole
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_interval import DigitisedInterval
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_sample import DigitisedSample


def repeat_differences(kept: DigitisedBorehole, repeat: DigitisedBorehole) -> list[dict[str, Any]]:
    """Return the rows where a repeated print differs from the first print.

    Parameters
    ----------
    kept : DigitisedBorehole
        The first print (stays listed).
    repeat : DigitisedBorehole
        The print found again, inside the first print's depth range.

    Returns
    -------
    list of dict
        One dict per differing row: ``kind`` ("interval" / "sample"),
        ``depth_top_m``, ``depth_base_m``, ``kept`` and ``repeat`` (the text
        each print shows there; None where a print has no such row), and
        ``sample_id`` for a sample. Empty when the repeat is identical over
        the overlap.
    """
    out = _interval_differences(kept.intervals, repeat.intervals)
    known = [i for i in repeat.intervals if i.depth_top_m is not None]
    based = [i for i in repeat.intervals if i.depth_base_m is not None]
    if known and based:
        top = min(i.depth_top_m for i in known if i.depth_top_m is not None)
        base = max(i.depth_base_m for i in based if i.depth_base_m is not None)
        tol = max(
            REPEAT_SAMPLE_TOLERANCE_M,
            REPEAT_SAMPLE_TOLERANCE_PT / _coarsest_points_per_m(kept, repeat),
        )
        out += _sample_differences(kept.samples, repeat.samples, top, base, tol)
    return out


def _interval_differences(
    kept: list[DigitisedInterval], repeat: list[DigitisedInterval]
) -> list[dict[str, Any]]:
    """Return the repeat rows no first-print row matches."""
    out: list[dict[str, Any]] = []
    last = len(repeat) - 1
    for index, row in enumerate(repeat):
        match = next(
            (k for k in kept if _same_row(k, row, cut_top=index == 0, cut_base=index == last)),
            None,
        )
        if match is not None:
            continue
        under = _row_at(kept, row)
        out.append(
            {
                "kind": "interval",
                "depth_top_m": row.depth_top_m,
                "depth_base_m": row.depth_base_m,
                "kept": under.description if under is not None else None,
                "repeat": row.description,
            }
        )
    return out


def _same_row(
    known: DigitisedInterval, row: DigitisedInterval, cut_top: bool, cut_base: bool
) -> bool:
    """Return whether a repeat row is this first-print row (text and boundaries)."""
    if _norm(known.description) != _norm(row.description):
        return False
    tol = LEVEL_MATCH_TOLERANCE_M
    k_top, k_base, r_top, r_base = (
        known.depth_top_m,
        known.depth_base_m,
        row.depth_top_m,
        row.depth_base_m,
    )
    if k_top is None or k_base is None or r_top is None or r_base is None:
        # An unreadable boundary matches only the same unreadable boundary.
        return known.top_label == row.top_label and known.base_label == row.base_label
    top_ok = abs(r_top - k_top) <= tol or (cut_top and k_top - tol <= r_top <= k_base + tol)
    base_ok = abs(r_base - k_base) <= tol or (cut_base and k_top - tol <= r_base <= k_base + tol)
    return top_ok and base_ok


def _row_at(kept: list[DigitisedInterval], row: DigitisedInterval) -> DigitisedInterval | None:
    """Return the first-print row holding the middle of a repeat row, if any."""
    if row.depth_top_m is None or row.depth_base_m is None:
        return None
    middle = (row.depth_top_m + row.depth_base_m) / 2.0
    return next(
        (
            k
            for k in kept
            if k.depth_top_m is not None
            and k.depth_base_m is not None
            and k.depth_top_m <= middle <= k.depth_base_m
        ),
        None,
    )


def _coarsest_points_per_m(*boreholes: DigitisedBorehole) -> float:
    """Return the smallest axis scale (pt per m) any sheet of the prints was drawn at."""
    scales = [
        abs(axis["slope_pt_per_unit"]) / axis["unit_m"]
        for b in boreholes
        for sheet in b.provenance.get("sheets", [])
        if (axis := sheet.get("axis")) and axis.get("slope_pt_per_unit") and axis.get("unit_m")
    ]
    return min(scales, default=float("inf"))


def _sample_differences(
    kept: list[DigitisedSample],
    repeat: list[DigitisedSample],
    top: float,
    base: float,
    tol: float,
) -> list[dict[str, Any]]:
    """Return the samples printed differently over the overlap ``[top, base]``."""
    by_id = {s.sample_id: s for s in kept}
    again = {s.sample_id for s in repeat}
    out: list[dict[str, Any]] = []
    for sample in repeat:
        known = by_id.get(sample.sample_id)
        if known is None or not _same_sample(known, sample, top, base, tol):
            out.append(_sample_row(sample, known, sample))
    for known in kept:
        k_top, k_base = known.depth_top_m, known.depth_base_m
        inside = (
            k_top is not None and k_base is not None and k_top > top + tol and k_base < base - tol
        )
        if inside and known.sample_id not in again:
            out.append(_sample_row(known, known, None))
    return out


def _same_sample(
    known: DigitisedSample, sample: DigitisedSample, top: float, base: float, tol: float
) -> bool:
    """Return whether a repeat sample bar is the first print's bar (an edge may cut it)."""
    if known.mark != sample.mark:
        return False
    pairs = (
        (known.depth_top_m, sample.depth_top_m, top),
        (known.depth_base_m, sample.depth_base_m, base),
    )
    for k, r, edge in pairs:
        if k is None or r is None:
            if k is not r:
                return False
            continue
        cut = abs(r - edge) <= tol
        if abs(r - k) > tol and not cut:
            return False
    return True


def _sample_row(
    where: DigitisedSample, kept: DigitisedSample | None, repeat: DigitisedSample | None
) -> dict[str, Any]:
    """Return the difference record of one sample."""
    return {
        "kind": "sample",
        "sample_id": where.sample_id,
        "depth_top_m": where.depth_top_m,
        "depth_base_m": where.depth_base_m,
        "kept": _sample_text(kept),
        "repeat": _sample_text(repeat),
    }


def _sample_text(sample: DigitisedSample | None) -> str | None:
    """Return a sample as one line ("S1-0000000001 4.500-5.000 m filled"), None when absent."""
    if sample is None:
        return None
    return f"{sample.sample_id} {sample.depth_top_m}-{sample.depth_base_m} m {sample.mark}"


def _norm(text: str) -> str:
    """Return a description with its whitespace collapsed."""
    return " ".join(text.split())
