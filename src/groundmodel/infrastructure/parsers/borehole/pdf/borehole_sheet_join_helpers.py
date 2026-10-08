"""Pure helpers: turn sheet rows into depth intervals and join them across sheets.

A borehole printed over several sheets is cut at each sheet's bottom. The
boorstaat repeats the cut layer at the top of the next sheet (the next sheet
starts ABOVE the previous sheet's bottom, so the two overlap); the
boorprofiel leaves the last row of a sheet open (no closing level) and
starts the next sheet on that same level. Either way the next sheet's first
row continues the previous sheet's last row when it prints the same text:
the two become ONE interval, top from the first sheet, base from the next.
A continuation that prints another text is kept as printed and reported.
"""

from __future__ import annotations

from collections.abc import Sequence

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_depth_helpers import depth_below
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    ISSUE_SHEET_JOIN_TEXT_DIFFERS,
    LEVEL_MATCH_TOLERANCE_M,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet import BoreholeSheet
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_interval import DigitisedInterval
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    make_issue,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel


def sheet_intervals(sheet: BoreholeSheet, ground_m: float | None) -> list[DigitisedInterval]:
    """Return a sheet's rows as intervals (depth = ground level - printed level).

    Parameters
    ----------
    sheet : BoreholeSheet
        The sheet.
    ground_m : float or None
        The borehole's ground level (same datum as the levels).

    Returns
    -------
    list of DigitisedInterval
        One per row, top to bottom.
    """
    out: list[DigitisedInterval] = []
    for row in sheet.rows:
        top = row.top.level_m if row.top else None
        base = row.base.level_m if row.base else None
        out.append(
            DigitisedInterval(
                depth_top_m=depth_below(ground_m, top),
                depth_base_m=depth_below(ground_m, base),
                top_level_m=top,
                base_level_m=base,
                top_label=row.top.text if row.top else None,
                base_label=row.base.text if row.base else None,
                description=row.text,
                description_lines=row.lines,
                pages=(sheet.page_number,),
            )
        )
    return out


def join_sheets(
    per_sheet: Sequence[list[DigitisedInterval]],
) -> tuple[list[DigitisedInterval], list[ValidationIssue]]:
    """Concatenate the sheets' intervals, joining each continued row into one.

    Parameters
    ----------
    per_sheet : sequence of list of DigitisedInterval
        Each sheet's intervals, sheets in order.

    Returns
    -------
    tuple
        ``(intervals, issues)``: the borehole's intervals top to bottom and
        a WARNING for every continuation that prints another text.
    """
    out: list[DigitisedInterval] = []
    issues: list[ValidationIssue] = []
    for items in per_sheet:
        rest = list(items)
        if out and rest:
            cut = out[-1].base_level_m
            # Rows wholly above the previous sheet's cut are reprints of rows
            # already read (the boorstaat repeats ~1 m): dropped when the
            # previous sheet printed the same text there, else kept + reported.
            while rest and _reprinted(rest[0], cut):
                row = rest.pop(0)
                if not any(
                    _covers(o, row) and _same_text(o.description, row.description) for o in out
                ):
                    issues.append(_join_issue(row))
                    out.append(row)
            if rest and _continues(out[-1], rest[0]):
                previous, following = out[-1], rest[0]
                if _same_text(
                    previous.description, following.description, previous.base_level_m is None
                ):
                    out[-1] = _merge(previous, following)
                    rest = rest[1:]
                else:
                    issues.append(_join_issue(following))
        out.extend(rest)
    return out, issues


def _reprinted(row: DigitisedInterval, cut: float | None) -> bool:
    """Return whether a row lies wholly above the previous sheet's cut level."""
    return (
        cut is not None
        and row.base_level_m is not None
        and row.base_level_m >= cut - LEVEL_MATCH_TOLERANCE_M
    )


def _covers(known: DigitisedInterval, row: DigitisedInterval) -> bool:
    """Return whether a row read earlier spans the levels of a reprinted row."""
    k_top, k_base = known.top_level_m, known.base_level_m
    r_top, r_base = row.top_level_m, row.base_level_m
    if k_top is None or k_base is None or r_top is None or r_base is None:
        return False
    tol = LEVEL_MATCH_TOLERANCE_M
    return k_top + tol >= r_top and k_base - tol <= r_base


def _continues(previous: DigitisedInterval, following: DigitisedInterval) -> bool:
    """Return whether the next sheet's first row continues the previous last row.

    It does when the previous row has no closing level (the boorprofiel) and
    the next starts on the same level, or when the next row starts above the
    previous sheet's cut (the boorstaat: it straddles the cut).
    """
    if following.top_level_m is None or previous.top_level_m is None:
        return False
    if previous.base_level_m is None:
        return abs(following.top_level_m - previous.top_level_m) <= LEVEL_MATCH_TOLERANCE_M
    return following.top_level_m > previous.base_level_m + LEVEL_MATCH_TOLERANCE_M


def _same_text(a: str, b: str, may_be_cut_short: bool = False) -> bool:
    """Return whether two descriptions are the same row.

    Equal after whitespace is collapsed; a row a sheet left open may also be
    cut short at the page bottom (one text a prefix of the other).
    """
    x, y = " ".join(a.split()), " ".join(b.split())
    if not x or not y:
        return False
    return x == y or (may_be_cut_short and (x.startswith(y) or y.startswith(x)))


def _join_issue(row: DigitisedInterval) -> ValidationIssue:
    """Return the WARNING for a continued or reprinted row with another text."""
    page = row.pages[0]
    return make_issue(
        ValidationLevel.WARNING,
        ISSUE_SHEET_JOIN_TEXT_DIFFERS,
        f"page {page}: a row the previous sheet already covers ({row.top_label}/"
        f"{row.base_label}) prints another text; kept as printed",
        {"page": page, "top_label": row.top_label, "base_label": row.base_label},
    )


def _merge(previous: DigitisedInterval, following: DigitisedInterval) -> DigitisedInterval:
    """Return one interval: top of ``previous``, base of ``following``, the fuller text."""
    fuller = following if len(following.description) > len(previous.description) else previous
    return DigitisedInterval(
        depth_top_m=previous.depth_top_m,
        depth_base_m=following.depth_base_m,
        top_level_m=previous.top_level_m,
        base_level_m=following.base_level_m,
        top_label=previous.top_label,
        base_label=following.base_label,
        description=fuller.description,
        description_lines=fuller.description_lines,
        pages=previous.pages + tuple(p for p in following.pages if p not in previous.pages),
    )
