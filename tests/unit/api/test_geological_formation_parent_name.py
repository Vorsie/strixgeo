"""Unit tests for the ``parent_formation_name`` server-side enrichment.

Debt #67 resolution (Slice 5): the field is a compute-on-read derived value
populated from the project formation set (Data Integrity Rule §1).  No lazy
SQLAlchemy relationship is used — all three cases covered here verify the
pure in-memory resolution helpers in
``groundmodel.api.routers.geology.formations``.

Claims:
  N1  Schema field present with default None — additive, backwards-compat safe.
  N2  Geological-model formation (parent_formation_id=None) → name is None.
  N3  Litho unit with a known parent → name is resolved from the map.
  N4  Litho unit whose parent id is absent from the map (orphan) → None, no raise.
  N5  No SQLAlchemy relationship named ``parent_formation`` on the ORM — the
      resolver cannot trigger a lazy load / MissingGreenlet path.
  N6  _enrich_formation_list builds the self-referential map from the SAME list
      (parent + child in one pass).
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from groundmodel.api.routers.geology.formations import (
    _build_parent_code_map,
    _build_parent_name_map,
    _enrich_formation,
    _enrich_formation_list,
)
from groundmodel.api.schemas.project.geological_formation import (
    GeologicalFormationResponse,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)

# ---------------------------------------------------------------------------
# Minimal ORM-like row factory (avoids touching the DB)
# ---------------------------------------------------------------------------

_NOW = datetime.now(UTC)


def _make_orm(
    *,
    id=None,  # noqa: A002 — shadows builtin in tests intentionally
    app_project_id=None,
    name: str = "Test Formation",
    color: str = "#aabbcc",
    code=None,
    display_order: int = 0,
    pinned_order: bool = False,
    regional_ref=None,
    description=None,
    lithology=None,
    nad_class=None,
    parent_formation_id=None,
    litho_main_soil_code=None,
    litho_admixtures=None,
    instance_ordinal=None,
    instance_ordinal_locked: bool = False,
) -> SimpleNamespace:
    """Build a SimpleNamespace that mimics a ``GeologicalFormationOrm`` row.

    ``GeologicalFormationResponse.model_validate`` works via
    ``from_attributes=True`` — it reads ``row.<field>`` rather than
    ``row["field"]``, so ``SimpleNamespace`` is equivalent to an ORM instance
    for validation purposes.  This avoids touching the DB.

    Parameters
    ----------
    id : UUID | None
        Row primary key; auto-generated when omitted.
    app_project_id : UUID | None
        Project owner; auto-generated when omitted.
    name : str
        Formation display name.
    parent_formation_id : UUID | None
        Self-FK pointing at the parent geological formation.

    Returns
    -------
    SimpleNamespace
        Duck-typed attribute container compatible with Pydantic
        ``from_attributes`` validation.
    """
    return SimpleNamespace(
        id=id or uuid4(),
        app_project_id=app_project_id or uuid4(),
        name=name,
        color=color,
        code=code,
        display_order=display_order,
        pinned_order=pinned_order,
        regional_ref=regional_ref,
        description=description,
        lithology=lithology,
        nad_class=nad_class,
        parent_formation_id=parent_formation_id,
        litho_main_soil_code=litho_main_soil_code,
        litho_admixtures=litho_admixtures,
        instance_ordinal=instance_ordinal,
        instance_ordinal_locked=instance_ordinal_locked,
        parent_formation_name=None,  # not an ORM column — present so model_validate finds it
        parent_formation_code=None,  # not an ORM column — server-resolved, defaults None
        created_at=_NOW,
        updated_at=_NOW,
    )


# ---------------------------------------------------------------------------
# N1 — Schema field present and defaults None
# ---------------------------------------------------------------------------


def test_n1_parent_formation_name_field_defaults_none() -> None:
    """``GeologicalFormationResponse`` schema has ``parent_formation_name: str | None = None``."""
    row = _make_orm()
    response = GeologicalFormationResponse.model_validate(row)
    # Field must be present (not missing) and default to None.
    assert hasattr(response, "parent_formation_name")
    assert response.parent_formation_name is None


# ---------------------------------------------------------------------------
# N2 — Geological formation (parent_formation_id=None) → name is None
# ---------------------------------------------------------------------------


def test_n2_geological_formation_parent_name_is_none() -> None:
    """A geological-model formation row has parent_formation_id=None → name=None."""
    project_id = uuid4()
    geo_row = _make_orm(app_project_id=project_id, name="Boom Klei", parent_formation_id=None)

    name_map = _build_parent_name_map([geo_row])  # type: ignore[arg-type]
    enriched = _enrich_formation(geo_row, name_map)  # type: ignore[arg-type]

    assert enriched.parent_formation_name is None


# ---------------------------------------------------------------------------
# N3 — Litho unit with known parent → name resolved
# ---------------------------------------------------------------------------


def test_n3_litho_unit_parent_name_resolved() -> None:
    """A litho unit whose parent_formation_id is in the map gets the parent name."""
    project_id = uuid4()
    parent_id = uuid4()

    geo_row = _make_orm(id=parent_id, app_project_id=project_id, name="Diest Zand")
    litho_row = _make_orm(
        app_project_id=project_id,
        name="ZAND",
        parent_formation_id=parent_id,
        litho_main_soil_code="ZAND",
    )

    # Both in the same project list.
    name_map = _build_parent_name_map([geo_row, litho_row])  # type: ignore[arg-type]
    enriched = _enrich_formation(litho_row, name_map)  # type: ignore[arg-type]

    assert enriched.parent_formation_name == "Diest Zand"


# ---------------------------------------------------------------------------
# N4 — Orphan litho unit (parent id not in map) → None, no raise
# ---------------------------------------------------------------------------


def test_n4_orphan_litho_unit_returns_none_gracefully() -> None:
    """A litho unit whose parent was deleted (id not in map) → None without raising."""
    project_id = uuid4()
    orphan_parent_id = uuid4()  # not in the project list

    litho_row = _make_orm(
        app_project_id=project_id,
        name="KLEI",
        parent_formation_id=orphan_parent_id,
        litho_main_soil_code="KLEI",
    )

    # Empty map — the parent id won't resolve.
    name_map: dict = {}
    enriched = _enrich_formation(litho_row, name_map)  # type: ignore[arg-type]

    assert enriched.parent_formation_name is None


# ---------------------------------------------------------------------------
# N5 — No ORM relationship named ``parent_formation`` on GeologicalFormationOrm
# ---------------------------------------------------------------------------


def test_n5_no_parent_formation_relationship_on_orm() -> None:
    """GeologicalFormationOrm must not have a ``parent_formation`` relationship.

    A relationship would let Pydantic's ``from_attributes`` lazily walk it,
    which raises ``MissingGreenlet`` on an async session.  The enrichment
    MUST resolve the name via the pre-built in-memory map only.
    """
    mapper = GeologicalFormationOrm.__mapper__
    relationship_keys = set(mapper.relationships.keys())
    # Known legitimate relationships (contacts + units cascade) — these are
    # explicitly NOT loaded during the enrichment path.
    assert "parent_formation" not in relationship_keys, (
        "A 'parent_formation' relationship was added to GeologicalFormationOrm — "
        "this would allow Pydantic from_attributes to lazily walk it and raise "
        "MissingGreenlet on an async session. Resolve parent names via the "
        "in-memory map instead."
    )


# ---------------------------------------------------------------------------
# N6 — _enrich_formation_list self-referential map (parent + child in one pass)
# ---------------------------------------------------------------------------


def test_n6_enrich_formation_list_self_referential() -> None:
    """_enrich_formation_list resolves names across parent + litho units in one call."""
    project_id = uuid4()
    parent_id = uuid4()

    geo = _make_orm(id=parent_id, app_project_id=project_id, name="Boom Klei")
    litho_a = _make_orm(
        app_project_id=project_id,
        name="KLEI",
        parent_formation_id=parent_id,
        litho_main_soil_code="KLEI",
    )
    litho_b = _make_orm(
        app_project_id=project_id,
        name="ZAND",
        parent_formation_id=parent_id,
        litho_main_soil_code="ZAND",
    )

    results = _enrich_formation_list([geo, litho_a, litho_b])  # type: ignore[arg-type]

    assert len(results) == 3
    # Geological formation — no parent.
    geo_resp = next(r for r in results if r.id == geo.id)
    assert geo_resp.parent_formation_name is None

    # Both litho units reference the same parent.
    for resp in [r for r in results if r.parent_formation_id == parent_id]:
        assert resp.parent_formation_name == "Boom Klei"


# ---------------------------------------------------------------------------
# N7 — parent_formation_code resolved from the parent's DOV code
# ---------------------------------------------------------------------------


def test_n7_litho_unit_parent_code_resolved() -> None:
    """A litho unit's parent_formation_code resolves from the parent's ``code``.

    Drives the lens auto-name ``{parent code}{lithology abbrev}{depth rank}``
    (e.g. ``QPSa1``).
    """
    project_id = uuid4()
    parent_id = uuid4()

    geo_row = _make_orm(
        id=parent_id,
        app_project_id=project_id,
        name="Quartair: Pleistocene afzettingen",
        code="QP",
    )
    litho_row = _make_orm(
        app_project_id=project_id,
        name="ZAND",
        parent_formation_id=parent_id,
        lithology="ZAND",
    )

    name_map = _build_parent_name_map([geo_row, litho_row])  # type: ignore[arg-type]
    code_map = _build_parent_code_map([geo_row, litho_row])  # type: ignore[arg-type]
    enriched = _enrich_formation(litho_row, name_map, code_map)  # type: ignore[arg-type]

    assert enriched.parent_formation_code == "QP"
    # _enrich_formation_list resolves it too (same self-referential map).
    listed = _enrich_formation_list([geo_row, litho_row])  # type: ignore[arg-type]
    litho_resp = next(r for r in listed if r.parent_formation_id == parent_id)
    assert litho_resp.parent_formation_code == "QP"


def test_n8_parent_code_none_when_code_map_omitted() -> None:
    """``_enrich_formation`` without a code_map leaves parent_formation_code None.

    Pins the backwards-compatible optional ``code_map`` parameter.
    """
    project_id = uuid4()
    parent_id = uuid4()
    geo_row = _make_orm(id=parent_id, app_project_id=project_id, name="Diest", code="D")
    litho_row = _make_orm(
        app_project_id=project_id, name="ZAND", parent_formation_id=parent_id, lithology="ZAND"
    )
    name_map = _build_parent_name_map([geo_row, litho_row])  # type: ignore[arg-type]
    enriched = _enrich_formation(litho_row, name_map)  # type: ignore[arg-type]  # no code_map
    assert enriched.parent_formation_code is None


def test_n9_parent_code_resolved_from_regional_ref() -> None:
    """ "Fill from boreholes" stores the formal code in ``regional_ref`` → resolved.

    The parent has no manual ``code`` link but its ``regional_ref`` carries the
    DOV formal-stratigraphy code "QP"; the resolver canonicalises it through the
    formal lexicon so the litho child's ``parent_formation_code`` is "QP".
    """
    project_id = uuid4()
    parent_id = uuid4()
    geo_row = _make_orm(
        id=parent_id,
        app_project_id=project_id,
        name="Quartair: Pleistocene afzettingen",
        code=None,
        regional_ref="QP",
    )
    litho_row = _make_orm(
        app_project_id=project_id,
        name="ZAND",
        parent_formation_id=parent_id,
        lithology="ZAND",
    )
    listed = _enrich_formation_list([geo_row, litho_row])  # type: ignore[arg-type]
    litho_resp = next(r for r in listed if r.parent_formation_id == parent_id)
    assert litho_resp.parent_formation_code == "QP"


def test_n10_manual_code_link_wins_over_regional_ref() -> None:
    """An explicit ``code`` (manual informal→formal link) overrides ``regional_ref``."""
    project_id = uuid4()
    parent_id = uuid4()
    geo_row = _make_orm(
        id=parent_id,
        app_project_id=project_id,
        name="Some formation",
        code="Bm",
        regional_ref="QP",
    )
    litho_row = _make_orm(app_project_id=project_id, name="ZAND", parent_formation_id=parent_id)
    listed = _enrich_formation_list([geo_row, litho_row])  # type: ignore[arg-type]
    litho_resp = next(r for r in listed if r.parent_formation_id == parent_id)
    assert litho_resp.parent_formation_code == "Bm"
