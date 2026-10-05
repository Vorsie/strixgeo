"""Grid-line helpers shared by the vector calibrator and the page triage.

A CPT graph prints its tick labels on the long grid lines of its panels. The
calibrator snaps the labels to those lines to fit an exact scale; the triage
uses the same test to recognise the graph frame of a sheet whose text says
nothing (a refusal sheet in an unreadable font). Pure functions: no I/O, no
logging.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    AXIS_LABEL_REACH_PT,
    GRAPH_FRAME_MIN_DEPTH_AXIS_SHARE,
    GRAPH_FRAME_MIN_VALUE_AXES,
    GRID_LINE_MIN_LENGTH_PT,
    GRID_SNAP_TOLERANCE_PT,
    LABEL_SHIFT_PITCH_SHARE,
)
from groundmodel.infrastructure.parsers.cpt.pdf.tick_orientation import TickOrientation
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run import TickRun
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_content import VectorPageContent


def long_grid_lines(content: VectorPageContent) -> tuple[np.ndarray, np.ndarray]:
    """Return the long vertical and horizontal lines of a page.

    Parameters
    ----------
    content : VectorPageContent
        The page's stroked segments.

    Returns
    -------
    tuple of numpy.ndarray
        ``(v_lines, h_lines)``: vertical lines as ``(x, y0, y1)`` rows at
        least ``GRID_LINE_MIN_LENGTH_PT`` long, horizontal lines as
        ``(y, x0, x1)`` rows at least half that long (a panel is taller than
        it is wide).
    """
    vertical, horizontal = content.axis_aligned()
    s = content.segments
    v = s[vertical]
    h = s[horizontal]
    v_lines = (
        np.column_stack(
            [(v[:, 0] + v[:, 2]) / 2, np.minimum(v[:, 1], v[:, 3]), np.maximum(v[:, 1], v[:, 3])]
        )
        if len(v)
        else np.zeros((0, 3))
    )
    h_lines = (
        np.column_stack(
            [(h[:, 1] + h[:, 3]) / 2, np.minimum(h[:, 0], h[:, 2]), np.maximum(h[:, 0], h[:, 2])]
        )
        if len(h)
        else np.zeros((0, 3))
    )
    v_lines = v_lines[v_lines[:, 2] - v_lines[:, 1] >= GRID_LINE_MIN_LENGTH_PT]
    h_lines = h_lines[h_lines[:, 2] - h_lines[:, 1] >= GRID_LINE_MIN_LENGTH_PT / 2]
    return v_lines, h_lines


def grid_positions(run: TickRun, lines: np.ndarray, vertical: bool) -> np.ndarray:
    """Return the positions of the grid lines a tick run's labels can sit on.

    For a horizontal axis the candidates are vertical lines whose extent comes
    within reach of the label row; for a vertical (depth) axis horizontal
    lines whose extent starts just right of the label column.

    Parameters
    ----------
    run : TickRun
        The axis labels.
    lines : numpy.ndarray
        Lines across the run, as :func:`long_grid_lines` returns them.
    vertical : bool
        True for a vertical run (``lines`` are horizontal lines).

    Returns
    -------
    numpy.ndarray
        Sorted unique line positions (x for a horizontal run, y otherwise).
    """
    if not len(lines):
        return np.zeros(0)
    if vertical:
        # A depth grid line starts just right of its label column.
        near_run = (lines[:, 1] >= run.cross - 5.0) & (lines[:, 1] <= run.cross + 60.0)
    else:
        reach = AXIS_LABEL_REACH_PT + 15.0
        near_run = (lines[:, 1] <= run.bottom + reach) & (lines[:, 2] >= run.top - reach)
    positions: np.ndarray = np.unique(np.round(lines[near_run, 0], 3))
    return positions


def best_label_shift(coords: Sequence[float], positions: np.ndarray) -> float | None:
    """Return the one shift that puts the labels on their grid lines, or None.

    Labels may sit a constant distance off their grid lines (the Van der
    Straaten CPTU sheets print the qc labels 5.7 pt right of the lines): the
    shift is searched up to ``LABEL_SHIFT_PITCH_SHARE`` of the tick pitch, and
    accepted when the median label then sits within a third of
    ``GRID_SNAP_TOLERANCE_PT`` of a line.

    Parameters
    ----------
    coords : sequence of float
        Label centres along the axis.
    positions : numpy.ndarray
        Candidate grid-line positions (:func:`grid_positions`).

    Returns
    -------
    float or None
        The shift (pt) to add to every label centre; None when the labels do
        not sit on the lines.
    """
    if not len(positions) or not len(coords):
        return None
    c = np.asarray(coords, dtype=float)
    pitch = float(np.median(np.abs(np.diff(c)))) if len(c) > 1 else 10.0
    shifts = [
        float(p - x) for x in c for p in positions if abs(p - x) <= LABEL_SHIFT_PITCH_SHARE * pitch
    ]
    if not shifts:
        return None

    def cost(shift: float) -> float:
        """Return the median distance of the shifted labels to their nearest line."""
        return float(np.median([np.min(np.abs(positions - (x + shift))) for x in c]))

    best = min(shifts, key=lambda s: (round(cost(s), 3), abs(s)))
    return best if cost(best) <= GRID_SNAP_TOLERANCE_PT / 3 else None


def graph_frame_axes(runs: Sequence[TickRun], content: VectorPageContent) -> tuple[int, int]:
    """Return how many depth and value axes of a CPT graph frame a page carries.

    A depth axis is a vertical tick run down at least
    ``GRAPH_FRAME_MIN_DEPTH_AXIS_SHARE`` of the page whose labels sit on long
    horizontal grid lines; a value axis is a horizontal tick run whose labels
    sit on long vertical grid lines (a panel's grid). A ruled table can carry
    a column of numbers, but not labels on the lines of a panel grid.

    Parameters
    ----------
    runs : sequence of TickRun
        The page's tick runs.
    content : VectorPageContent
        The page's strokes.

    Returns
    -------
    tuple of int
        ``(depth_axes, value_axes)``.
    """
    v_lines, h_lines = long_grid_lines(content)
    depth = 0
    value = 0
    for run in runs:
        if run.orientation is TickOrientation.VERTICAL:
            if run.end - run.start < GRAPH_FRAME_MIN_DEPTH_AXIS_SHARE * content.height_pt:
                continue
            if best_label_shift(run.coords, grid_positions(run, h_lines, True)) is not None:
                depth += 1
        elif best_label_shift(run.coords, grid_positions(run, v_lines, False)) is not None:
            value += 1
    return depth, value


def has_graph_frame(runs: Sequence[TickRun], content: VectorPageContent) -> bool:
    """Return whether a page carries the frame of a CPT graph (see graph_frame_axes).

    Parameters
    ----------
    runs : sequence of TickRun
        The page's tick runs.
    content : VectorPageContent
        The page's strokes.

    Returns
    -------
    bool
        True for a gridded depth axis and at least ``GRAPH_FRAME_MIN_VALUE_AXES``
        gridded value panels.
    """
    depth, value = graph_frame_axes(runs, content)
    return depth >= 1 and value >= GRAPH_FRAME_MIN_VALUE_AXES
