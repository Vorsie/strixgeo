"""Skip-and-count branch unit test for MaterializeWedgeTipsForFormation (#116 C6).

Audit item C6: the lens / companion / wedge-tip mutation use cases have
untested skip-and-count branches. For ``MaterializeWedgeTipsForFormation`` the
skip-and-count branch is the one that populates
``absences_skipped_no_geometry``: when the per-absence wedge-tip geometry
cannot be computed, ``_compute_and_insert_tip`` raises
``LensPinchGeometryError`` / ``ValueError``, the absence is SKIPPED (no
synthetic contact created), and the counter is incremented and reported in the
result.

The existing ``test_materialize_wedge_tips_scope.py`` covers only the
scope-guard misses and the zero-sections short-circuit — it never drives an
absence into the counted-skip path. This test does.

This is a characterisation GUARD, not a red-first pin — the branch already
ships; the test locks its observable contract (the failing absence is counted
in ``absences_skipped_no_geometry``, not created and not fatal).

MW-SK1 — one in-corridor absence whose tip geometry fails →
         ``absences_skipped_no_geometry == 1``, ``new_contacts_created == 0``,
         and the run completes (no raise).

The DB session and both DB-touching helpers are mocked — no DB or I/O.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.materialize_wedge_tips_for_formation import (
    MaterializeWedgeTipsForFormation,
)
from groundmodel.domain.services.lens_pinch_out_geometry import LensPinchGeometryError

PROJECT_ID = uuid4()
MODEL_ID = uuid4()
FORMATION_ID = uuid4()
SECTION_ID = uuid4()
INVESTIGATION_ID = uuid4()
ABSENCE_ID = uuid4()


def _all_result(rows: list[object]) -> MagicMock:
    """A ``session.execute`` result whose ``.all()`` yields ``rows``."""
    result = MagicMock()
    result.all = MagicMock(return_value=rows)
    return result


@pytest.mark.asyncio
async def test_mw_sk1_failed_tip_geometry_is_counted_as_skipped() -> None:
    """MW-SK1: an in-corridor absence with unbuildable geometry is counted, not created.

    The absence's investigation projects onto the section corridor, so the
    absence reaches ``_compute_and_insert_tip``. That helper is stubbed to
    raise ``LensPinchGeometryError`` (the real prerequisite-missing failure),
    which drives the ``except`` that increments ``total_skipped``. The result
    reports one skipped absence, zero created, and the call returns cleanly.
    """
    model_stub = SimpleNamespace(id=MODEL_ID, app_project_id=PROJECT_ID, parent_model_id=None)
    formation_stub = SimpleNamespace(
        id=FORMATION_ID, app_project_id=PROJECT_ID, parent_formation_id=None
    )

    async def _get(orm_class: object, id_val: object) -> object | None:
        class_name = getattr(orm_class, "__name__", "")
        if class_name == "GeologicalModelOrm":
            return model_stub
        if class_name == "GeologicalFormationOrm":
            return formation_stub
        return None

    # A horizontal section line 0..100 m; the absent investigation sits on it
    # (offset 0) so it lands inside the projection corridor.
    section = SimpleNamespace(
        id=SECTION_ID,
        name="S1",
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        projection_buffer_m=50.0,
    )

    absence_row = SimpleNamespace(
        id=ABSENCE_ID,
        investigation_id=INVESTIGATION_ID,
        investigation_kind="borehole",
        source="manual",
    )
    bh_row = SimpleNamespace(
        id=INVESTIGATION_ID,
        location_x=50.0,
        location_y=0.0,
        elevation_m=10.0,
    )

    # ``session.execute`` is called four times before the section loop, in this
    # fixed order (parent pointers are None, so the target-contact query and
    # the synthetic-id helper are both bypassed / stubbed):
    #   1. absence rows        → [absence_row]
    #   2. pinching contacts   → []
    #   3. borehole geocode    → [bh_row]  (INVESTIGATION_ID needs an (x, y))
    #   4. cpt geocode         → []
    session = AsyncMock()
    session.get = AsyncMock(side_effect=_get)
    session.execute = AsyncMock(
        side_effect=[
            _all_result([absence_row]),
            _all_result([]),
            _all_result([bh_row]),
            _all_result([]),
        ]
    )
    session.commit = AsyncMock()

    uc = MaterializeWedgeTipsForFormation(session)
    # Stub the two DB-touching helpers around the branch under test: no stale
    # synthetic contacts to delete, and the tip computation fails for this
    # absence (the counted-skip trigger).
    uc._find_existing_synthetic_ids = AsyncMock(return_value=[])  # type: ignore[method-assign]
    uc._compute_and_insert_tip = AsyncMock(  # type: ignore[method-assign]
        side_effect=LensPinchGeometryError("target polyline missing")
    )

    with patch(
        "groundmodel.application.materialize_wedge_tips_for_formation.load_project_sections",
        new=AsyncMock(return_value=[section]),
    ):
        result = await uc.execute(
            project_id=PROJECT_ID,
            model_id=MODEL_ID,
            formation_id=FORMATION_ID,
        )

    # The failing absence is counted as skipped, not created, and the run
    # completed one section without raising.
    assert result.absences_skipped_no_geometry == 1
    assert result.new_contacts_created == 0
    assert result.old_contacts_deleted == 0
    assert result.sections_processed == 1
