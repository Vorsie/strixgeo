"""Progress callback utilities shared across the application and infrastructure layers.

DOV import use cases run multi-phase pipelines lasting 30–60 seconds for large
bounding boxes.  To surface live progress to the UI without changing the atomic-
commit contract, callers supply an optional ``ProgressCallback`` that is invoked
at each named phase boundary.

The callback is deliberately coarse-grained — one fire per phase boundary (WFS
discovery, per-batch during downloads, dedup, persist, commit) rather than per
individual row.  The coordinator (``ImportCptDov``, ``ImportBoreholeDov``) wires
the callback into the infrastructure clients as well as its own loop.

Phase names
-----------
``"wfs"``
    WFS discovery complete.  ``total`` = investigations found in bbox;
    ``done`` == ``total``.
``"download"``
    Download + parse phase periodic tick.  Fired every
    ``max(50, total // 5)`` items and at the end.  ``total`` = total from WFS.
``"dedup"``
    Deduplication query finished.  ``done`` = already-in-project count;
    ``total`` = total fetched.
``"persist"``
    Persist loop tick — one fire per investigation (including duplicates,
    which are skipped without a DB write).  ``total`` = total fetched.
``"commit"``
    Final transaction committed.  ``done`` == ``total`` == rows committed.
    This phase is indeterminate from the UI perspective (the progress bar
    pulses rather than advancing) — the label is what matters: "Saving…".
``"pins"``
    CPT-specific (SSE stream only): WFS index resolved.  Emitted ONCE per
    import immediately after the recursive bbox-split + dedup fully
    resolves — before any XML download starts.  ``total`` = investigations
    found in bbox; ``done`` == ``total``.  The payload carries extra fields
    compared to a plain progress tick:
    ``{"type": "pins", "items": [{"permkey", "name", "x_lambert72", "y_lambert72"}, ...]}``.
    The frontend renders these as pending-import markers on the map so the
    user sees all N locations immediately, then swaps them for real markers
    wholesale on ``"done"``.
``"interpretations"``
    Borehole-specific: interpretation phase finished.
``"samples"``
    Borehole-specific: sample + grain-size phase finished.
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable

# A progress callback receives (phase_name, done, total).
# It may be synchronous (returns None) or asynchronous (returns a coroutine).
# ``_fire`` handles both transparently.
ProgressCallback = Callable[[str, int, int], object]


async def fire_progress(cb: ProgressCallback | None, phase: str, done: int, total: int) -> None:
    """Invoke the progress callback when supplied; await it when async.

    Errors from the callback are silently suppressed — a broken SSE
    connection MUST NOT abort the import.  The callback is a best-effort
    progress signal, not a control path.

    Parameters
    ----------
    cb : ProgressCallback | None
        Callback to invoke.  ``None`` is a no-op.
    phase : str
        Named phase label (see module docstring for the full list).
    done : int
        Items completed so far within this phase.
    total : int
        Total items expected within this phase.
    """
    if cb is None:
        return
    try:
        result = cb(phase, done, total)
        if inspect.isawaitable(result):
            await asyncio.ensure_future(result)
    except Exception:  # noqa: BLE001 — callback errors must not abort the import
        pass
