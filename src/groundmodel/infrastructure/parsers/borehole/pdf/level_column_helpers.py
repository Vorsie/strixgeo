"""Pure helpers: find the description rules, the level column and the depth axis.

The layouts tie a description row to its depth through the level column: one
printed level per rule, left-aligned in one column, falling monotonically
down the sheet. The row text sits under its rule, but the rule itself may be
pushed down by a leader line when layers are thin, so a depth is never read
from where a rule or a text happens to sit; it is read from the label.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    AXIS_COLUMN_TOLERANCE_PT,
    AXIS_LABEL_TRAILING,
    AXIS_MAX_RESIDUAL_PT,
    LABEL_COLUMN_TOLERANCE_PT,
    MIN_AXIS_LABELS,
    MIN_RULES,
    RULE_FLAT_TOLERANCE_PT,
    RULE_MIN_LENGTH_PT,
    RULE_RIGHT_END_TOLERANCE_PT,
    RULE_SAME_Y_PT,
)
from groundmodel.infrastructure.parsers.borehole.pdf.depth_axis import DepthAxis
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run_finder import parse_number

#: One rule family: ``(x0, x1, ys)`` -- the leftmost start, the shared right
#: end and the distinct rule heights top to bottom.
RuleFamily = tuple[float, float, list[float]]


def rule_families(segments: np.ndarray) -> list[RuleFamily]:
    """Return the families of long horizontal rules that share a right end.

    Parameters
    ----------
    segments : numpy.ndarray
        ``(n, 4)`` stroked segments ``x0, y0, x1, y1`` of the page.

    Returns
    -------
    list of RuleFamily
        Families with at least ``MIN_RULES`` distinct rules, largest first.
    """
    if len(segments) == 0:
        return []
    x0 = np.minimum(segments[:, 0], segments[:, 2])
    x1 = np.maximum(segments[:, 0], segments[:, 2])
    flat = np.abs(segments[:, 1] - segments[:, 3]) < RULE_FLAT_TOLERANCE_PT
    long_ = (x1 - x0) >= RULE_MIN_LENGTH_PT
    keep = np.flatnonzero(flat & long_)
    groups: list[list[int]] = []
    for i in sorted(keep, key=lambda k: x1[k]):
        if groups and x1[i] - x1[groups[-1][-1]] <= RULE_RIGHT_END_TOLERANCE_PT:
            groups[-1].append(int(i))
        else:
            groups.append([int(i)])
    families: list[RuleFamily] = []
    for group in groups:
        ys: list[float] = []
        for y in sorted(float(segments[i, 1]) for i in group):
            if not ys or y - ys[-1] > RULE_SAME_Y_PT:
                ys.append(y)
        if len(ys) >= MIN_RULES:
            families.append((float(min(x0[group])), float(max(x1[group])), ys))
    families.sort(key=lambda f: -len(f[2]))
    return families


def columns_by_left_edge(words: Sequence[PageWord]) -> list[list[PageWord]]:
    """Group words into columns of one shared left edge, each top to bottom.

    Parameters
    ----------
    words : sequence of PageWord
        Candidate words.

    Returns
    -------
    list of list of PageWord
        Columns left to right.
    """
    columns: list[list[PageWord]] = []
    for word in sorted(words, key=lambda w: w.x0):
        if columns and word.x0 - columns[-1][0].x0 <= LABEL_COLUMN_TOLERANCE_PT:
            columns[-1].append(word)
        else:
            columns.append([word])
    for column in columns:
        column.sort(key=lambda w: w.cy)
    return columns


def non_increasing(values: Sequence[float | None]) -> bool:
    """Return whether the readable values never rise down the sheet.

    Parameters
    ----------
    values : sequence of float or None
        Levels top to bottom; None (unreadable) entries are skipped.

    Returns
    -------
    bool
        True when every readable value is <= the readable value above it.
    """
    known = [v for v in values if v is not None]
    return all(b <= a for a, b in zip(known, known[1:], strict=False))


def fit_depth_axis(
    words: Sequence[PageWord], right_limit: float, unit_m: float
) -> DepthAxis | None:
    """Fit the depth (or elevation) axis from the tick labels left of ``right_limit``.

    The axis is the LEFTMOST column of right-aligned numbers holding at
    least ``MIN_AXIS_LABELS`` labels (sample numbers sit right of the
    lithology column, filter numbers stand alone); with three labels or more
    they must lie on one line within ``AXIS_MAX_RESIDUAL_PT``, else the next
    column is tried. Trailing tick glyphs ("6.00—") are stripped. The last
    sheet of a borehole may print only two labels: two define the line.

    Parameters
    ----------
    words : sequence of PageWord
        The page's words in the graph's height.
    right_limit : float
        Only labels ending left of this x are considered (left of the level
        column).
    unit_m : float
        Metres per axis unit (from the layout profile).

    Returns
    -------
    DepthAxis or None
        The fit, or None when no column qualifies.
    """
    numeric: list[tuple[PageWord, float]] = []
    for w in words:
        if w.x1 >= right_limit:
            continue
        value = parse_number(w.text.rstrip(AXIS_LABEL_TRAILING))
        if value is not None:
            numeric.append((w, value))
    columns: list[list[tuple[PageWord, float]]] = []
    for item in sorted(numeric, key=lambda wv: wv[0].x1):
        if columns and item[0].x1 - columns[-1][0][0].x1 <= AXIS_COLUMN_TOLERANCE_PT:
            columns[-1].append(item)
        else:
            columns.append([item])
    # A column of three labels or more that lies on a line wins over any
    # two-label column (two stray numbers in the standpipe notes always fit a
    # line); a two-label column is taken only when no fuller column fits.
    ordered = [c for c in columns if len(c) > MIN_AXIS_LABELS] + [
        c for c in columns if len(c) == MIN_AXIS_LABELS
    ]
    for column in ordered:
        values = np.asarray([v for _, v in column], dtype=float)
        ys = np.asarray([w.cy for w, _ in column], dtype=float)
        if np.ptp(values) == 0:
            continue
        slope, intercept = np.polyfit(values, ys, 1)
        residual = float(np.max(np.abs(intercept + slope * values - ys)))
        if residual > AXIS_MAX_RESIDUAL_PT:
            continue
        return DepthAxis(
            slope=float(slope),
            intercept=float(intercept),
            unit_m=unit_m,
            label_count=len(values),
            x=float(max(w.x1 for w, _ in column)),
            residual_pt=residual,
        )
    return None


def anchor_depth_axis(
    words: Sequence[PageWord], right_limit: float, reference: DepthAxis, reference_page: int
) -> DepthAxis | None:
    """Place a sheet that prints one axis label with the slope of a sheet before it.

    Every sheet of one borehole is drawn at one scale, so one printed label in
    the reference axis' column fixes the line. A label anywhere else (a filter
    number of the standpipe column) is never taken.

    Parameters
    ----------
    words : sequence of PageWord
        The page's words in the graph's height.
    right_limit : float
        Only labels ending left of this x are considered.
    reference : DepthAxis
        The fitted axis of the previous sheet of the same borehole.
    reference_page : int
        Its page (stored on the result).

    Returns
    -------
    DepthAxis or None
        The anchored axis, or None when no label sits in the reference column.
    """
    for w in words:
        if w.x1 >= right_limit or abs(w.x1 - reference.x) > AXIS_COLUMN_TOLERANCE_PT:
            continue
        value = parse_number(w.text.rstrip(AXIS_LABEL_TRAILING))
        if value is None:
            continue
        return DepthAxis(
            slope=reference.slope,
            intercept=w.cy - reference.slope * value,
            unit_m=reference.unit_m,
            label_count=1,
            x=w.x1,
            residual_pt=0.0,
            slope_from_page=reference_page,
        )
    return None
