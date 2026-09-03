"""Every bundled ORM array's column set is pinned (debt #47 gate).

The bundle serialiser enumerates columns via ``__mapper__.column_attrs``, so a
new column rides into the ``.strix`` format automatically. Once backwards-compat
re-arms at the first external distribution that is a liability: the on-disk shape
would drift with no version bump and no conscious decision.

These tests are the gate. For each top-level bundle array they assert the live
mapper columns of every ORM class serialised under it equal the frozen set in
``bundle_columns_expected.py``. Adding (or removing) a column to any bundled
model turns this suite RED until the frozen set is updated on purpose — which is
the moment to decide whether the new column is portable format (rides along;
maybe a ``format_version`` bump) or non-portable (dropped via ``_SKIP_COLUMNS``
or a per-relation exclude, pinned by ``test_bundle_skip_columns.py``).

Two coverage guards keep the gate honest: every pinned class must have an
expected set (and vice versa), and every top-level bundle key in the live
registry must be pinned here — so a whole new collection cannot be added to the
format without also pinning its columns.
"""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.db.repositories.project_bundle.bundle_collections import (
    BUNDLE_COLLECTION_KEYS,
)
from tests.unit.infrastructure.db.bundle_columns_expected import (
    BUNDLE_ARRAY_ORM_CLASSES,
    EXPECTED_BUNDLE_COLUMNS,
)


def _mapper_columns(orm_cls: type) -> frozenset[str]:
    """Return the live set of mapped column keys for an ORM class.

    Parameters
    ----------
    orm_cls : type
        A SQLAlchemy-mapped ORM class.

    Returns
    -------
    frozenset[str]
        Every column key the class's mapper carries — exactly what the bundle
        serialiser walks.
    """
    return frozenset(col.key for col in orm_cls.__mapper__.column_attrs)


@pytest.mark.parametrize("array_key", sorted(BUNDLE_ARRAY_ORM_CLASSES))
def test_bundle_array_column_set_is_pinned(array_key: str) -> None:
    """The exact column set of every ORM class under one bundle array is frozen.

    A column added to any of these models rides into the ``.strix`` unless it is
    consciously skipped; this pin makes that addition a RED test rather than a
    silent format change.
    """
    for orm_cls in BUNDLE_ARRAY_ORM_CLASSES[array_key]:
        expected = EXPECTED_BUNDLE_COLUMNS[orm_cls.__name__]
        actual = _mapper_columns(orm_cls)
        assert actual == expected, (
            f"{orm_cls.__name__} (bundle array '{array_key}') column set drifted "
            f"from its pin. Added: {sorted(actual - expected)}; "
            f"removed: {sorted(expected - actual)}. A bundled column is a "
            f"conscious .strix format decision — update EXPECTED_BUNDLE_COLUMNS "
            f"and decide on portability (_SKIP_COLUMNS) and a format_version bump."
        )


def test_every_pinned_class_has_exactly_one_expected_set() -> None:
    """The array→classes map and the expected-column map describe the same
    classes — no pinned class lacks a frozen set, no frozen set is an orphan.

    A seventh lab-test family joins ``boreholes`` via the shared registry, so
    this guard forces its columns to be pinned before the suite goes green
    again.
    """
    referenced = {cls.__name__ for classes in BUNDLE_ARRAY_ORM_CLASSES.values() for cls in classes}
    assert referenced == set(EXPECTED_BUNDLE_COLUMNS)


def test_every_top_level_bundle_key_is_pinned() -> None:
    """Every collection the live registry carries is pinned here, plus the
    scalar ``project`` row. Adding a collection to ``BUNDLE_COLLECTION_KEYS``
    without pinning its columns fails this guard, so a new top-level array
    cannot enter the format unnoticed."""
    assert set(BUNDLE_ARRAY_ORM_CLASSES) == set(BUNDLE_COLLECTION_KEYS) | {"project"}
