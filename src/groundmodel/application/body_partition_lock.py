"""Per-model mutual exclusion for body-partition rewrites.

Every body-partition write for one model — a manual correlate, an accept,
auto-correlate, a band edit, subdivide, the startup sweep, and the background
``bodies/recompute`` — ends in the same place: ``_run_resolver`` reads the
model's layers, edges and geometry facts, then rewrites one ``body`` row per
connected component and re-stamps ``litho_layer.body_id``.

That read-then-rewrite was unguarded across requests. Two of them running at
once on ONE model produced three different unhandled 500s, all reproduced
against the integration database (owner dogfeed 2026-08-15: a correlate click
500'd while the debounced ``bodies/recompute`` for the same model was in
flight; the same click 6 seconds later succeeded):

* ``UniqueViolationError`` on ``uq_litho_lens_model_formation_ordinal`` — both
  transactions INSERT the same ``(model_id, formation_id, body_ordinal)``.
* ``ForeignKeyViolationError`` on ``fk_litho_layer_body_id`` — one transaction
  stamps a layer onto a body row the other has just deleted as an orphan.
* ``DeadlockDetectedError`` on ``DELETE FROM body`` — the two transactions walk
  overlapping orphan sets in different orders.

A single per-model transaction-scoped advisory lock removes all three at the
source: the read and the rewrite happen under it, so a concurrent writer sees
a committed partition rather than a half-rewritten one. The lock releases at
COMMIT or ROLLBACK, and re-acquiring it inside the same transaction is free
(advisory locks are reference-counted per session), so a caller that already
holds it may pass through ``_run_resolver`` without special-casing.

Every holder takes exactly ONE such lock per transaction, so the lock itself
cannot deadlock.
"""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class _BodyPartitionLockLogger(GroundModelLogger):
    """Internal logger for the module-level lock helper."""

    def __init__(self) -> None:
        """Initialise with this module's name."""
        super().__init__(__name__)


def body_partition_lock_key(model_id: UUID) -> str:
    """Return the advisory-lock key string for one model's body partition.

    Parameters
    ----------
    model_id : UUID
        The lithostratigraphic or geotechnical model being rewritten.

    Returns
    -------
    str
        The key hashed into the advisory-lock id. One key per model, shared by
        every writer, so ``bodies/recompute`` and a manual correlate contend on
        the SAME lock rather than on two different ones.
    """
    return f"body-partition:{model_id}"


async def lock_body_partition(
    session: AsyncSession,
    *,
    model_id: UUID,
    operation: str,
) -> None:
    """Serialise this transaction's body-partition rewrite for ``model_id``.

    Tries the lock without blocking first, purely so that real contention is
    visible in the log: an uncontended take is silent at DEBUG, a contended one
    names the waiting operation up front and reports the wait once it lands.
    The terminal therefore shows the holder's own entry line next to the
    waiter's warning, which is what makes an intermittent conflict readable
    after the fact.

    Parameters
    ----------
    session : AsyncSession
        The active session. The lock is transaction-scoped and releases on the
        caller's COMMIT or ROLLBACK — never released explicitly.
    model_id : UUID
        The model whose ``body`` rows and ``litho_layer.body_id`` stamps this
        transaction is about to rewrite.
    operation : str
        Human name of the caller for the contention log, e.g.
        ``"bodies/recompute"`` or ``"resolve-litho-instances"``.

    Returns
    -------
    None
    """
    logger = _BodyPartitionLockLogger()
    key = body_partition_lock_key(model_id)

    acquired = (
        await session.execute(
            text("SELECT pg_try_advisory_xact_lock(hashtext(:k))"),
            {"k": key},
        )
    ).scalar_one()
    if acquired:
        logger.debug(f"body-partition lock: {operation} took model {model_id} uncontended")
        return

    logger.warning(
        f"body-partition lock: {operation} is WAITING on model {model_id} — another "
        "body-partition write (correlate / accept / band edit / subdivide / "
        "bodies/recompute) holds it in the same model; the two are being serialised "
        "rather than allowed to collide"
    )
    started = time.monotonic()
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": key},
    )
    logger.info(
        f"body-partition lock: {operation} acquired model {model_id} after "
        f"{(time.monotonic() - started) * 1000:.0f} ms of contention"
    )
