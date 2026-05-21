"""Packed-but-nudge-capped column layout for the PDF section figure.

Owner directive 2026-05-21: section figures in the project report should
render investigation columns "as close as possible" without distorting
the geometry — each column's nudge from its true along-section position
is capped at ``MAX_NUDGE_M`` (35 m by default).

Algorithm
---------
Two-pass left-to-right packing:

1. Place each column at its true along-section x.
2. Walk left to right; if column ``i`` would overlap column ``i-1``
   (centre-to-centre distance < required gap), nudge column ``i`` to
   the right by the minimum needed to clear — but cap the displacement
   so ``|nudged_i - true_i| <= max_nudge_m``.  When the cap binds, the
   columns visually touch / overlap at their hard limit; the engineer
   reads the configuration as "data points are dense here" rather than
   as a geometry distortion.

Mirrors the SectionPanel's interactive packed layout (spacing slider
toward 0) — but server-side, deterministic, no UI state.
"""

from __future__ import annotations

from collections.abc import Sequence

DEFAULT_MAX_NUDGE_M = 35.0


def packed_column_positions(
    true_xs: Sequence[float],
    band_widths_m: Sequence[float],
    edge_gap_m: float = 0.0,
    max_nudge_m: float = DEFAULT_MAX_NUDGE_M,
) -> list[float]:
    """Pack columns left-to-right with a per-column nudge cap.

    Parameters
    ----------
    true_xs : Sequence[float]
        Each column's true along-section position in metres.  Need not be
        sorted on input — the function sorts internally and returns the
        positions in the SAME order as the input.
    band_widths_m : Sequence[float]
        Width of each column's data band in metres (same units as
        ``true_xs``).  ``len(band_widths_m) == len(true_xs)``.
    edge_gap_m : float
        Optional gap between neighbouring band edges (metres).  Default
        0 means bands may touch but not overlap.
    max_nudge_m : float
        Maximum signed displacement from ``true_xs[i]`` allowed for
        column ``i``.  Defaults to 35 m per the owner directive.

    Returns
    -------
    list[float]
        Per-column packed positions in the SAME order as the input.

    Notes
    -----
    Pure function; no I/O, no logger.  Tested in isolation in
    ``tests/unit/infrastructure/exporters/test_pdf_layout.py``.
    """
    n = len(true_xs)
    if n != len(band_widths_m):
        raise ValueError("true_xs and band_widths_m must have the same length")
    if n == 0:
        return []

    # Work on an index-sorted view so the pass is left-to-right while
    # preserving the caller's input order in the output.
    order = sorted(range(n), key=lambda i: true_xs[i])
    placed: dict[int, float] = {}
    prev_right: float | None = None
    for idx in order:
        half_w = band_widths_m[idx] / 2.0
        # Earliest centre position that respects the previous band's
        # right edge + the requested gap.
        min_centre = (prev_right + edge_gap_m + half_w) if prev_right is not None else float("-inf")
        # Cap displacement: column cannot move further right than
        # true_xs[idx] + max_nudge_m.
        cap_right = true_xs[idx] + max_nudge_m
        # Pick the rightmost of (true position, min-clear position),
        # then clamp by the cap.  When the cap binds, the column lands
        # at its cap and the next iteration handles the residual.
        natural = max(true_xs[idx], min_centre)
        placed[idx] = min(natural, cap_right)
        prev_right = placed[idx] + half_w

    return [placed[i] for i in range(n)]
