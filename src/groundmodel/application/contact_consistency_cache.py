"""In-process cache of pick checks, computed in a worker thread (spec §5).

``lookup_or_schedule`` never blocks: it returns a cached result for unchanged picks,
or schedules the computation and returns ``None`` ("computing"). The cache lives in
the engine process and is rebuilt on the first request after a restart.
Results are never evicted within a process (one entry per model + formation ever
checked; cleared on restart): accepted for a single-user desktop engine.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Hashable, Sequence

from groundmodel.application.pick_observation_digest import pick_observation_digest
from groundmodel.domain.services.geostat.geostat_constants import MIN_PICKS, STATUS_FIT_FAILED
from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck
from groundmodel.domain.value_objects.pick_observation import PickObservation
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

ComputeFn = Callable[[Sequence[PickObservation]], FormationPickCheck]


class ContactConsistencyCache(GroundModelLogger):
    """Per-(model, formation) results keyed by a digest of the picks."""

    def __init__(self, compute: ComputeFn | None = None) -> None:
        """Initialise an empty cache.

        Parameters
        ----------
        compute : Callable, optional
            The check to run; injectable for tests. ``None`` (the default) means
            ``check_formation_picks``, resolved on first use.
        """
        super().__init__(__name__)
        self._injected_compute = compute
        self._results: dict[Hashable, tuple[str, FormationPickCheck]] = {}
        # The task reference is kept here on purpose: the event loop holds only a
        # weak reference to a task, so an unreferenced one can be collected mid-run.
        self._running: dict[Hashable, tuple[str, asyncio.Task[None]]] = {}

    def _compute(self, picks: Sequence[PickObservation]) -> FormationPickCheck:
        """Run the check on ``picks`` (the injected one, else the real one).

        The real check is imported HERE, not at module level: it pulls in
        scipy (L-BFGS-B, cho_solve), and the router builds this cache at import
        time, so a module-level import would load scipy on every API boot
        (test_boot_imports_are_lazy). The post-READY warm-up imports it early.

        Parameters
        ----------
        picks : Sequence[PickObservation]
            The formation's picks.

        Returns
        -------
        FormationPickCheck
            The check's result.
        """
        if self._injected_compute is not None:
            return self._injected_compute(picks)
        from groundmodel.domain.services.geostat.leave_one_out_check import (  # deferred: scipy
            check_formation_picks,
        )

        return check_formation_picks(picks)

    def lookup_or_schedule(
        self, key: Hashable, picks: Sequence[PickObservation]
    ) -> FormationPickCheck | None:
        """Return the cached result, or schedule a computation and return ``None``.

        Must be called from inside a running event loop (a request handler).

        Parameters
        ----------
        key : Hashable
            ``(model_id, formation_id)``.
        picks : Sequence[PickObservation]
            The formation's current picks.

        Returns
        -------
        FormationPickCheck or None
            ``None`` while the computation for these picks runs.
        """
        if len(picks) < MIN_PICKS:
            # Nothing is fitted below MIN_PICKS: the answer is immediate and cheap.
            return self._compute(picks)
        digest = pick_observation_digest(picks)
        cached = self._results.get(key)
        if cached is not None and cached[0] == digest:
            return cached[1]
        running = self._running.get(key)
        if running is not None and running[0] == digest and not running[1].done():
            return None
        task = asyncio.get_running_loop().create_task(self._run(key, digest, tuple(picks)))
        self._running[key] = (digest, task)
        self.debug(f"pick check scheduled: key={key} picks={len(picks)}")
        return None

    async def _run(self, key: Hashable, digest: str, picks: tuple[PickObservation, ...]) -> None:
        """Compute in a worker thread (numpy releases the GIL) and store the result.

        Parameters
        ----------
        key : Hashable
            ``(model_id, formation_id)``.
        digest : str
            Digest of ``picks``; a newer schedule for the same key wins.
        picks : tuple[PickObservation, ...]
            The picks to check.
        """
        try:
            result = await asyncio.to_thread(self._compute, picks)
        except Exception as exc:  # noqa: BLE001 — a failed check must not kill the engine loop
            self.exception(f"pick check crashed: key={key}")
            # Stored as fit_failed so the poller reaches "ready" instead of
            # rescheduling the same crash on every poll.
            result = FormationPickCheck(
                STATUS_FIT_FAILED, len(picks), None, None, (), reason=f"check crashed: {exc}"
            )
        running = self._running.get(key)
        if running is not None and running[0] == digest:
            self._results[key] = (digest, result)
            del self._running[key]
            self.success(
                f"pick check ready: key={key} status={result.status} flags={len(result.flags)}"
            )
        else:
            self.debug(f"pick check result dropped (picks changed meanwhile): key={key}")
