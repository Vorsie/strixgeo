"""A ``DovTrackSource`` wrapper that measures the DOV XML lookups (owner finding 2026-10-04).

"Reset to DOV ... takes 5 to 10 seconds." The reset's lookups run inside
``reset_tracks_from_dov`` between its parse calls, so the use case wraps the
source in this proxy to split the phase log into "DOV XML lookup" and
"parse + rewrite" without threading a timer through the domain rules.
"""

from __future__ import annotations

import time

from groundmodel.application.dov_track_source import DovTrackSource


class TimedDovTrackSource:
    """Forward every lookup to ``inner`` and sum the time and the count.

    Parameters
    ----------
    inner : DovTrackSource
        The real source (the on-disk DOV cache, or a test fake).

    Attributes
    ----------
    seconds : float
        Total wall-clock spent in lookups so far.
    boring_reads : int
        How many ``boring_xml`` calls were made.
    interpretation_reads : int
        How many ``interpretation_xml`` calls were made.
    """

    def __init__(self, inner: DovTrackSource) -> None:
        """Wrap ``inner`` with zeroed counters."""
        self._inner = inner
        self.seconds = 0.0
        self.boring_reads = 0
        self.interpretation_reads = 0

    def boring_xml(self, boornummer: str) -> bytes | None:
        """Timed ``inner.boring_xml``.

        Parameters
        ----------
        boornummer : str
            The borehole's DOV boornummer.

        Returns
        -------
        bytes | None
            Whatever ``inner`` answers.
        """
        start = time.perf_counter()
        try:
            return self._inner.boring_xml(boornummer)
        finally:
            self.seconds += time.perf_counter() - start
            self.boring_reads += 1

    def interpretation_xml(self, permkey: str) -> bytes | None:
        """Timed ``inner.interpretation_xml``.

        Parameters
        ----------
        permkey : str
            The observation's ``dov_permkey``.

        Returns
        -------
        bytes | None
            Whatever ``inner`` answers.
        """
        start = time.perf_counter()
        try:
            return self._inner.interpretation_xml(permkey)
        finally:
            self.seconds += time.perf_counter() - start
            self.interpretation_reads += 1
