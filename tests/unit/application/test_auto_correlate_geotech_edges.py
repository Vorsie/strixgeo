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

# A third column the section does NOT draw — the owner's 1411-GEO-23/126-B6 on
# Tie-section 7, reproduced to scale below.
INV_OFF = uuid4()
LITHO_OFF = uuid4()

# The section line, shaped like Tie-section 7: 62 m long, 7 m corridor.
SECTION_START = (0.0, 0.0)
SECTION_END = (62.0, 0.0)
SECTION_BUFFER_M = 7.0

# Where each column stands in the map plane.  ``INV_OFF`` repeats B6's real
# geometry: 2.41 m off the line — comfortably inside the 7 m corridor — but
# 1.84 m BEFORE the start endpoint, so the section never draws it.
LOCATIONS: dict[UUID, tuple[float, float]] = {
    INV_A: (0.0, 0.0),
    INV_B: (62.0, 0.0),
    INV_OFF: (-1.838, 2.414),
}

# Display names, so the "excluded N column(s)" log line can name what it left
# out instead of printing a uuid at the engineer.
NAMES: dict[UUID, str] = {INV_A: "S4", INV_B: "S9", INV_OFF: "B6"}


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

    def scalar_one_or_none(self) -> Any:
        """Return the single row or ``None``, mirroring ``Result.scalar_one_or_none()``."""
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
        locations: dict[UUID, tuple[float, float]],
        model_geotech_edges: list[SimpleNamespace] | None = None,
        model_frame_edges: list[SimpleNamespace] | None = None,
    ) -> None:
        self._model = model
        self._geotech_bands = geotech_bands
        self._litho_layers = litho_layers
        self._approved_litho_edges = approved_litho_edges
        self._existing_geotech_edges = existing_geotech_edges
        self._locations = locations
        # The rows the off-section sweep judges. Kept apart from
        # ``existing_geotech_edges`` (which answers the pair-only dedup loader)
        # because the two loaders read different column sets; a scene that
        # cares about the sweep supplies these explicitly.
        self._model_geotech_edges = model_geotech_edges or []
        # The FULL edge entities the frame-conformance flag re-reads after the
        # sweeps (the only edge loader that selects ``review_reason``). Empty by
        # default, so an ordinary scene proposes no frame-flagged tie.
        self._model_frame_edges = model_frame_edges or []
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
            return _Rows([_section_row()])
        select_list = sql.split("FROM")[0]
        if "cpt.location_x" in select_list:
            return _Rows(self._location_rows(cpt=True))
        if "borehole.location_x" in select_list:
            return _Rows(self._location_rows(cpt=False))
        if "cpt.name" in select_list:
            return _Rows(
                [SimpleNamespace(id=inv_id, name=NAMES[inv_id]) for inv_id in self._locations]
            )
        if "borehole.name" in select_list:
            return _Rows([])
        if "litho_contact_correlation_edge" in sql:
            # Dispatch on the SELECT LIST, not the WHERE clause: four loaders
            # read this table and two of them filter on ``user_approved``, so a
            # where-clause test hands the approved-litho fixture (4 columns) to
            # a by-section loader that unpacks 5 and blows up.
            # SQLAlchemy compiles with a newline before FROM, so split on the
            # bare keyword rather than a space-padded one.
            if "review_reason" in select_list:
                # The frame-conformance flag re-reads the FULL edge entity — the
                # only edge loader that selects ``review_reason`` — to stamp the
                # badge after the sweeps. Empty in ordinary scenes.
                return _Rows(list(self._model_frame_edges))
            if "section_id" in select_list:
                if "user_approved" in select_list and "source" in select_list:
                    # The off-section sweep — the only loader that reads the
                    # provenance AND the approval alongside the section.
                    return _Rows(list(self._model_geotech_edges))
                if "layer_a_side" in select_list:
                    # The sided by-section loaders (all edges, the approved-only
                    # seed for the crossing guard, and the crossing sweep) — no
                    # canned sided geotech rows in these scenes.
                    return _Rows([])
                return _Rows(list(self._existing_geotech_edges))
            if "layer_a_id" not in select_list:
                # ``_load_edge_ids``: the pre-derivation id snapshot the frame
                # flag diffs against — just the model's edge ids.
                return _Rows([(edge.id,) for edge in self._model_frame_edges])
            # load_approved_litho_edge_sets selects the sides too; the
            # canned pairs are plain top↔top litho ties.
            return _Rows([(a, b, "top", "top") for a, b in self._approved_litho_edges])
        if "geological_formation" in sql:
            return _Rows(list(self._geotech_bands))
        if "depth_top_m" not in select_list:
            # The sweep's band → investigation map: the same geotech band rows,
            # read without their depths.
            return _Rows(list(self._geotech_bands))
        return _Rows(list(self._litho_layers))

    def _location_rows(self, *, cpt: bool) -> list[SimpleNamespace]:
        """Map-plane locations, all on CPT columns in these scenes."""
        if not cpt:
            return []
        return [
            SimpleNamespace(id=inv_id, location_x=x, location_y=y)
            for inv_id, (x, y) in self._locations.items()
        ]


