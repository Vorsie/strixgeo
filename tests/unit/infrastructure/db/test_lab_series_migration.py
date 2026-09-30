"""The lab-series migration creates exactly what the ORM maps (no DB).

A migration / ORM mismatch is otherwise found only by the integration parity
test (``test_migration_upgrade_from_empty``). This unit check runs the
migration's ``upgrade()`` against a recording stand-in for ``alembic.op`` and
compares every created table with ``Base.metadata``: the same columns, the same
nullability, the same column type class, the same foreign keys. And
``downgrade()`` drops every table ``upgrade()`` creates.
"""

from __future__ import annotations

import importlib
from typing import Any

import sqlalchemy as sa

import groundmodel.infrastructure.db.models  # noqa: F401 — registers the tables
from groundmodel.infrastructure.db.base import Base

_MIGRATION = "groundmodel.infrastructure.db.migrations.versions.l4b5c6d7e8f9_lab_series_tables"
_TABLES = {
    "lab_series_test",
    "lab_series_specimen",
    "lab_series_stage",
    "lab_series_channel",
    "lab_series_lab_result",
}


class _RecordingOp:
    """Stand-in for ``alembic.op`` that records instead of executing."""

    def __init__(self) -> None:
        self.created: dict[str, list[Any]] = {}
        self.dropped: list[str] = []
        self.indexes: list[tuple[str, list[str]]] = []

    def create_table(self, name: str, *elements: Any, **_kw: Any) -> None:
        self.created[name] = list(elements)

    def create_index(self, _name: str, table: str, columns: list[str], **_kw: Any) -> None:
        self.indexes.append((table, columns))

    def drop_index(self, *_a: Any, **_kw: Any) -> None:
        return None

    def drop_table(self, name: str, **_kw: Any) -> None:
        self.dropped.append(name)


def _run(fn_name: str) -> _RecordingOp:
    module = importlib.import_module(_MIGRATION)
    recorder = _RecordingOp()
    original = module.op
    module.op = recorder  # type: ignore[assignment]
    try:
        getattr(module, fn_name)()
    finally:
        module.op = original
    return recorder


def test_the_migration_creates_the_five_tables_the_orm_maps() -> None:
    """upgrade() creates exactly the five lab-series tables."""
    assert set(_run("upgrade").created) == _TABLES


def test_every_column_matches_the_orm_in_name_nullability_and_type() -> None:
    """Column set, nullability and type class per table equal the ORM's."""
    created = _run("upgrade").created
    for name in _TABLES:
        orm = Base.metadata.tables[name]
        cols = {e.name: e for e in created[name] if isinstance(e, sa.Column)}
        assert set(cols) == set(orm.columns.keys()), name
        for col in orm.columns:
            mig = cols[col.name]
            assert mig.nullable == col.nullable, f"{name}.{col.name} nullability"
            assert type(mig.type).__name__ == type(col.type).__name__ or (
                # sa.Double() vs the ORM's Double / DOUBLE_PRECISION spellings.
                {type(mig.type).__name__, type(col.type).__name__}
                <= {"Double", "DOUBLE_PRECISION", "Float"}
            ), f"{name}.{col.name}: {mig.type!r} vs {col.type!r}"
            if isinstance(col.type, sa.ARRAY):
                assert type(mig.type.item_type).__name__ in {
                    type(col.type.item_type).__name__,
                    "DOUBLE_PRECISION",
                    "Double",
                }, f"{name}.{col.name} array item type"


def test_foreign_keys_cascade_like_the_orm() -> None:
    """Every FK the ORM declares exists in the migration, ON DELETE CASCADE."""
    created = _run("upgrade").created
    for name in _TABLES:
        mig_fks = {
            (tuple(c.column_keys), c.elements[0].target_fullname, c.ondelete)
            for c in created[name]
            if isinstance(c, sa.ForeignKeyConstraint)
        }
        for fk in Base.metadata.tables[name].foreign_keys:
            assert ((fk.parent.name,), fk.target_fullname, "CASCADE") in mig_fks, (name, fk)


def test_downgrade_drops_every_table_upgrade_creates() -> None:
    """No table is left behind by a downgrade."""
    assert set(_run("downgrade").dropped) == _TABLES
