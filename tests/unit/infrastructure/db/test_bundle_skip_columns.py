"""Non-portable ORM columns must be dropped from the bundle (debt #47 audit).

``_SKIP_COLUMNS`` is the single gate that keeps machine-local / server-managed
/ out-of-bundle columns out of the ``.strix`` round-trip. These tests pin the
audit ruling for #47: a column whose value has no meaning on another machine or
install (a server clock, the PostGIS geometry blob, a foreign key into a table
the bundle does not carry) must not ride along, on serialise OR on restore.

The load-bearing new promotion is ``generation_id``: the ``LithoBodySolid`` FK
into ``litho_build_generation`` — a build-history table that is NOT one of the
bundle's collections. Carrying it makes a restored/cloned solid reference a
row that never travelled: on a fresh-DB open the FK dangles, and on a Save-As
clone it silently credits the SOURCE project's build generation (``remap_ids``
only re-keys rows the bundle actually contains). The column is nullable by
design, so dropping it restores a valid ``NULL``.
"""

from __future__ import annotations

from uuid import uuid4

from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_serialization import (
    _SKIP_COLUMNS,
    _apply_json_to_kwargs,
    _column_to_json,
)


def test_a_build_generation_reference_is_not_serialised_into_a_solid() -> None:
    """A solid's ``generation_id`` points at a table the bundle never carries.

    Serialising it would ship a reference that dangles on a fresh-DB restore and
    cross-links to the source project on a Save-As clone. It must not appear in
    the serialised solid dict.
    """
    solid = LithoBodySolidOrm(id=uuid4(), generation_id=uuid4())
    payload = _column_to_json(solid, _SKIP_COLUMNS)
    assert "generation_id" not in payload


def test_a_build_generation_reference_is_dropped_on_restore() -> None:
    """Even a hand-crafted or legacy bundle that carries ``generation_id`` must
    not insert it — the restore drops it so the solid lands with a valid NULL
    rather than a dangling FK."""
    kwargs = _apply_json_to_kwargs(
        LithoBodySolidOrm,
        {"id": str(uuid4()), "generation_id": str(uuid4()), "method": "tin"},
    )
    assert "generation_id" not in kwargs


def test_the_server_managed_and_geometry_columns_stay_skipped() -> None:
    """Guard: the original non-portable set (server clocks + PostGIS geometry)
    is never accidentally removed from the gate."""
    assert {"created_at", "updated_at", "archived_at", "location"} <= _SKIP_COLUMNS
