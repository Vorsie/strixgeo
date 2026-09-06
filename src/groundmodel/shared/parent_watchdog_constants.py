"""Constants for the parent-process watchdog (:mod:`groundmodel.shared.parent_watchdog`)."""

from __future__ import annotations

# How often each spawned worker checks that the engine that started it is still
# alive. One second is chosen deliberately:
#   * It is comfortably below the ~2 s the desktop gives the process tree to die
#     on a normal close (``SHUTDOWN_DEADLINE_MS`` in
#     ``desktop/src/main/shutdownSequencer.ts``), so a worker the tree-kill
#     misses is gone within roughly the same window rather than lingering to
#     hold files in the install folder ("StrixGeo is nog actief").
#   * It costs one cheap liveness syscall per worker per second - negligible
#     against a parse pool that sits idle for almost all of its life, and small
#     enough that a one-second detection lag never matters.
# Faster polling buys nothing here and only spins the CPU; slower polling widens
# the orphan window the whole watchdog exists to close.
PARENT_WATCHDOG_POLL_SECONDS: float = 1.0
