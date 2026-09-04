"""Background warm-up of the heavy export/compute libraries after boot.

The rule, in the owner's words (2026-09-04): *once the engine is ready, the
heavy libraries are warmed in the background so the first export or build does
not pay for them; boot itself still imports none of them.*

``groundmodel.api.main`` defers numba/llvmlite (the voxel-mesh JIT), geolib (the
D-Series exporters, which pull matplotlib), ezdxf (the DXF exporters) and scipy
(the TIN Delaunay) off the boot path — they import on first use.  This module's
warm-up moves that first-use cost off the FIRST export / voxel Build too, by
importing them (and compiling the greedy-mesh Numba kernel) on a background
daemon thread once the API is READY.  Boot must still import none of them: the
warm-up is triggered from the lifespan AFTER the READY log line, never at module
import.

These tests pin four properties:

a. Calling the synchronous warm-up entry imports every heavy library and
   compiles the mesh kernel (a subprocess probe — the parent pytest process has
   already imported half the world, which would mask the assertion).
b. A failing warm-up step is isolated: the others still warm, a WARNING is
   logged, and the daemon thread ends without raising into the caller.
c. Importing the warm-up module — and importing ``groundmodel.api.main``, which
   now references it — still pulls in none of the heavy libraries.
d. The background warm-up is skipped when ``STRIXGEO_SKIP_WARMUP=1`` (the flag
   tests and the e2e harness set to keep the numba import + JIT off the test /
   e2e path).
"""

from __future__ import annotations

import logging
import subprocess
import sys

import groundmodel.api.heavy_library_warmup as warmup

# The libraries that boot must never import and that the warm-up must load.
# scipy.spatial registers ``scipy`` in ``sys.modules``; numba registers
# ``llvmlite``; geolib registers ``matplotlib``.
_HEAVY_PACKAGES = ("numba", "llvmlite", "geolib", "ezdxf", "scipy")
# Boot must import none of these six (the warm-up set plus matplotlib, which
# geolib pulls) — this is the existing boot-laziness contract, restated so the
# warm-up wiring in main.py cannot silently break it.
_FORBIDDEN_AT_BOOT = ("numba", "llvmlite", "geolib", "ezdxf", "matplotlib", "scipy")


def test_warm_up_imports_every_heavy_library_and_compiles_the_mesh_kernel() -> None:
    """The sync warm-up entry loads every heavy package and compiles the kernel.

    In the rule's words: once warm-up runs, the heavy libraries are loaded and
    the mesh kernel is compiled so the first export or build does not pay for
    them.  Runs in a fresh interpreter so the assertion sees only what the
    warm-up itself loaded.
    """
    probe = (
        "import sys;"
        "import groundmodel.api.heavy_library_warmup as w;"
        "w.warm_heavy_libraries();"
        "from groundmodel.domain.services.voxel_litho.greedy_mesh import "
        "_maximal_rectangles_compiled as k;"
        f"loaded = sorted(m for m in {_HEAVY_PACKAGES!r} if m in sys.modules);"
        "print('LOADED=' + ','.join(loaded));"
        "print('KERNEL_CACHED=' + str(k.cache_info().currsize == 1))"
    )
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        check=True,
    )
    out = completed.stdout
    # Alphabetical order of _HEAVY_PACKAGES sorted().
    assert "LOADED=ezdxf,geolib,llvmlite,numba,scipy" in out, (
        f"Warm-up did not load every heavy library.\nstdout:\n{out}\nstderr:\n{completed.stderr}"
    )
    assert "KERNEL_CACHED=True" in out, (
        "Warm-up did not compile / cache the greedy-mesh Numba kernel.\n"
        f"stdout:\n{out}\nstderr:\n{completed.stderr}"
    )


