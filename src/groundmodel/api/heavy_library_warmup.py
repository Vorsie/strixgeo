"""Warm the heavy export/compute libraries in the background after boot.

``groundmodel.api.main`` deliberately keeps the heavy scientific / export stacks
off the boot path so ``/openapi.json`` answers quickly on a packaged cold start:
numba + llvmlite (the voxel-mesh JIT), geolib (the D-Series exporters, which pull
matplotlib), ezdxf (the DXF exporters) and scipy (the TIN Delaunay) all import on
first use, not at boot (pinned by ``tests/unit/api/test_boot_imports_are_lazy``).

That deferral only moves the cost — the FIRST export or voxel Build then pays the
whole import (plus the ~0.6 s Numba JIT for the greedy-mesh kernel).  The owner's
follow-up (2026-09-04): *"you can just install the heavy libraries in the
background when the app is open."*  So once the engine is READY and serving, this
module warms those libraries — and compiles the mesh kernel — on a background
daemon thread, moving the first-use cost off the first user action.

Boot still imports none of them: this module imports nothing heavy at module
load (every heavy import lives inside a warm-up step, run only from the thread),
and the warm-up is started from the lifespan AFTER the ``engine READY`` log line,
never at module import.

Threading note
--------------
The warm-up runs on a ``threading.Thread(daemon=True)``.  Each ``import`` inside a
step takes CPython's per-module import lock, so if the first real export fires
mid-warm-up it simply waits for the in-progress import rather than importing
twice — correct, just serialised.  The thread touches neither the DB nor the
event loop; it only imports modules and JIT-compiles a pure kernel.
"""

from __future__ import annotations

import os
import threading
import time
from typing import TYPE_CHECKING

