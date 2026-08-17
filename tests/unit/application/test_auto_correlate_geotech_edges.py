"""Unit tests for the standalone geotech auto-correlate verb.

The rules being pinned, in the owner's own words:

* "Same as litho" — pressing auto-correlate PROPOSES ties; it does not commit
  them.  Every edge the verb writes is UNAPPROVED, so the engineer reviews and
  promotes them with the accept verb.
* "It adds; it does not reconcile" — a correlation that already exists, whether
  the engineer drew it by hand or accepted it earlier, must be left exactly as
  it is: not deleted, not overwritten, not flipped to unapproved, not
  duplicated.  Pressing the verb must be safe at any moment, mid-way through
  correlating a 14-section model by hand.
* An edge is the same correlation whichever way round it was stored — a
  hand-drawn tie recorded from the right-hand column to the left-hand one is
  the same tie, and must be recognised as already existing.
* The verb requires a GEOTECHNICAL model; anything else is refused with a
  message that says why.
* The rule that decides which bands tie is the existing NAD-class SEQUENCE
  match inside a litho body — not a new invention.

The DB round-trip is exercised by the geotech integration tests; here the
session is a fake that answers each load from canned rows and records every
statement it is asked to execute, so "adds only" can be asserted as "no DELETE
and no UPDATE was ever issued".
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.auto_correlate_geotech_edges import AutoCorrelateGeotechEdges

PROJECT = uuid4()
GEOTECH_MODEL = uuid4()
LITHO_MODEL = uuid4()
SECTION = uuid4()

# Two investigations, each with one correlated litho unit spanning 0–10 m.
INV_A = uuid4()
INV_B = uuid4()
LITHO_A = uuid4()
LITHO_B = uuid4()


class _Rows:
    """Stands in for a SQLAlchemy ``Result`` over a list of rows."""

    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        """Return every row, mirroring ``Result.all()``."""
        return list(self._rows)

    def scalars(self) -> _Rows:
        """Return self — the canned rows are already the scalar entities."""
        return self

    def first(self) -> Any:
        """Return the first row or ``None``, mirroring ``Result.first()``."""
        return self._rows[0] if self._rows else None


class _FakeSession:
    """A session that answers each of the use case's loads from canned rows.

    Dispatch is on the compiled SQL text rather than call order, so reordering
    the loads inside the use case does not silently re-point a fixture at the
    wrong query.
    """

    def __init__(
        self,
        *,
        model: SimpleNamespace,
        geotech_bands: list[SimpleNamespace],
        litho_layers: list[SimpleNamespace],
        approved_litho_edges: list[tuple[UUID, UUID]],
        existing_geotech_edges: list[tuple[UUID, UUID, UUID]],
    ) -> None:
        self._model = model
        self._geotech_bands = geotech_bands
        self._litho_layers = litho_layers
        self._approved_litho_edges = approved_litho_edges
        self._existing_geotech_edges = existing_geotech_edges
        self.added: list[Any] = []
        self.executed_sql: list[str] = []
        self.flush = AsyncMock()
        self.commit = AsyncMock()
        self.delete = MagicMock()

    async def get(self, _orm_class: type, _entity_id: UUID) -> SimpleNamespace:
        """Return the canned model row for the scope guard."""
        return self._model

    def add(self, obj: Any) -> None:
        """Record an ORM row the use case wants to insert."""
        self.added.append(obj)

    async def execute(self, stmt: Any) -> _Rows:
        """Answer a SELECT from the canned rows chosen by the statement's tables."""
        sql = str(stmt)
        self.executed_sql.append(sql)
        if "geotech_tie_tombstone" in sql:
            # No deletions recorded in these scenes — build_tombstone_gates
            # answers an empty gate map and the derivation runs ungated.
            return _Rows([])
        if "cross_section" in sql:
            return _Rows([SimpleNamespace(id=SECTION, name="CS1", display_order=0)])
        if "litho_contact_correlation_edge" in sql:
            # Dispatch on the SELECT LIST, not the WHERE clause: three loaders
            # read this table and two of them filter on ``user_approved``, so a
            # where-clause test hands the approved-litho fixture (4 columns) to
            # a by-section loader that unpacks 5 and blows up.
            # SQLAlchemy compiles with a newline before FROM, so split on the
            # bare keyword rather than a space-padded one.
            select_list = sql.split("FROM")[0]
            if "section_id" in select_list:
                if "layer_a_side" in select_list:
                    # The sided by-section loaders (all edges, and the
                    # approved-only seed for the crossing guard) — no canned
                    # sided geotech rows in these scenes.
                    return _Rows([])
                return _Rows(list(self._existing_geotech_edges))
            # load_approved_litho_edge_sets selects the sides too; the
            # canned pairs are plain top↔top litho ties.
            return _Rows([(a, b, "top", "top") for a, b in self._approved_litho_edges])
        if "geological_formation" in sql:
            return _Rows(list(self._geotech_bands))
        return _Rows(list(self._litho_layers))


