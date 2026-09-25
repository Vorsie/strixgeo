"""A stored CPT series that carries a null qc row is compacted when it loads.

Builds 0.1.0 to 0.1.2 persisted a GEF row whose qc was the file's void marker
as a null element of the qc array (issue #55, tester 2026-09-24). The parser no
longer emits such a row; a series stored earlier still holds them, and every
reader takes qc as a number. The ORM drops those rows the moment the series
loads, so no reader — the Ic chart first of all — ever sees a null qc again.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import event

from groundmodel.api.routers.cpt import _plot_response_from_cpt
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import (
    CptSeriesOrm,
    _compact_void_qc_rows_on_load,
    compact_void_qc_rows,
)


def _legacy_series() -> CptSeriesOrm:
    """Three rows; the middle one has no cone resistance."""
    return CptSeriesOrm(
        cpt_id=uuid4(),
        depths_m=[0.2, 0.4, 0.6],
        qc_mpa=[1.0, None, 2.0],  # type: ignore[list-item]  # the legacy shape under test
        fs_mpa=[0.05, 0.06, 0.07],
        u2_mpa=None,
        rf_pct=[5.0, None, 3.5],
        q_total_mpa=None,
        rf_source="computed",
    )


def test_a_row_without_qc_is_dropped_from_every_channel() -> None:
    series = _legacy_series()

    dropped = compact_void_qc_rows(series)

    assert dropped == 1
    assert series.depths_m == [0.2, 0.6]
    assert series.qc_mpa == [1.0, 2.0]
    assert series.fs_mpa == [0.05, 0.07]
    assert series.rf_pct == [5.0, 3.5]
    # Channels the source never measured stay absent, not empty.
    assert series.u2_mpa is None
    assert series.q_total_mpa is None


def test_a_series_with_a_qc_in_every_row_is_left_alone() -> None:
    series = CptSeriesOrm(
        cpt_id=uuid4(),
        depths_m=[0.2, 0.4],
        qc_mpa=[1.0, 2.0],
        fs_mpa=[0.05, 0.06],
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
        rf_source=None,
    )
    before = list(series.qc_mpa)

    assert compact_void_qc_rows(series) == 0
    assert series.qc_mpa == before
    assert series.depths_m == [0.2, 0.4]


def test_the_compaction_runs_whenever_a_series_loads() -> None:
    """Pinned as an ORM load hook, so no reader has to remember to call it."""
    assert event.contains(CptSeriesOrm, "load", _compact_void_qc_rows_on_load)
    assert event.contains(CptSeriesOrm, "refresh", _compact_void_qc_rows_on_load)


def test_the_chart_response_builds_from_a_compacted_legacy_series() -> None:
    """The request that answered 500 for the tester: GET /cpt/{id}/plot."""
    cpt = CptOrm(id=uuid4(), name="CPTE-VOID", elevation_m=2.0, water_depth_m=None)
    cpt.series = _legacy_series()
    compact_void_qc_rows(cpt.series)

    response = _plot_response_from_cpt(cpt)

    assert response.qc_mpa == [1.0, 2.0]
    assert response.depths_m == [0.2, 0.6]
    assert response.ic is not None
    assert len(response.ic) == 2