def test_a_failing_warm_up_step_is_isolated_and_the_daemon_thread_ends(
    caplog: object,
    monkeypatch: object,
) -> None:
    """One failing step must not crash the rest — WARNING logged, others warm, thread ends.

    In the rule's words: the warm-up runs on a daemon thread and never raises
    into the caller even when one import fails — the others still warm, a WARNING
    is logged, and the thread ends.  Uses lightweight injected steps so the
    orchestration is pinned without importing the real heavy libraries (their
    real import is covered by the subprocess test above).
    """
    ran: list[str] = []

    def _ok_first() -> None:
        ran.append("alpha")

    def _boom() -> None:
        # A bogus/missing package is exactly a ModuleNotFoundError.
        raise ModuleNotFoundError("No module named 'bogus_warmup_pkg'")

    def _ok_last() -> None:
        ran.append("beta")

    monkeypatch.setattr(  # type: ignore[attr-defined]
        warmup,
        "_WARMUP_STEPS",
        (("alpha", _ok_first), ("bogus", _boom), ("beta", _ok_last)),
    )
    # Allow the background thread to start (conftest defaults the skip flag on).
    monkeypatch.delenv(warmup.WARMUP_SKIP_ENV, raising=False)  # type: ignore[attr-defined]
    caplog.set_level(logging.DEBUG)  # type: ignore[attr-defined]

    thread = warmup.start_background_warmup()

    assert thread is not None, "background warm-up did not start a thread"
    assert thread.daemon is True, "warm-up thread must be a daemon thread"
    thread.join(timeout=10.0)
    assert not thread.is_alive(), "warm-up thread did not end"

    # The step after the failing one still ran (isolation).
    assert ran == ["alpha", "beta"], f"steps did not survive a failing step: {ran}"

    warnings = [
        r
        for r in caplog.records
        if r.levelno == logging.WARNING  # type: ignore[attr-defined]
    ]
    assert any("bogus" in r.getMessage() for r in warnings), (
        "a failing warm-up step must log a WARNING naming the step; "
        f"warnings seen: {[r.getMessage() for r in warnings]}"
    )
    # The phase-summary INFO still fires with the surviving steps.
    assert any(
        "heavy libraries warmed" in r.getMessage()
        for r in caplog.records  # type: ignore[attr-defined]
    ), "the warm-up must log a phase-summary INFO line"


def test_background_warm_up_is_skipped_when_the_skip_env_is_set(
    monkeypatch: object,
) -> None:
    """``STRIXGEO_SKIP_WARMUP=1`` skips the warm-up: no thread, no step runs.

    In the rule's words: the warm-up is skipped when ``STRIXGEO_SKIP_WARMUP=1``.
    """
    ran: list[str] = []
    monkeypatch.setattr(  # type: ignore[attr-defined]
        warmup,
        "_WARMUP_STEPS",
        (("x", lambda: ran.append("x")),),
    )
    monkeypatch.setenv(warmup.WARMUP_SKIP_ENV, "1")  # type: ignore[attr-defined]

    thread = warmup.start_background_warmup()

    assert thread is None, "warm-up must not start a thread when the skip flag is set"
    assert ran == [], "no warm-up step must run when the skip flag is set"


def test_importing_the_warm_up_module_imports_no_heavy_library() -> None:
    """Importing the warm-up module alone must not pull in any heavy library.

    Boot imports this module (main references it), so it must keep the heavy libs
    off the boot path exactly as the deferred import sites do.  Fresh interpreter.
    """
    _assert_boot_import_stays_lazy("import groundmodel.api.heavy_library_warmup")


def test_importing_the_api_still_imports_no_heavy_library() -> None:
    """Importing ``groundmodel.api.main`` must still import none of the six.

    The guard against the warm-up wiring regressing boot laziness: the warm-up is
    triggered from the lifespan AFTER the READY log line, never at module import.
    """
    _assert_boot_import_stays_lazy("import groundmodel.api.main")


def _assert_boot_import_stays_lazy(import_statement: str) -> None:
    """Run *import_statement* in a subprocess and assert no forbidden lib loaded.

    Parameters
    ----------
    import_statement : str
        A Python ``import`` statement to execute in a fresh interpreter.
    """
    probe = (
        f"import sys; {import_statement}; "
        f"print(sorted(m for m in {_FORBIDDEN_AT_BOOT!r} if m in sys.modules))"
    )
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        check=True,
    )
    printed = completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else ""
    assert printed == "[]", (
        f"{import_statement!r} pulled in heavy libraries that must be deferred: "
        f"{printed}\nsubprocess stderr:\n{completed.stderr}"
    )
