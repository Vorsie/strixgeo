"""Shared helpers for the litho-layer bulk/batch write use cases.

Extracted per the project's "extract on second copy" rule: the
post-commit per-row ``session.refresh`` loop was copy-pasted across the
bulk-create and batch-update use cases (audit BE-APPLICATION-LITHO-05),
and each copy issued one SELECT round-trip per row.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm


async def repopulate_layers_after_commit(
    session: AsyncSession,
    rows: list[LithoLayerOrm],
) -> None:
    """Re-load committed layer rows in ONE round-trip (no per-row refresh).

    ``server_default`` / server-side ``onupdate`` columns (``created_at``,
    ``updated_at``) are expired at flush; Pydantic's response serialiser
    would lazy-load them outside the greenlet (``MissingGreenlet``).  A
    single ``populate_existing`` SELECT refreshes every row already in
    the identity map in one round-trip, replacing the N sequential
    awaited ``session.refresh`` calls a 50-layer bulk write previously
    issued.

    Parameters
    ----------
    session : AsyncSession
        Active database session — the one the rows were committed on.
    rows : list[LithoLayerOrm]
        The just-committed rows to repopulate.  Empty list = no-op.
    """
    if not rows:
        return
    stmt = (
        select(LithoLayerOrm)
        .where(LithoLayerOrm.id.in_([row.id for row in rows]))
        .execution_options(populate_existing=True)
    )
    await session.execute(stmt)