from groundmodel.api.heavy_library_warmup_constants import (
    WARMUP_SKIP_ENV,
    WARMUP_THREAD_NAME,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since

if TYPE_CHECKING:
    from collections.abc import Callable

__all__ = [
    "HeavyLibraryWarmup",
    "WARMUP_SKIP_ENV",
    "WARMUP_THREAD_NAME",
    "start_background_warmup",
    "warm_heavy_libraries",
]


def _import_numba() -> None:
    """Import Numba + llvmlite — the JIT backend for the voxel-mesh kernel."""
    import llvmlite  # type: ignore[import-untyped]  # noqa: F401  # deferred: numba's LLVM backend
    import numba  # noqa: F401  # deferred: kept off the API boot path


def _import_geolib() -> None:
    """Import GEOLib — the D-Stability / D-Sheet exporters (pulls matplotlib)."""
    import geolib  # noqa: F401  # deferred: kept off the API boot path


def _import_ezdxf() -> None:
    """Import ezdxf — the DXF section / fence exporters."""
    import ezdxf  # noqa: F401  # deferred: kept off the API boot path


def _import_scipy_spatial() -> None:
    """Import ``scipy.spatial`` — the Delaunay triangulation for TIN surfaces."""
    import scipy.spatial  # type: ignore[import-untyped]  # noqa: F401  # deferred: kept off the boot path


def _compile_mesh_kernel() -> None:
    """Compile and warm the greedy-mesh Numba kernel via its cached accessor.

    ``_maximal_rectangles_compiled()`` imports numba and returns the ``@njit``
    dispatcher (populating its ``lru_cache``); njit compiles lazily on the first
    CALL, not when the dispatcher is created, so the kernel is invoked once on a
    tiny mask to pay the ~0.6 s JIT here instead of on the first voxel Build.
    ``cache=True`` on the dispatcher persists the compiled kernel across sessions,
    so a warmed session leaves the on-disk cache ready for the next one too.
    """
    import numpy as np

    from groundmodel.domain.services.voxel_litho.greedy_mesh import (
        _maximal_rectangles_compiled,
    )

    _maximal_rectangles_compiled()(np.ascontiguousarray(np.zeros((1, 1), dtype=np.bool_)))


# The ordered warm-up steps: ``(label, callable)``.  Labels feed the per-step
# DEBUG line and the phase-summary INFO line.  Referenced by NAME inside
# ``HeavyLibraryWarmup.run`` (a module global, not captured) so a test can inject
# lightweight steps without importing the real heavy libraries.
_WARMUP_STEPS: tuple[tuple[str, Callable[[], None]], ...] = (
    ("numba", _import_numba),
    ("geolib", _import_geolib),
    ("ezdxf", _import_ezdxf),
    ("scipy", _import_scipy_spatial),
    ("mesh-kernel", _compile_mesh_kernel),
)


class HeavyLibraryWarmup(GroundModelLogger):
    """Warm the deferred heavy libraries, synchronously or on a daemon thread.

    Inherits :class:`~groundmodel.shared.logging.ground_model_logger.GroundModelLogger`
    so per-step timings log at DEBUG, the phase summary at INFO, and a step
    failure at WARNING — the observability discipline the Definition of Done
    requires of a logic class.
    """

    def __init__(self) -> None:
        """Initialise the logger with this module's name."""
        super().__init__(__name__)

    def run(self) -> None:
        """Run every warm-up step in order, timing each and isolating failures.

        Each step is timed; a success logs a DEBUG line, a failure logs a WARNING
        with the exception text and CONTINUES to the next step (a broken / missing
        library must never abort warming the rest).  A phase-summary INFO line
        closes the run.  Never raises — this is the target of the background
        thread, so an escaping exception would be lost on a dead thread anyway.
        """
        overall = time.perf_counter()
        timings: list[str] = []
        for label, step in _WARMUP_STEPS:
            started = time.perf_counter()
            try:
                step()
            except Exception as exc:  # noqa: BLE001 — one broken lib must not stop the rest
                self.warning(f"heavy-library warm-up: {label} failed — {type(exc).__name__}: {exc}")
                continue
            elapsed = ms_since(started)
            self.debug(f"heavy-library warm-up: {label} warmed [{elapsed}ms]")
            timings.append(f"{label} {elapsed}")
        self.info(f"heavy libraries warmed in {ms_since(overall)}ms: {', '.join(timings)}")

    def start_in_background(self) -> threading.Thread | None:
        """Start :meth:`run` on a daemon thread unless the skip flag is set.

        Returns ``None`` (and logs an INFO line) when ``STRIXGEO_SKIP_WARMUP=1`` —
        the switch the test suite and the e2e harness set to keep the numba import
        + JIT off their path.  Otherwise spawns a ``daemon=True`` thread so the
        warm-up never blocks interpreter shutdown, starts it, and returns it.

        Returns
        -------
        threading.Thread | None
            The started daemon thread, or ``None`` when warm-up is skipped.
        """
        if os.environ.get(WARMUP_SKIP_ENV) == "1":
            self.info(f"heavy-library warm-up skipped ({WARMUP_SKIP_ENV}=1)")
            return None
        thread = threading.Thread(target=self.run, name=WARMUP_THREAD_NAME, daemon=True)
        thread.start()
        self.debug(f"heavy-library warm-up thread started ({WARMUP_THREAD_NAME}, daemon)")
        return thread


def warm_heavy_libraries() -> None:
    """Warm every heavy library now, synchronously, on the calling thread.

    The synchronous entry point — used by the warm-up thread's target and by
    measurement / tests.  For the non-blocking, boot-triggered path use
    :func:`start_background_warmup`.
    """
    HeavyLibraryWarmup().run()


def start_background_warmup() -> threading.Thread | None:
    """Start the heavy-library warm-up on a daemon thread (unless skipped).

    Called from the FastAPI lifespan right after the ``engine READY`` log line so
    readiness is never delayed by it.  Honours ``STRIXGEO_SKIP_WARMUP=1``.

    Returns
    -------
    threading.Thread | None
        The started daemon thread, or ``None`` when warm-up is skipped.
    """
    return HeavyLibraryWarmup().start_in_background()
