"""Unit tests for the side-scoped UPDATE SQL helper in migration ecc4014879af.

Audit finding #1: the migration originally interpolated the ``side`` value
straight into the SQL column name via an f-string
(``extent_{side}_kind``). Even though ``side`` is currently only ever
``"left"`` / ``"right"``, that idiom is an injection-shaped pattern. The
fix extracts a pure helper that hard-codes the two literal statements and
rejects any value outside the allow-list, so a column name can never be
built from data.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

# The migration lives in alembic's versions dir, which is not an importable
# package, so load it by file path.
_MIGRATION_PATH = (
    Path(__file__).resolve().parents[4]
    / "src"
    / "groundmodel"
    / "infrastructure"
    / "db"
    / "migrations"
    / "versions"
    / "ecc4014879af_absorb_synthetic_pinch_out_contacts_.py"
)


def _load_migration():
    """Import the migration module by file path (versions/ is not a package)."""
    spec = importlib.util.spec_from_file_location("_mig_ecc4014879af", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_left_sql_targets_left_columns() -> None:
    """The left branch references only the extent_left_* columns."""
    sql = _load_migration()._extent_update_sql("left")
    assert "extent_left_kind" in sql
    assert "extent_left_neighbour_inv_id" in sql
    assert "extent_right_kind" not in sql


def test_right_sql_targets_right_columns() -> None:
    """The right branch references only the extent_right_* columns."""
    sql = _load_migration()._extent_update_sql("right")
    assert "extent_right_kind" in sql
    assert "extent_right_neighbour_inv_id" in sql
    assert "extent_left_kind" not in sql


@pytest.mark.parametrize(
    "bad_side",
    ["left; DROP TABLE body", "LEFT", "middle", "", "extent_left_kind=1"],
)
def test_rejects_side_outside_allow_list(bad_side: str) -> None:
    """Any value other than the two literal sides is rejected, not interpolated."""
    with pytest.raises(AssertionError):
        _load_migration()._extent_update_sql(bad_side)
