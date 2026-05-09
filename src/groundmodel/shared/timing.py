"""Generic timing helpers used by orchestrator phase logs.

The ``ms_since`` helper is the canonical way the application layer formats
``perf_counter`` deltas for log messages. Every orchestrator's phase-by-phase
log line says ``{_ms(start)} ms``; centralising here gives a single source
of truth for the unit + the casting (perf_counter returns float seconds, the
log format is integer milliseconds).
"""

from __future__ import annotations

import time


def ms_since(start: float) -> int:
    """Return elapsed time since *start* as integer milliseconds.

    Parameters
    ----------
    start : float
        A ``time.perf_counter()`` snapshot taken at the beginning of the
        phase being timed. ``perf_counter`` is preferred over ``time.time``
        because it is monotonic and unaffected by wall-clock adjustments.

    Returns
    -------
    int
        Elapsed milliseconds, truncated to an integer. We chose integer
        milliseconds (not floats) for log readability; sub-millisecond
        precision is not useful for the orchestrator phases that span
        seconds-to-minutes.
    """
    # ``perf_counter`` returns seconds as a float (e.g. 0.382 for 382 ms).
    # Multiplying by 1000 converts seconds → milliseconds (1 s = 1000 ms),
    # then ``int(...)`` truncates the fractional part for log readability.
    return int((time.perf_counter() - start) * 1000)