def _band(inv_id: UUID, top: float, base: float, nad_class: int | None) -> SimpleNamespace:
    """One geotech packing sub-band on a CPT column."""
    return SimpleNamespace(
        cpt_id=inv_id,
        borehole_id=None,
        depth_top_m=top,
        depth_base_m=base,
        id=uuid4(),
        formation_id=uuid4(),
        nad_class=nad_class,
    )


def _litho_layer(layer_id: UUID, inv_id: UUID) -> SimpleNamespace:
    """One accepted litho unit spanning 0–10 m on an investigation."""
    return SimpleNamespace(
        id=layer_id,
        borehole_id=None,
        cpt_id=inv_id,
        depth_top_m=0.0,
        depth_base_m=10.0,
    )


def _model(kind: str = "geotechnical") -> SimpleNamespace:
    """The geotech model row the scope guard loads."""
    return SimpleNamespace(
        id=GEOTECH_MODEL,
        app_project_id=PROJECT,
        kind=kind,
        parent_model_id=LITHO_MODEL,
        name="Model — geotechnical",
    )


def _session(
    *,
    kind: str = "geotechnical",
    left_bands: list[SimpleNamespace] | None = None,
    right_bands: list[SimpleNamespace] | None = None,
    existing_geotech_edges: list[tuple[UUID, UUID, UUID]] | None = None,
) -> _FakeSession:
    """A fake session for one section holding one correlated litho unit pair."""
    left = left_bands if left_bands is not None else [_band(INV_A, 0.0, 10.0, 5)]
    right = right_bands if right_bands is not None else [_band(INV_B, 0.0, 10.0, 5)]
    return _FakeSession(
        model=_model(kind),
        geotech_bands=[*left, *right],
        litho_layers=[_litho_layer(LITHO_A, INV_A), _litho_layer(LITHO_B, INV_B)],
        approved_litho_edges=[(LITHO_A, LITHO_B)],
        existing_geotech_edges=existing_geotech_edges or [],
    )


# ---------------------------------------------------------------------------
# It proposes; the engineer promotes.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_restating_edge_is_born_accepted_and_counted_as_such() -> None:
    """RE-PINNED (owner refinement of ruling A, 2026-08-06): "all ties are born
    unaccepted except those that are already ties in the litho model".

    The default scene is an unsubdivided litho pair — its single derived edge
    joins the very contact surfaces the engineer tied at the litho level, so it
    is the litho tie RESTATED: born accepted, counted in ``edges_accepted``,
    NOT in ``edges_proposed`` (which now counts only the pending ghosts). What
    must NOT change is provenance: ``source`` stays ``'auto'`` so hand and
    machine work remain distinguishable (the 2026-08-01 bug was stamping
    derived ties as hand-made, and a rebuild destroyed both).
    """
    session = _session()

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    assert result.edges_proposed == 0
    assert result.edges_accepted == 1
    assert len(session.added) == 1
    edge = session.added[0]
    assert edge.user_approved is True
    assert edge.source == "auto"
    assert edge.model_id == GEOTECH_MODEL
    assert edge.section_id == SECTION


# ---------------------------------------------------------------------------
# It adds; it does not reconcile.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_hand_drawn_correlation_survives_untouched() -> None:
    """A tie the engineer already drew is left exactly as it is.

    The owner is mid-way through correlating by hand.  Pressing this verb must
    not delete his work, must not flip it back to unapproved, and must not add
    a second edge alongside it.
    """
    left = _band(INV_A, 0.0, 10.0, 5)
    right = _band(INV_B, 0.0, 10.0, 5)
    # The engineer already tied these two bands by hand on this section.
    session = _session(
        left_bands=[left],
        right_bands=[right],
        existing_geotech_edges=[(SECTION, min(left.id, right.id), max(left.id, right.id))],
    )

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    assert result.edges_proposed == 0
    assert result.edges_skipped_existing == 1
    assert session.added == []
    # Nothing was removed or rewritten — every statement the verb issued is a
    # read, and the only write path it has is ``session.add``.
    assert session.executed_sql, "the verb must at least have read the model"
    assert all(sql.lstrip().upper().startswith("SELECT") for sql in session.executed_sql)
    session.delete.assert_not_called()


