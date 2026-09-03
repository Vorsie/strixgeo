"""Structural pin for the ``sample.geotech_body_id`` → ``body.id`` foreign key.

Production-readiness audit L5: ``sample.geotech_body_id`` was a bare UUID with
no FK, yet body rows ARE deleted (``DeleteBody`` and the resolver's orphan
sweep). A deleted body therefore left a *dangling* id on every sample it
grouped. The rule this file pins, in the audit's words: the column carries a
real FK with ``ON DELETE SET NULL``, so deleting a body clears the sample's
pointer instead of leaving it dangling — exactly mirroring ``litho_layer.body_id``.

The runtime SET-NULL-on-delete behaviour is a database-level effect and is
covered by the integration suite; here we pin the schema declaration, which is
a pure metadata read (no DB).
"""

from __future__ import annotations

# Importing the models package registers every ORM class on Base.metadata so
# the FK's target column (``body.id``) resolves.
import groundmodel.infrastructure.db.models  # noqa: F401
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm


def test_geotech_body_id_is_a_real_fk_to_body_id() -> None:
    """``sample.geotech_body_id`` references ``body.id`` — not a bare UUID."""
    column = SampleOrm.__table__.c.geotech_body_id
    foreign_keys = list(column.foreign_keys)
    assert len(foreign_keys) == 1, "expected exactly one FK on geotech_body_id"
    assert foreign_keys[0].target_fullname == "body.id"


def test_deleting_a_body_sets_the_sample_pointer_null_not_dangling() -> None:
    """The FK is declared ``ON DELETE SET NULL`` (mirrors ``litho_layer.body_id``)."""
    column = SampleOrm.__table__.c.geotech_body_id
    foreign_key = next(iter(column.foreign_keys))
    assert foreign_key.ondelete == "SET NULL"


def test_geotech_body_id_stays_nullable() -> None:
    """The column is nullable — most samples are ungrouped, and SET NULL needs it."""
    assert SampleOrm.__table__.c.geotech_body_id.nullable is True
