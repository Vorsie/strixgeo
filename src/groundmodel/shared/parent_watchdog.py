"""A daemon-thread watchdog that exits a spawned child when its parent dies.

The engine (:mod:`groundmodel.api.main`) runs a ``ProcessPoolExecutor`` of
``spawn`` workers for DOV CPT parsing. On a normal close the desktop kills the
whole engine process tree (``desktop/src/main/shutdownSequencer.ts``), but an
engine crash, a tree-kill that misses a worker, or a worker that outlives the
tree kill can leave orphaned ``python.exe`` processes alive with a dead parent,
still holding files in the install folder - which made the installer refuse to
reinstall with "StrixGeo is nog actief" (owner diagnosis 2026-09-06). This module
is the second, in-process layer of that defence: wired as the pool
``initializer``, it makes every worker watch the engine that started it and exit
by itself the moment that parent is gone.

It is deliberately framework-free and import-cheap - no logging, no project
imports beyond its own constants - because it is imported on the boot-timed path
and installed in every spawned worker, and because a worker whose parent has died
has no working log sink to write to anyway.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from collections.abc import Callable

from groundmodel.shared.parent_watchdog_constants import PARENT_WATCHDOG_POLL_SECONDS

# Windows OpenProcess access right + WaitForSingleObject / OpenProcess returns.
# SYNCHRONIZE is the minimal right needed to wait on a process handle; a child
# watching its own (same-user, same-session) parent is always granted it.
_SYNCHRONIZE = 0x00100000
# WaitForSingleObject: WAIT_TIMEOUT means "not signalled" i.e. still running;
# WAIT_OBJECT_0 (0) means the process object is signalled i.e. it has exited.
_WAIT_TIMEOUT = 0x00000102
# OpenProcess failing with ERROR_ACCESS_DENIED means the process EXISTS but we
# were not allowed to open it - treat that as alive, not gone.
_ERROR_ACCESS_DENIED = 5


def _windows_pid_alive(parent_pid: int) -> bool:
    """Return whether ``parent_pid`` is a live process on Windows.

    Uses ``OpenProcess(SYNCHRONIZE)`` + ``WaitForSingleObject(handle, 0)`` rather
    than ``os.kill(pid, 0)`` because on Windows ``os.kill`` with a plain signal
    does not probe liveness - it calls ``TerminateProcess`` and would kill the
    parent it is meant to watch.

    Raises
    ------
    OSError
        On any platform other than Windows, where ``ctypes.WinDLL`` does not
        exist; :func:`parent_pid_alive` only calls this on ``win32``.
    """
    # The guard also lets mypy narrow on ``sys.platform``, so a Linux / macOS
    # type check skips the Windows-only ctypes calls below.
    if sys.platform != "win32":
        raise OSError("_windows_pid_alive is Windows-only")
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)

    handle = kernel32.OpenProcess(_SYNCHRONIZE, False, parent_pid)
    if handle:
        try:
            return bool(kernel32.WaitForSingleObject(handle, 0) == _WAIT_TIMEOUT)
        finally:
            kernel32.CloseHandle(handle)
    # Could not open the process. Access-denied means it is alive but not ours;
    # any other error (typically ERROR_INVALID_PARAMETER for an unknown pid)
    # means it is gone.
    return ctypes.get_last_error() == _ERROR_ACCESS_DENIED


def _posix_pid_alive(parent_pid: int) -> bool:
    """Return whether ``parent_pid`` is a live process on POSIX.

    ``os.kill(pid, 0)`` sends no signal but performs the permission/existence
    check: it raises ``ProcessLookupError`` when the pid is gone and
    ``PermissionError`` when the process exists but is owned by someone else.
    """
    try:
        os.kill(parent_pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def parent_pid_alive(parent_pid: int) -> bool:
    """Return whether the process ``parent_pid`` is currently alive.

    Parameters
    ----------
    parent_pid : int
        The process id to probe - in production the engine process that spawned
        this worker, captured in the parent and passed down via the pool
        ``initargs``.

    Returns
    -------
    bool
        ``True`` while the process exists, ``False`` once it is gone.
    """
    if sys.platform == "win32":
        return _windows_pid_alive(parent_pid)
    return _posix_pid_alive(parent_pid)


def _default_on_gone() -> None:
    """Exit this process immediately with status 0.

    ``os._exit`` (not ``sys.exit``) on purpose: the parent is gone, so there is
    nothing left to flush or hand results back to, and running interpreter /
    atexit teardown risks blocking on the very pipes and locks the dead parent
    owned. The one job is to stop holding files, now.
    """
    os._exit(0)


def start_parent_watchdog(
    parent_pid: int,
    poll_s: float = PARENT_WATCHDOG_POLL_SECONDS,
    on_gone: Callable[[], None] | None = None,
    is_alive: Callable[[int], bool] | None = None,
) -> threading.Thread:
    """Start a daemon thread that exits this process when ``parent_pid`` dies.

    Designed to be passed straight to ``ProcessPoolExecutor(initializer=...,
    initargs=(os.getpid(),))``: it runs once in each spawned worker and returns
    immediately (the pool ignores the return value), leaving a background thread
    polling the parent's liveness.

    Parameters
    ----------
    parent_pid : int
        The process id to watch. When it is gone, ``on_gone`` runs.
    poll_s : float, optional
        Seconds between liveness checks. Defaults to
        :data:`PARENT_WATCHDOG_POLL_SECONDS`.
    on_gone : Callable[[], None] | None, optional
        Called from the watchdog thread once the parent is gone. Defaults to
        :func:`_default_on_gone` (``os._exit(0)``). Injectable so tests can
        observe the trigger without killing the test process.
    is_alive : Callable[[int], bool] | None, optional
        Liveness probe taking the parent pid. Defaults to
        :func:`parent_pid_alive`. Injectable so tests can drive the transition
        deterministically without a real process.

    Returns
    -------
    threading.Thread
        The started daemon thread. Callers rarely need it (a daemon thread does
        not block interpreter exit); it is returned for tests and diagnostics.
    """
    resolved_on_gone = _default_on_gone if on_gone is None else on_gone
    resolved_is_alive = parent_pid_alive if is_alive is None else is_alive

    def _watch() -> None:
        # Check first, then sleep: a probe that reports the parent already gone
        # triggers immediately rather than after a full poll interval.
        while resolved_is_alive(parent_pid):
            time.sleep(poll_s)
        resolved_on_gone()

    thread = threading.Thread(target=_watch, name="parent-watchdog", daemon=True)
    thread.start()
    return thread
