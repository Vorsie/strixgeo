"""One geotech formation row per (NAD class, litho parent) — the geological
parent is a LABEL, not identity (owner ruling 2026-08-31, R1, debt #278).

Before this ruling the geotech subdivide minted one ``geological_formation``
ROW per ``(nad_class, litho parent, GEOLOGICAL parent)`` — "deliberate
provenance" — so the same NAD class under one litho unit split into a separate
row wherever a geological boundary crossed it. Measured cost: 775 of 898
visible fence seams were these geo-label twins. The owner: *"Collapse the geo
label from geotech unit identity."*

So two bands of the same NAD class under the same litho parent but DIFFERENT
geological parents now resolve to ONE formation row; the geological parent the
band carries is attribution (the per-band ``source_geo_formation_id`` stamp, GP1
midpoint rule), never part of the row's identity. Concretely:

* the find-or-create KEY drops its geological term;
* the DB LOOKUP drops the geological filter and returns the OLDEST matching row
  (``ORDER BY created_at ASC, id ASC`` — the survivor rule the future one-time
  merge migration applies, so behaviour converges before the migration runs);
* a newly CREATED row stores no geological parent as identity
  (``source_geo_formation_id=None``).

The per-band geo attribution (``_group_segments``, ``_geo_formation_at_midpoint``,
``geo_parent_for_interval``) is deliberately UNCHANGED — only the formation ROW
identity collapses.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

from groundmodel.application.geotech_borehole_materialiser import (
    GeotechBoreholeMaterialiser,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)

PROJECT = UUID(int=1)
LITHO = UUID(int=201)
GEO_A = UUID(int=101)
GEO_B = UUID(int=102)


class _Result:
    """Minimal stand-in for a SQLAlchemy ``Result`` — only ``scalars().first()``."""

    def __init__(self, first: object | None) -> None:
        self._first = first

    def scalars(self) -> _Result:
        return self

    def first(self) -> object | None:
        return self._first


class _FakeSession:
    """A no-DB async session that returns a canned query row and records writes.

    ``execute`` returns ``query_first`` (the row the find-or-create DB lookup
    would find, or ``None`` to force a create) and captures every statement so a
    test can assert on the WHERE clause / ORDER BY. ``get`` returns the source
    litho formation the create reads its name/soil/colour from.
    """

    def __init__(self, *, query_first: object | None, source_litho: object) -> None:
        self._query_first = query_first
        self._source_litho = source_litho
        self.added: list[object] = []
        self.executed: list[object] = []

    async def execute(self, stmt: object) -> _Result:
        self.executed.append(stmt)
        return _Result(self._query_first)

    async def get(self, model: object, ident: object) -> object:
        return self._source_litho

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        return None


def _source_litho() -> SimpleNamespace:
    """A GeologicalFormationOrm-shaped stub the create copies its display data from."""
    return SimpleNamespace(
        litho_main_soil_code="ZAND",
        litho_admixtures=None,
        color="#abc123",
        name="Zand unit",
        display_order=3,
    )


def _materialiser(session: _FakeSession) -> GeotechBoreholeMaterialiser:
    """The shared materialiser wrapped around the fake session."""
    return GeotechBoreholeMaterialiser(__name__, session)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Classified formations (nad_class is not None)
# ---------------------------------------------------------------------------


async def test_gfi1_same_class_and_litho_across_geology_is_one_classified_row() -> None:
    """GFI1 — two bands, same NAD class + litho parent, different geological parent → ONE row.

    The two calls model two geotech bands of the same NAD class under one litho
    unit, on either side of a geological contact. Under the collapsed identity
    the second call reuses the first band's row; under the old
    ``(class, litho, geo)`` key it minted a second twin.
    """
    session = _FakeSession(query_first=None, source_litho=_source_litho())
    materialiser = _materialiser(session)
    cache: dict = {}

    first = await materialiser._find_or_create_classified(
        project_id=PROJECT,
        classified_by_key=cache,
        created_formation_ids=[],
        nad_class=13,
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_A,
    )
    second = await materialiser._find_or_create_classified(
        project_id=PROJECT,
        classified_by_key=cache,
        created_formation_ids=[],
        nad_class=13,
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_B,
    )

    assert second is first, "a different geological parent minted a twin row"
    assert len(session.added) == 1, "the geological parent still forked the identity"


async def test_gfi2_a_created_classified_row_stores_no_geological_parent() -> None:
    """GFI2 — the geological parent is not written as identity on create."""
    session = _FakeSession(query_first=None, source_litho=_source_litho())
    materialiser = _materialiser(session)

    created = await materialiser._find_or_create_classified(
        project_id=PROJECT,
        classified_by_key={},
        created_formation_ids=[],
        nad_class=13,
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_A,
    )

    assert created.source_geo_formation_id is None


async def test_gfi3_the_classified_db_lookup_ignores_geological_parent() -> None:
    """GFI3 — the DB lookup drops the geo filter and takes the OLDEST matching row.

    A fresh cache forces the DB path. The lookup must find the existing row
    regardless of the geological parent asked for, and its WHERE clause must no
    longer mention ``source_geo_formation_id``; the oldest row wins via
    ``ORDER BY created_at ASC, id ASC``.
    """
    existing = GeologicalFormationOrm(
        id=UUID(int=500),
        app_project_id=PROJECT,
        name="Zand unit (NAD 13)",
        nad_class=13,
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_A,
    )
    session = _FakeSession(query_first=existing, source_litho=_source_litho())
    materialiser = _materialiser(session)

    reused = await materialiser._find_or_create_classified(
        project_id=PROJECT,
        classified_by_key={},
        created_formation_ids=[],
        nad_class=13,
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_B,
    )

    assert reused is existing
    assert session.added == [], "the lookup failed to reuse the row across a geological parent"
    stmt = session.executed[-1]
    assert "source_geo_formation_id" not in str(stmt.whereclause)
    compiled = str(stmt)
    assert "ORDER BY" in compiled
    tail = compiled.split("ORDER BY", 1)[1]
    assert "created_at ASC" in tail and "id ASC" in tail


# ---------------------------------------------------------------------------
# Skeleton formations (nad_class is None — the borehole carry-through)
# ---------------------------------------------------------------------------


async def test_gfi4_same_litho_across_geology_is_one_skeleton_row() -> None:
    """GFI4 — a class-less skeleton band collapses across geology the same way."""
    session = _FakeSession(query_first=None, source_litho=_source_litho())
    materialiser = _materialiser(session)
    cache: dict = {}

    first = await materialiser._find_or_create_skeleton(
        project_id=PROJECT,
        skeleton_by_key=cache,
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_A,
    )
    second = await materialiser._find_or_create_skeleton(
        project_id=PROJECT,
        skeleton_by_key=cache,
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_B,
    )

    assert second is first
    assert len(session.added) == 1
    assert first.source_geo_formation_id is None


async def test_gfi5_the_skeleton_db_lookup_ignores_geological_parent() -> None:
    """GFI5 — the skeleton DB lookup drops the geo filter and orders oldest-first."""
    existing = GeologicalFormationOrm(
        id=UUID(int=600),
        app_project_id=PROJECT,
        name="Zand unit (geotech)",
        nad_class=None,
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_A,
    )
    session = _FakeSession(query_first=existing, source_litho=_source_litho())
    materialiser = _materialiser(session)

    reused = await materialiser._find_or_create_skeleton(
        project_id=PROJECT,
        skeleton_by_key={},
        source_litho_formation_id=LITHO,
        source_geo_formation_id=GEO_B,
    )

    assert reused is existing
    assert session.added == []
    stmt = session.executed[-1]
    assert "source_geo_formation_id" not in str(stmt.whereclause)
    compiled = str(stmt)
    assert "ORDER BY" in compiled
    tail = compiled.split("ORDER BY", 1)[1]
    assert "created_at ASC" in tail and "id ASC" in tail
