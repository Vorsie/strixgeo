"""The parent-process watchdog: a worker exits when its engine parent is gone.

Owner ruling 2026-09-06 ("no lingering process, ever"): every ``ProcessPoolExecutor``
worker the engine spawns watches the engine that started it and exits by itself
the moment that parent is gone. That is the second layer of defence behind the
desktop's process-tree kill (``desktop/src/main/shutdownSequencer.ts``): an engine
crash, a tree-kill that misses a worker, or a worker that outlives the tree kill
must never leave an orphaned ``python.exe`` holding files in the install folder.

The behavioural rules pinned here, in the owner's words:

* "a pool worker exits on its own when the engine that started it is gone"
* "a live parent keeps the worker running"

Both are proven twice: with a fast injected fake liveness probe (deterministic,
sub-millisecond), and once end-to-end against real OS processes.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading

import pytest

from groundmodel.shared.parent_watchdog import parent_pid_alive, start_parent_watchdog


def test_worker_exits_on_its_own_when_the_engine_that_started_it_is_gone() -> None:
    """A pool worker exits on its own when the engine that started it is gone.

    Fast, deterministic proof: a fake liveness probe reports the parent alive for
    the first two polls, then gone; the watchdog must then run ``on_gone`` (which
    in production is ``os._exit(0)``).
    """
    fired = threading.Event()
    # The parent is alive for the first two polls, then gone forever.
    poll_results = iter([True, True])

    def fake_is_alive(_parent_pid: int) -> bool:
        return next(poll_results, False)

    start_parent_watchdog(
        4321,
        poll_s=0.001,
        on_gone=fired.set,
        is_alive=fake_is_alive,
    )

    assert fired.wait(timeout=2.0), (
        "watchdog never exited the worker after its parent process disappeared"
    )


def test_a_live_parent_keeps_the_worker_running() -> None:
    """A live parent keeps the worker running - ``on_gone`` is never called."""
    fired = threading.Event()

    def always_alive(_parent_pid: int) -> bool:
        return True

    start_parent_watchdog(
        4321,
        poll_s=0.02,
        on_gone=fired.set,
        is_alive=always_alive,
    )

    # Across many poll intervals the watchdog must not fire while the parent lives.
    assert not fired.wait(timeout=0.3), (
        "watchdog exited the worker while its parent was still alive"
    )


def test_parent_pid_alive_is_true_for_this_running_process() -> None:
    """The real (un-injected) liveness probe reports this very process as alive."""
    assert parent_pid_alive(os.getpid()) is True


@pytest.mark.slow
def test_a_real_worker_exits_when_its_real_spawner_process_is_gone() -> None:
    """End-to-end with real OS processes: kill the parent, the worker self-exits.

    A real "parent" process sleeps; a real "worker" process installs the watchdog
    against that parent's pid and would otherwise outlive this test. When the
    parent is terminated the worker must ``exit(0)`` on its own within a second or
    two - the whole point of the watchdog. Uses the un-injected, real liveness
    probe, so it also exercises the platform ``parent_pid_alive`` implementation.
    """
    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    worker: subprocess.Popen[bytes] | None = None
    try:
        worker_code = (
            "import time\n"
            "from groundmodel.shared.parent_watchdog import start_parent_watchdog\n"
            f"start_parent_watchdog({parent.pid}, poll_s=0.05)\n"
            "time.sleep(30)\n"
        )
        worker = subprocess.Popen([sys.executable, "-c", worker_code])

        # While the parent lives, the worker keeps running (it does not exit early).
        try:
            worker.wait(timeout=0.5)
            raise AssertionError("worker exited while its parent was still alive")
        except subprocess.TimeoutExpired:
            pass

        # The parent dies; the worker must notice and exit(0) on its own.
        parent.terminate()
        parent.wait(timeout=2)
        assert worker.wait(timeout=2) == 0
    finally:
        for proc in (worker, parent):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=2)