@pytest.mark.asyncio
async def test_an_existing_tie_stored_the_other_way_round_still_counts_as_existing() -> None:
    """The same tie recorded right-to-left is the same tie — do not duplicate it.

    Correlations are undirected.  An edge persisted as B↔A must suppress the
    A↔B proposal, or every press of the verb would stack another copy of the
    engineer's own work on top of it.
    """
    left = _band(INV_A, 0.0, 10.0, 5)
    right = _band(INV_B, 0.0, 10.0, 5)
    hi, lo = max(left.id, right.id), min(left.id, right.id)
    # Stored with the endpoints the other way round from the canonical order.
    session = _session(
        left_bands=[left],
        right_bands=[right],
        existing_geotech_edges=[(SECTION, hi, lo)],
    )

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    assert result.edges_proposed == 0
    assert result.edges_skipped_existing == 1
    assert session.added == []


# ---------------------------------------------------------------------------
# The model kind guard.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_lithostratigraphic_model_is_refused_with_a_reason() -> None:
    """The verb requires a geotechnical model and says so when handed another kind."""
    session = _session(kind="lithostratigraphic")

    with pytest.raises(ValueError, match="geotechnical"):
        await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
            project_id=PROJECT, model_id=GEOTECH_MODEL
        )

    assert session.added == []
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_geotech_model_without_a_litho_parent_is_refused() -> None:
    """The rule reads the litho model's approved ties, so a parentless model is refused."""
    session = _session()
    session._model.parent_model_id = None

    with pytest.raises(ValueError, match="parent"):
        await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
            project_id=PROJECT, model_id=GEOTECH_MODEL
        )

    assert session.added == []


# ---------------------------------------------------------------------------
# The rule is the existing NAD-class sequence match.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bands_tie_by_the_nad_class_sequence_match_inside_the_litho_unit() -> None:
    """Two unequal packing stacks tie on their longest shared class sequence.

    ``[6, 6, 7, 8]`` against ``[6, 8, 5]`` shares the ordered subsequence
    ``6, 8`` — so exactly two ties.  A rule that required identical stacks would
    tie nothing here; a rule that matched on depth overlap would tie three or
    four.  The ambiguous ``6`` resolves to the TOPMOST of the left column's two
    6-bands (owner refinement 2026-08-06): the top pairing is the litho tie
    restated, so it is born accepted — which is why exactly ONE of the two ties
    counts as proposed here. (The pre-2026-08-06 traceback preferred the
    DEEPER 6, tying a surface band past its shallow twin for no reason.)
    """
    left = [
        _band(INV_A, 0.0, 2.5, 6),
        _band(INV_A, 2.5, 5.0, 6),
        _band(INV_A, 5.0, 7.5, 7),
        _band(INV_A, 7.5, 10.0, 8),
    ]
    right = [
        _band(INV_B, 0.0, 3.3, 6),
        _band(INV_B, 3.3, 6.6, 8),
        _band(INV_B, 6.6, 10.0, 5),
    ]
    session = _session(left_bands=left, right_bands=right)

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    assert result.edges_proposed == 1
    assert result.edges_accepted == 1
    tied = {frozenset((e.layer_a_id, e.layer_b_id)) for e in session.added}
    assert tied == {
        frozenset((left[0].id, right[0].id)),  # 6 ↔ 6 (tops — the restated tie)
        frozenset((left[3].id, right[1].id)),  # 8 ↔ 8
    }
    # The 7 on the left and the 5 on the right have no counterpart — they stay
    # unconnected for the engineer to tie by hand.
    assert left[2].id not in {e.layer_a_id for e in session.added} | {
        e.layer_b_id for e in session.added
    }


@pytest.mark.asyncio
async def test_a_band_with_no_packing_class_is_never_auto_tied() -> None:
    """A skeleton band (no qc, so no NAD class) never auto-ties, not even to another."""
    session = _session(
        left_bands=[_band(INV_A, 0.0, 10.0, None)],
        right_bands=[_band(INV_B, 0.0, 10.0, None)],
    )

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    assert result.edges_proposed == 0
    assert session.added == []


# ---------------------------------------------------------------------------
# Counts the frontend toasts.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_counts_separate_what_was_proposed_from_what_already_existed() -> None:
    """The result reports proposed ties and ties skipped because they existed."""
    left = [_band(INV_A, 0.0, 5.0, 6), _band(INV_A, 5.0, 10.0, 8)]
    right = [_band(INV_B, 0.0, 5.0, 6), _band(INV_B, 5.0, 10.0, 8)]
    # The 6↔6 tie is already drawn; only the 8↔8 tie is new.
    session = _session(
        left_bands=left,
        right_bands=right,
        existing_geotech_edges=[
            (SECTION, min(left[0].id, right[0].id), max(left[0].id, right[0].id))
        ],
    )

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    assert result.edges_proposed == 1
    assert result.edges_skipped_existing == 1
    assert result.sections_processed == 1
    assert len(session.added) == 1
    assert session.added[0].layer_a_id in {left[1].id, right[1].id}
    session.commit.assert_awaited()
