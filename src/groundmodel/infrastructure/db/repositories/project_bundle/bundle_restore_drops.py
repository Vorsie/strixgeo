"""Tally of rows silently dropped by the restore size caps.

Production-readiness audit L6: the restore path enforces size caps
(``_MAX_CPT_SERIES_ROWS`` and the per-borehole child-array caps in
``bundle_serialization.py``) by TRUNCATING oversized arrays with only a log
line. A user reopening a big project therefore lost depth series or child rows
with nothing on screen to say so. This mutable tally is threaded through the
restore builders so the caller can surface the counts in the restore response —
the renderer then toasts "N depth-series / M child rows were too large and were
capped".

It is a plain data holder that the builders increment; it does not log or act
(CLAUDE.md — dataclasses hold data, they do not inherit ``GroundModelLogger``).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BundleRestoreDrops:
    """Counts of rows the restore size caps dropped.

    Attributes
    ----------
    cpt_series_dropped : int
        Number of CPTs whose depth-series exceeded ``_MAX_CPT_SERIES_ROWS`` and
        was dropped (the CPT still restored, without its series).
    borehole_child_rows_dropped : int
        Total number of borehole child rows (drill segments, field-log
        intervals, observations, layers, admixtures, samples, lab tests) removed
        because their array exceeded its per-array cap.
    """

    cpt_series_dropped: int = 0
    borehole_child_rows_dropped: int = 0

    @property
    def total(self) -> int:
        """Total rows dropped across every capped category."""
        return self.cpt_series_dropped + self.borehole_child_rows_dropped
