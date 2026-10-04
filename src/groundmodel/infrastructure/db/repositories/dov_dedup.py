"""Per-row dedup helpers used by the DOV import orchestrators.

Refresh-on-duplicate (see CLAUDE.md "Known Architectural Debt" once
this lands) means that re-importing a bbox runs phases 4b/4c for ALL
in-scope boreholes — newly-imported AND already-existing. Per-row
dedup against ``dov_permkey`` keeps existing children intact while
filling in any rows the upstream now provides but the local DB
lacks.

Two shapes:

* ``existing_dov_permkeys`` — set[str], used by interpretation +
  lab-test persisters that just need a "skip this permkey" check.
* ``existing_dov_permkey_to_id`` — dict[str, UUID], used by the
  sample persister, which then feeds the existing-sample id into
  the permkey_to_sample_id map so downstream lab-test phases can
  attach to existing samples too.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm


async def existing_dov_permkeys(
    session: AsyncSession,
    orm_cls: Any,
    parent_attr: str,
    parent_ids: Iterable[UUID],
) -> set[str]:
    """Return the set of ``dov_permkey`` values already stored for these parents.

    Parameters
    ----------
    session
        The orchestrator's open AsyncSession.
    orm_cls
        ORM class with ``dov_permkey`` and the named parent FK column.
    parent_attr
        Name of the FK column on ``orm_cls`` (e.g. ``"borehole_id"``,
        ``"sample_id"``).
    parent_ids
        Parent UUIDs to scope the query.

    Returns ``set()`` when ``parent_ids`` is empty (avoids issuing a
    no-op SQL query). NULL permkeys (legacy rows without an upstream
    identity) are filtered out — they never participate in dedup.
    """
    parent_id_list = list(parent_ids)
    if not parent_id_list:
        return set()
    parent_col = getattr(orm_cls, parent_attr)
    stmt = select(orm_cls.dov_permkey).where(
        parent_col.in_(parent_id_list),
        orm_cls.dov_permkey.is_not(None),
    )
    result = await session.execute(stmt)
    return {p for p in result.scalars() if p}


async def existing_dov_permkey_to_id(
    session: AsyncSession,
    orm_cls: Any,
    parent_attr: str,
    parent_ids: Iterable[UUID],
) -> dict[str, UUID]:
    """Return ``{dov_permkey: row_id}`` for rows already stored under these parents.

    Sister helper to ``existing_dov_permkeys`` — used by the sample
    persister to pre-populate the permkey_to_sample_id map with
    existing samples, so subsequent lab-test phases can attach new
    tests to them.
    """
    parent_id_list = list(parent_ids)
    if not parent_id_list:
        return {}
    parent_col = getattr(orm_cls, parent_attr)
    stmt = select(orm_cls.id, orm_cls.dov_permkey).where(
        parent_col.in_(parent_id_list),
        orm_cls.dov_permkey.is_not(None),
    )
    result = await session.execute(stmt)
    return {permkey: row_id for row_id, permkey in result.all() if permkey}


async def deleted_dov_permkeys(session: AsyncSession, borehole_ids: Iterable[UUID]) -> set[str]:
    """Return the DOV permkeys of the tracks the user deleted from these boreholes.

    Owner dogfeed 2026-10-01: a deleted DOV track must not come back on a bbox
    re-import. The interpretation persister skips these permkeys next to the
    ones ``existing_dov_permkeys`` reports, so refresh-on-duplicate only ever
    attaches what the borehole never held.

    Parameters
    ----------
    session : AsyncSession
        The orchestrator's open AsyncSession.
    borehole_ids : Iterable[UUID]
        The in-scope boreholes.

    Returns
    -------
    set[str]
        The union of their ``deleted_dov_permkeys``; ``set()`` when
        ``borehole_ids`` is empty (no query issued).
    """
    id_list = list(borehole_ids)
    if not id_list:
        return set()
    stmt = select(BoreholeOrm.deleted_dov_permkeys).where(BoreholeOrm.id.in_(id_list))
    result = await session.execute(stmt)
    return {permkey for keys in result.scalars() for permkey in (keys or []) if permkey}