def _section_row() -> SimpleNamespace:
    """The cross-section row both the section loader and the projection read."""
    return SimpleNamespace(
        id=SECTION,
        name="CS1",
        display_order=0,
        start_x=SECTION_START[0],
        start_y=SECTION_START[1],
        end_x=SECTION_END[0],
        end_y=SECTION_END[1],
        projection_buffer_m=SECTION_BUFFER_M,
        excluded_cpt_ids=[],
        excluded_borehole_ids=[],
    )


def _persisted_edge(
    layer_a_id: UUID,
    layer_b_id: UUID,
    *,
    source: str = "auto",
    user_approved: bool = False,
) -> SimpleNamespace:
    """One geotech edge already stored on the section, as the sweep reads it."""
    return SimpleNamespace(
        id=uuid4(),
        section_id=SECTION,
        source=source,
        user_approved=user_approved,
        layer_a_id=layer_a_id,
        layer_b_id=layer_b_id,
    )


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
    off_bands: list[SimpleNamespace] | None = None,
    model_geotech_edges: list[SimpleNamespace] | None = None,
) -> _FakeSession:
    """A fake session for one section holding one correlated litho unit pair.

    ``off_bands`` adds the third column ``INV_OFF``, which stands inside the
    section's corridor but past its start endpoint — correlated to ``INV_A`` at
    the litho level, exactly as the owner's B6 is on Tie-section 7.
    """
    left = left_bands if left_bands is not None else [_band(INV_A, 0.0, 10.0, 5)]
    right = right_bands if right_bands is not None else [_band(INV_B, 0.0, 10.0, 5)]
    off = off_bands or []
    litho_layers = [_litho_layer(LITHO_A, INV_A), _litho_layer(LITHO_B, INV_B)]
    approved: list[tuple[UUID, UUID]] = [(LITHO_A, LITHO_B)]
    if off:
        litho_layers.append(_litho_layer(LITHO_OFF, INV_OFF))
        approved.append((LITHO_A, LITHO_OFF))
    return _FakeSession(
        model=_model(kind),
        geotech_bands=[*left, *right, *off],
        litho_layers=litho_layers,
        approved_litho_edges=approved,
        existing_geotech_edges=existing_geotech_edges or [],
        locations=dict(LOCATIONS),
        model_geotech_edges=model_geotech_edges,
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


# ---------------------------------------------------------------------------
# Section scoping (owner ruling 2026-08-25: "yeah make it section scoped
# ofcourse", shown a pending machine tie from GEO-10/170-S4 to
# 1411-GEO-23/126-B6 on Tie-section 7 — a section that does not draw B6).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_column_past_the_endpoint_is_not_on_the_section_so_nothing_ties_to_it() -> None:
    """A column inside the corridor but past the section's end is not a member.

    ``INV_OFF`` stands 2.41 m from the section line — well inside the 7 m
    corridor — but 1.84 m BEFORE the start endpoint, so the section never draws
    it.  Being on the section means "in the corridor AND between the two
    endpoints the engineer drew", which is the same rule the section view, the
    exports and "Divide boreholes" already use.  A correlation the engineer
    cannot see on this section must therefore never be proposed here, however
    the litho model happens to be correlated.
    """
    session = _session(off_bands=[_band(INV_OFF, 0.0, 10.0, 5)])

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    off_band_ids = {band.id for band in session._geotech_bands if band.cpt_id == INV_OFF}
    touched = {edge.layer_a_id for edge in session.added} | {
        edge.layer_b_id for edge in session.added
    }
    assert touched.isdisjoint(off_band_ids), (
        "an edge was proposed to a column the section does not draw"
    )
    assert result.investigations_off_section == 1


@pytest.mark.asyncio
async def test_a_column_inside_the_corridor_and_between_the_endpoints_still_ties() -> None:
    """The control: membership excludes the off-section column and nothing else.

    ``INV_A`` and ``INV_B`` sit at the two endpoints, on the line.  Their tie
    must survive the scoping change untouched — the gate has to remove the
    column the section does not draw, not the section's own columns.
    """
    session = _session(off_bands=[_band(INV_OFF, 0.0, 10.0, 5)])

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    on_section_bands = {band.id for band in session._geotech_bands if band.cpt_id in {INV_A, INV_B}}
    assert len(session.added) == 1
    edge = session.added[0]
    assert {edge.layer_a_id, edge.layer_b_id} <= on_section_bands
    assert result.edges_accepted == 1
    assert result.sections_processed == 1


@pytest.mark.asyncio
async def test_a_mis_scoped_machine_proposal_is_removed_by_the_run() -> None:
    """A pending machine tie to a column the section does not draw is swept.

    The owner's Tie-section 7 carries exactly this row: ``source='auto'``,
    ``user_approved=false``, one endpoint on a column the section never draws.
    It cannot be reviewed where it lives, so the run that re-proposes the
    section's ties removes it.  The pair legitimately belongs on the section
    that DOES draw both columns, and that section's own run re-proposes it
    there.
    """
    off_band = _band(INV_OFF, 0.0, 10.0, 5)
    on_band = _band(INV_A, 0.0, 10.0, 5)
    session = _session(
        left_bands=[on_band],
        off_bands=[off_band],
        model_geotech_edges=[_persisted_edge(on_band.id, off_band.id)],
    )

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    assert result.offsection_ties_deleted == 1
    assert result.offsection_ties_retained == 0
    assert any(sql.lstrip().upper().startswith("DELETE") for sql in session.executed_sql)


@pytest.mark.asyncio
async def test_the_sweep_never_deletes_an_accepted_or_hand_drawn_tie() -> None:
    """An accepted or hand-drawn mis-scoped tie is reported, never removed.

    The sweep only ever takes back what the machine proposed and nobody
    approved.  A tie the engineer accepted — or drew himself — is his
    statement about the ground; the run counts it, warns, and leaves the row
    exactly as it is for him to judge.
    """
    off_band = _band(INV_OFF, 0.0, 10.0, 5)
    on_band = _band(INV_A, 0.0, 10.0, 5)
    session = _session(
        left_bands=[on_band],
        off_bands=[off_band],
        model_geotech_edges=[
            _persisted_edge(on_band.id, off_band.id, user_approved=True),
            _persisted_edge(on_band.id, off_band.id, source="manual"),
        ],
    )

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    assert result.offsection_ties_deleted == 0
    assert result.offsection_ties_retained == 2
    assert not any(sql.lstrip().upper().startswith("DELETE") for sql in session.executed_sql)


@pytest.mark.asyncio
async def test_a_tie_whose_layer_cannot_be_placed_is_not_treated_as_off_section() -> None:
    """An UNPLACEABLE endpoint is a diagnosed skip, not a membership failure.

    A litho tie naming a layer the depth map does not carry (a suggestion, or a
    row deleted mid-flight) cannot be resolved to a column at all.  The
    membership gate must let it through, so the derivation still counts and
    logs it as a no-litho-depth skip: swallowing it here would trade a
    diagnosed skip for a silent one, and would also count a column as
    "off-section" that nothing ever placed.
    """
    session = _session()
    # Drop INV_B's litho unit from the depth map, leaving the approved
    # S4 <-> S9 tie naming a layer nothing can place on a column.
    session._litho_layers = [layer for layer in session._litho_layers if layer.id != LITHO_B]

    result = await AutoCorrelateGeotechEdges(session).execute(  # type: ignore[arg-type]
        project_id=PROJECT, model_id=GEOTECH_MODEL
    )

    # The section was still EXAMINED — the tie reached the derivation, which is
    # where the no-litho-depth skip is counted and logged.  A membership gate
    # that swallowed the tie would leave the section unprocessed and the skip
    # unreported anywhere.
    assert result.sections_processed == 1
    assert result.investigations_off_section == 0
    assert session.added == []
