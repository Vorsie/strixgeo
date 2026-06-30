"""Generic timing helpers used by orchestrator phase logs.

The ``ms_since`` helper is the canonical way the application layer formats
``perf_counter`` deltas for log messages. Every orchestrator's phase-by-phase
log line says ``{_ms(start)} ms``; centralising here gives a single source
of truth for the unit + the casting (perf_counter returns float seconds, the
log format is integer milliseconds).

The ``phase_timer`` context manager provides a higher-level bracket:
``with phase_timer(self, "label voxels")`` logs an INFO line on exit
(``"label voxels [2.3s]"``), matching the convention that each build phase
records its own wall-clock so a hung Build is diagnosable without a profiler.
"""

from __future__ import annotations

import time
from collections.abc import Generator
from contextlib import contextmanager
from typing import Protocol


class _InfoLogger(Protocol):
    """Minimal structural protocol for a logger: any object with ``info``."""

    def info(self, msg: str) -> None:
        """Log an informational message."""
        ...


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


@contextmanager
def phase_timer(logger: _InfoLogger, label: str) -> Generator[None, None, None]:
    """Time a named build phase and log its wall-clock duration on exit.

    Logs one ``INFO`` line on exit: ``"<label> [<elapsed>s]"`` where elapsed
    is formatted to one decimal place (e.g. ``"phase-2 label_voxels [38.6s]"``).
    Exceptions propagate normally (the log line still fires via ``finally``).

    The helper takes the logger as a parameter so it never imports a Logger
    instance at module load time — helper-hygiene rule (CLAUDE.md). Pass
    ``self`` inside any ``GroundModelLogger`` subclass.

    Parameters
    ----------
    logger : _InfoLogger
        Any object with an ``info(msg: str) -> None`` method.  Pass ``self``
        inside a :class:`~groundmodel.shared.logging.GroundModelLogger`
        subclass; the Protocol is satisfied without a hard import.
    label : str
        Phase description included verbatim in the log line.  Keep it short
        and unique within a single ``execute()`` run so the per-phase timeline
        is readable at a glance in structured logs.

    Yields
    ------
    None

    Examples
    --------
    >>> with phase_timer(self, "phase-2 label_voxels"):
    ...     grid = label_voxels(domain, grid_spacing_m, sections)
    # → INFO "phase-2 label_voxels [38.6s]"
    """
    t0 = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - t0
        logger.info(f"{label} [{elapsed:.1f}s]")
