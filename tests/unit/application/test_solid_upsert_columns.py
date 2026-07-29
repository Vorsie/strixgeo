"""Unit tests for the solid upsert's update-column set.

``_batch_upsert`` writes ``INSERT … ON CONFLICT (model_id, body_id) DO UPDATE``.
Its ``set_`` used to be a hand-maintained list, and a column absent from that
list is simply never written on the conflict path — which is every rebuild, since
the row already exists.

That has now bitten twice on the same table:

* ``updated_at`` was missing, so a freshly rebuilt mesh kept the timestamp of the
  build that first created it. Correct content, stale metadata — which led to
  telling the owner twice that a successful build had never persisted.
* ``generation_id`` was missing the moment it was added, so the first real build
  after shipping build provenance wrote 81 meshes and left every one of them
  pointing at no generation.

Both were invisible to every existing test. The fix is to stop maintaining the
list by hand: the update set is DERIVED from the row's own keys, minus the
identity columns. These tests pin that derivation.
"""

from __future__ import annotations

from groundmodel.application.litho_solid_persistence import (
    _UPSERT_IDENTITY_COLUMNS,
    _upsert_update_columns,
)


def test_identity_columns_are_never_updated() -> None:
    """The conflict target and the primary key must survive an upsert untouched."""
    columns = _upsert_update_columns(["id", "model_id", "body_id", "formation_id", "vertices"])

    assert "id" not in columns
    assert "model_id" not in columns
    assert "body_id" not in columns


def test_every_other_column_is_updated() -> None:
    """Anything the builder writes is refreshed on rebuild — no hand-maintained list."""
    columns = _upsert_update_columns(
        [
            "id",
            "model_id",
            "body_id",
            "formation_id",
            "method",
            "vertices",
            "triangles",
            "source_pick_count",
            "source_pick_checksum",
            "is_flagged",
            "is_stale",
            "generation_id",
        ]
    )

    assert set(columns) == {
        "formation_id",
        "method",
        "vertices",
        "triangles",
        "source_pick_count",
        "source_pick_checksum",
        "is_flagged",
        "is_stale",
        "generation_id",
    }


def test_a_newly_added_column_is_picked_up_automatically() -> None:
    """The whole point: adding a column to the row must not need a second edit."""
    columns = _upsert_update_columns(["id", "model_id", "body_id", "some_future_column"])

    assert "some_future_column" in columns


def test_generation_id_is_updated_on_rebuild() -> None:
    """The regression that shipped: 81 meshes written, none pointing at a generation."""
    assert "generation_id" in _upsert_update_columns(["id", "model_id", "body_id", "generation_id"])


def test_the_identity_set_is_the_conflict_target_plus_the_key() -> None:
    """Documents WHY these three are excluded, so the set is not widened casually."""
    assert _UPSERT_IDENTITY_COLUMNS == frozenset({"id", "model_id", "body_id"})


def test_column_order_is_stable() -> None:
    """Deterministic statements make two runs byte-comparable."""
    keys = ["id", "model_id", "body_id", "b_col", "a_col"]

    assert _upsert_update_columns(keys) == _upsert_update_columns(keys)
