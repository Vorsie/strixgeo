"""Unit tests for ``SubdivideAllBodies._delete_all_geotech_data``.

The clean/dirty rule (owner, 2026-08-01): anything the program generated that
the user has not accepted is dirty and may be regenerated freely; anything the
user accepted is clean and the system never deletes it.  The model-wide reset
that opens every re-subdivide is the machine's biggest delete, so it is where
the rule has to be visible.

These tests read the SQL the reset emits rather than its effect on rows — the
rule lives in a WHERE clause, and a mock session lets us pin it without a
database.  What the reset does to an approved edge *in the database* is a
different and darker question, answered by the integration test
``test_geotech_delete_pass_cascade`` and by the module comment at the layer
delete: the edge's endpoints are geotech layers, the layer wipe removes them,
and ``ON DELETE CASCADE`` takes the spared edge with them.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies


def _mock_session() -> MagicMock:
    """A session whose ``execute``/``flush`` are awaitable and record their calls."""
    session = MagicMock()
    result = MagicMock()
    result.scalar_one = MagicMock(return_value=0)
    session.execute = AsyncMock(return_value=result)
    session.flush = AsyncMock()
    return session


def _emitted_sql(session: MagicMock) -> list[str]:
    """Render every statement the reset passed to ``session.execute``.

    Returns
    -------
    list[str]
        One compiled SQL string per ``execute`` call, in call order, with bind
        parameters inlined so a WHERE predicate is readable.
    """
    rendered: list[str] = []
    for call in session.execute.await_args_list:
        statement = call.args[0]
        rendered.append(str(statement.compile(compile_kwargs={"literal_binds": True})))
    return rendered


def _statements_against(sql: list[str], table: str, verb: str = "DELETE") -> list[str]:
    """Every rendered statement of ``verb`` against ``table``."""
    return [s for s in sql if s.lstrip().upper().startswith(verb) and table in s]


@pytest.mark.asyncio
async def test_the_reset_spares_a_tie_the_engineer_accepted() -> None:
    """The reset's edge delete leaves accepted ties alone.

    A re-subdivide is the machine regenerating its own work.  It may take back
    anything it proposed and the engineer never accepted; it may not take back
    what he accepted.  So the delete carries an acceptance predicate — without
    one, an afternoon of hand-connecting is gone the moment the engineer
    re-subdivides, which is the failure this rule was written for.
    """
    session = _mock_session()
    await SubdivideAllBodies(session)._delete_all_geotech_data(uuid4())

    edge_deletes = _statements_against(_emitted_sql(session), "litho_contact_correlation_edge")
    assert len(edge_deletes) == 1, (
        f"expected exactly one delete against the edge table, got {len(edge_deletes)}"
    )
    assert "user_approved" in edge_deletes[0], (
        "the reset deletes every geotech edge with no acceptance predicate — "
        "accepted ties are destroyed alongside the machine's own proposals.\n"
        f"emitted: {edge_deletes[0]}"
    )


@pytest.mark.asyncio
async def test_the_reset_still_clears_ties_nobody_accepted() -> None:
    """Sparing the accepted ones must not spare the pending ones too.

    Pending ties are the machine's own proposals from the previous run.  The
    re-subdivide is about to propose a fresh set from fresh bands; leaving the
    stale ones behind would accumulate proposals against layers that no longer
    exist.  The predicate therefore selects the *unaccepted* rows, and does not
    merely mention the column.
    """
    session = _mock_session()
    await SubdivideAllBodies(session)._delete_all_geotech_data(uuid4())

    edge_delete = _statements_against(_emitted_sql(session), "litho_contact_correlation_edge")[0]
    normalised = " ".join(edge_delete.split()).lower()
    assert "user_approved is false" in normalised, (
        "the edge delete must target the UNACCEPTED rows — a predicate that "
        "spares everything would leave last run's stale proposals behind.\n"
        f"emitted: {edge_delete}"
    )
