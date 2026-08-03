"""Parity gate — the Ic chart and the litho segmenter must assume the same water table.

The rule, in the engineer's own words: *when a CPT does not record a water
table, the Ic curve I read on the chart and the Ic the "Suggest layers" ghosts
are derived from must be computed under the SAME assumption.*  Any other
outcome means the boundaries he validates against the chart do not line up with
the boundaries the segmenter proposes, and neither surface tells him why.

This is a two-consumer parity test on purpose: it drives the real chart helper
(``_plot_response_from_cpt``, behind ``GET /cpt/{id}/plot`` and
``POST /cpt/plot-batch``) and the real segmenter use case
(``SuggestLithoContacts.execute_for_cpt``) and asserts the two agree — never
each with itself.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from groundmodel.api.routers.cpt import _plot_response_from_cpt
from groundmodel.application.suggest_litho_contacts import SuggestLithoContacts
from groundmodel.domain.services.robertson_2015 import ic_series_2015
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

# A short, realistic CPT: 0.2 m sampling over 4 m of alternating sand/clay.
_DEPTHS: list[float] = [0.2 * (i + 1) for i in range(20)]
_QC: list[float] = [1.2, 1.4, 1.6, 8.0, 9.5, 11.0, 12.5, 10.0, 2.0, 1.8] + [
    1.5,
    1.4,
    6.0,
    7.5,
    9.0,
    10.5,
    11.5,
    12.0,
    12.5,
    13.0,
]
_FS: list[float] = [0.05 * q for q in _QC]
_SURFACE_ELEVATION_M = 5.0


class _StubResult:
    """Minimal stand-in for a SQLAlchemy ``Result`` covering both access styles."""

    def __init__(self, row: Any) -> None:
        self._row = row

    def one_or_none(self) -> Any:
        """Return the single row (the model kind/project lookup)."""
        return self._row

    def scalar_one_or_none(self) -> Any:
        """Return the single scalar (the CPT lookup)."""
        return self._row


class _StubSession:
    """Async session stub that answers the use case's two SELECTs in order."""

    def __init__(self, project_id: Any, cpt: CptOrm) -> None:
        self._rows = [
            SimpleNamespace(kind="lithostratigraphic", app_project_id=project_id),
            cpt,
        ]

    async def execute(self, _stmt: Any) -> _StubResult:
        """Pop and return the next canned result."""
        return _StubResult(self._rows.pop(0))


def _make_cpt() -> CptOrm:
    """Build an unattached CPT row with NO recorded water table."""
    cpt = CptOrm(
        id=uuid4(),
        name="CPT-NO-GWT",
        elevation_m=_SURFACE_ELEVATION_M,
        water_depth_m=None,  # the case under test: DOV imports never carry one
        cone_area_ratio=None,
    )
    cpt.series = CptSeriesOrm(
        depths_m=_DEPTHS,
        qc_mpa=_QC,
        fs_mpa=_FS,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
        rf_source=None,
    )
    return cpt


def _segmenter_assumed_gwt_depth_m(monkeypatch: pytest.MonkeyPatch, cpt: CptOrm) -> float:
    """Run the real segmenter use case and report the water depth it assumed."""
    captured: dict[str, float] = {}

    def _spy(**kwargs: Any) -> list[Any]:
        captured["niveau_m"] = kwargs["niveau_m"]
        captured["yw_m"] = kwargs["yw_m"]
        return []

    monkeypatch.setattr("groundmodel.application.suggest_litho_contacts.segment_cpt", _spy)

    project_id = uuid4()
    use_case = SuggestLithoContacts(_StubSession(project_id, cpt))  # type: ignore[arg-type]
    asyncio.run(use_case.execute_for_cpt(model_id=uuid4(), cpt_id=cpt.id))

    # yw is a level in the project datum; the depth below ground is the drop
    # from the ground-surface level.
    return captured["niveau_m"] - captured["yw_m"]


def test_chart_and_segmenter_assume_the_same_water_table_when_none_is_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A CPT with no recorded water table gets ONE assumed water table, not two."""
    cpt = _make_cpt()

    assumed_by_segmenter = _segmenter_assumed_gwt_depth_m(monkeypatch, cpt)

    chart_ic = _plot_response_from_cpt(cpt).ic
    assert chart_ic is not None

    ic_under_segmenter_assumption = ic_series_2015(
        depths_m=_DEPTHS,
        qc_mpa=_QC,
        fs_mpa=_FS,
        gwt_m=assumed_by_segmenter,
    )

    assert chart_ic == ic_under_segmenter_assumption, (
        "the chart's Ic curve was computed under a different water-table "
        f"assumption than the segmenter's (segmenter assumed {assumed_by_segmenter} m)"
    )
