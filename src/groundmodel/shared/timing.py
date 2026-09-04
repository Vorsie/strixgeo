"""Generic timing helpers used by orchestrator phase logs.

The ``ms_since`` helper is the canonical way the application layer formats
``perf_counter`` deltas for log messages. Every orchestrator's phase-by-phase
log line says ``{_ms(start)} ms``; centralising here gives a single source
of truth for the unit + the casting (perf_counter returns float seconds, the
log format is integer milliseconds).

The ``phase_timer`` context manager provides a higher-level bracket:
``with phase_timer(self, "label voxels")`` logs an INFO line on clean exit
(``"label voxels [2.3s]"``) or a WARNING line on exception exit
(``"label voxels FAILED [1.2s]"``), re-raising the exception either way.
This makes a crashing phase diagnosable from the log without a re-run.
"""

from __future__ import annotations

import time
from collections.abc import Generator
from contextlib import contextmanager
from typing import Protocol

# Perf-counter anchor captured the first time this module is imported — the
# single source of truth for "how long has this process been alive". It lives
# HERE, not in an entrypoint module, on purpose: ``python -m groundmodel.api.serve``
# loads the entrypoint TWICE under two identities (``__main__`` and the qualified
# ``groundmodel.api.serve``), so an anchor stored in that module gives the
# lifespan a different, later reference than ``serve.main`` — the startup
# timeline then understates its own total. ``shared.timing`` has ONE identity in
# ``sys.modules`` regardless, and is imported by the entrypoint's own top-level
# imports, so it is set once, early. Used only for the INFO startup timeline.
_PROCESS_START_PERF = time.perf_counter()


def process_uptime_ms() -> int:
    """Return milliseconds since this process first imported ``groundmodel.shared.timing``.

    A single per-process clock every module can share for a startup timeline —
    see :data:`_PROCESS_START_PERF` for why the anchor lives here rather than in
    an entrypoint module. It is not a wall-clock of interpreter bootstrap (the
    tiny pre-import cost cannot be observed from Python), only of everything from
    the first ``shared.timing`` import onward.

    Returns
    -------
    int
        Elapsed milliseconds since the anchor was captured.
    """
    return ms_since(_PROCESS_START_PERF)


class _InfoLogger(Protocol):
    """Minimal structural protocol for a logger: ``info`` + ``warning``."""

    def info(self, msg: str) -> None:
        """Log an informational message."""
        ...

    def warning(self, msg: str) -> None:
        """Log a warning-level message (used when a phase fails)."""
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

    On exception the block logs ``WARNING "<label> FAILED [<elapsed>s]"`` and
    re-raises.  On clean exit it logs ``INFO "<label> [<elapsed>s]"``.  The two
    paths are distinguishable so a hung or crashing phase is diagnosable from
    the log without a re-run.

    Examples
    --------
    >>> with phase_timer(self, "phase-2 label_voxels"):
    ...     grid = label_voxels(domain, grid_spacing_m, sections)
    # → INFO "phase-2 label_voxels [38.6s]"
    # (on exception) → WARNING "phase-2 label_voxels FAILED [1.2s]"
    """
    t0 = time.perf_counter()
    _raised = False
    try:
        yield
    except BaseException:
        _raised = True
        raise
    finally:
        elapsed = time.perf_counter() - t0
        if _raised:
            logger.warning(f"{label} FAILED [{elapsed:.1f}s]")
        else:
            logger.info(f"{label} [{elapsed:.1f}s]")
