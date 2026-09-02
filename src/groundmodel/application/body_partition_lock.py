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

Most holders take exactly ONE such lock per transaction, so the lock itself
cannot deadlock.

THE MULTI-MODEL ORDER (audit, 2026-08-23). Three transactions legitimately
hold two: ``SubdivideAllBodies`` and ``MoveRestatedContact`` lock a litho
parent together with its geotech child, and ``reconcile_bodies_after_restore``
walks every model of a project. Two holders taking the same pair in opposite
orders would deadlock on the LOCKS — trading one ABBA for another. The single
rule, and it is not negotiable for a new holder:

    lock the LITHO PARENT first, then the GEOTECH CHILD; break any
    remaining tie on ``str(model_id)``.

Parent-first is the order the codebase already resolves in (``SubdivideAllBodies``
resolves the litho model, then the child it derives), so it is the one that
needs no translation at the call site. It was briefly expressed two ways — pure
``sorted(key=str)`` here, parent-first there — which agreed only by accident,
because ``uuid7`` ids are time-ordered and a child is always minted after its
parent. A hand-written fixture id or a restore that mints out of lineage order
would have broken that coincidence silently.

BEFORE ANY WRITE, INCLUDING WRITES THAT REACH A CHILD THROUGH A FOREIGN-KEY
ACTION (audit BP-3, 2026-09-02). "Lock the child before you touch the child" is
not only about the child's own ``body`` DELETE/INSERT — a write to a PARENT row
can silently reach the child. ``_run_resolver`` on a litho model deletes litho
``body`` rows; each delete fires the ``ON DELETE SET NULL`` action of the geotech
rows' ``parent_litho_body_id`` FK, which row-locks the geotech ``body`` rows. So
the litho resolve holds geotech ROW locks the moment it deletes a litho body —
before it ever names the geotech model. Taking the geotech advisory lock only
afterwards (the litho resolver's old step 6) let a concurrent geotech recompute
hold that advisory lock and delete those same rows → an ABBA deadlock (litho held
the rows + wanted the advisory lock; geotech held the advisory lock + wanted the
rows). The rule is therefore: a caller that will touch a child's rows — directly
OR through a foreign-key action on a parent it rewrites — takes the child's lock
UP FRONT, before the first such write. ``_run_resolver`` now does exactly this
(sibling geotech locks taken right after the litho lock). ``lock_body_partition``
itself runs its lock SELECTs under ``session.no_autoflush`` so acquiring a lock
never flushes a pending row write first (belt and braces for the same rule).
"""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOTECHNICAL
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

    # Both lock SELECTs run under ``no_autoflush``. Acquiring a lock must never
    # be the thing that issues the first row write of a transaction: with
    # autoflush ON, any pending ORM writes would flush BEFORE the lock statement,
    # and a flush can emit writes that reach a CHILD row through a foreign-key
    # action (e.g. the ``ON DELETE SET NULL`` of a geotech body's
    # ``parent_litho_body_id`` when its litho parent is deleted). That would
    # re-open the very order-of-operations hole the caller took this lock to
    # close — a write landing before the lock guarding it. Belt and braces on top
    # of the caller taking locks before any write (see ``_run_resolver``).
    with session.no_autoflush:
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
    with session.no_autoflush:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": key},
        )
    logger.info(
        f"body-partition lock: {operation} acquired model {model_id} after "
        f"{(time.monotonic() - started) * 1000:.0f} ms of contention"
    )


async def lock_sibling_geotech_partitions(
    session: AsyncSession,
    *,
    litho_model_id: UUID,
    operation: str,
) -> list[UUID]:
    """Lock every sibling GEOTECH child's body partition for a litho-parent write.

    Resolves the geotechnical models whose ``parent_model_id`` is
    ``litho_model_id`` and takes each one's :func:`lock_body_partition` in a
    canonical order (sorted by ``str(id)``), returning the sibling ids.

    Callers take this BEFORE any write that deletes litho ``body`` rows. Deleting
    a litho body fires the ``ON DELETE SET NULL`` action of the geotech rows'
    ``parent_litho_body_id`` FK (and, when a litho_layer is deleted, the geotech
    bands' ``parent_litho_layer_id``) — a HIDDEN WRITE that row-locks the geotech
    child rows. So the child lock must be held BEFORE that delete, not after (the
    ABBA the module docstring describes; audit BP-3). This is the single copy of
    the "resolve sibling geotech ids and lock them sorted" step, shared by
    ``_run_resolver``, ``ClearLithoModel`` and ``DeleteBody``.

    A GEOTECH model has no geotech children (the hierarchy is
    geological -> litho -> geotech), so calling this with a geotech ``model_id``
    is a safe no-op — the SELECT returns nothing and no lock is taken. A caller
    holding a possibly-geotech model may therefore call it unconditionally.

    Parameters
    ----------
    session : AsyncSession
        Active session; the litho parent's OWN partition lock must already be
        held (litho-parent-first is the mandated order — see the module
        docstring).
    litho_model_id : UUID
        The lithostratigraphic model whose ``body`` rows the caller is about to
        rewrite or delete.
    operation : str
        Human name of the caller for the contention log, forwarded to each
        sibling :func:`lock_body_partition` (e.g. ``"restamp-parent-litho-body"``,
        ``"clear-litho-model"`` or ``"delete-body"``).

    Returns
    -------
    list[UUID]
        The sibling geotech model ids that were locked — empty when the model has
        no geotech children. Advisory xact locks are re-entrant, so a caller that
        later touches these same models may reuse the ids without re-locking.
    """
    sibling_geotech_ids = list(
        (
            await session.execute(
                select(GeologicalModelOrm.id).where(
                    GeologicalModelOrm.parent_model_id == litho_model_id,
                    GeologicalModelOrm.kind == MODEL_KIND_GEOTECHNICAL,
                )
            )
        )
        .scalars()
        .all()
    )
    for sibling_id in sorted(sibling_geotech_ids, key=str):
        await lock_body_partition(session, model_id=sibling_id, operation=operation)
    return sibling_geotech_ids
