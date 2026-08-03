"""Parity gate — the SBT-profile endpoint and the segmenter use the SAME normalisation.

The rule, in the engineer's own words: *the zone strip I read on a CPT and the
ghost boundaries "Suggest layers" offers me must be computed under the same
effective-stress profile* — the same water table, whichever of the three the row
is in (a depth I typed, a depth the file recorded, or the app's assumption when
there is neither), AND the same unit weights, the ones Settings → Litho
segmenter says "feed the Robertson Ic".

Companion to ``test_gwt_default_parity`` (which pins the CHART's Ic to the
segmenter for the no-record case). This one walks all THREE provenance states
plus a non-default γ, and drives the real endpoint handler and the real use case
— never each with itself.
"""

from __future__ import annotations

import asyncio
import math
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException

from groundmodel.api.routers.cpt import get_cpt_sbt_profile
from groundmodel.application.suggest_litho_contacts import SuggestLithoContacts
from groundmodel.domain.services.robertson_2015 import (
    qtn_f_ic_series,
    sbt_zone_series,
    stress_profile,
)
from groundmodel.domain.services.robertson_2015_constants import DEFAULT_GWT_DEPTH_M
from groundmodel.domain.value_objects.water_depth_source import WaterDepthSource
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

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

# The three provenance states, and the depth each is expected to resolve to.
_STATES: list[tuple[float | None, str | None, float, str]] = [
    (None, None, DEFAULT_GWT_DEPTH_M, "assumed"),
    (1.7, WaterDepthSource.GEF.value, 1.7, "recorded"),
    (3.4, WaterDepthSource.ENGINEER.value, 3.4, "engineer"),
]


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


def _make_cpt(water_depth_m: float | None, water_depth_source: str | None) -> CptOrm:
    """Build an unattached CPT row in one of the three provenance states."""
    cpt = CptOrm(
        id=uuid4(),
        app_project_id=uuid4(),
        name="CPT-GWT-PARITY",
        elevation_m=_SURFACE_ELEVATION_M,
        water_depth_m=water_depth_m,
        water_depth_source=water_depth_source,
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


def _segmenter_drive(
    monkeypatch: pytest.MonkeyPatch, cpt: CptOrm, **request_kwargs: float
) -> dict[str, Any]:
    """Run the real segmenter use case and report the kwargs it drove with.

    Parameters
    ----------
    monkeypatch : pytest.MonkeyPatch
        Fixture used to spy on ``segment_cpt``.
    cpt : CptOrm
        The unattached CPT row to segment.
    **request_kwargs : float
        Passed straight through to ``execute_for_cpt`` — the values the
        router forwards from ``LithoSuggestionRequest``.

    Returns
    -------
    dict[str, Any]
        Every keyword ``segment_cpt`` was handed.
    """
    captured: dict[str, Any] = {}

    def _spy(**kwargs: Any) -> list[Any]:
        captured.update(kwargs)
        return []

    monkeypatch.setattr("groundmodel.application.suggest_litho_contacts.segment_cpt", _spy)

    project_id = uuid4()
    use_case = SuggestLithoContacts(_StubSession(project_id, cpt))  # type: ignore[arg-type]
    asyncio.run(use_case.execute_for_cpt(model_id=uuid4(), cpt_id=cpt.id, **request_kwargs))
    return captured


def _segmenter_gwt_depth_m(monkeypatch: pytest.MonkeyPatch, cpt: CptOrm) -> float:
    """Run the real segmenter use case and report the water depth it used."""
    captured = _segmenter_drive(monkeypatch, cpt)
    # yw is a level in the project datum; the depth below ground is the drop
    # from the ground-surface level.
    return float(captured["niveau_m"]) - float(captured["yw_m"])


def _profile_response(monkeypatch: pytest.MonkeyPatch, cpt: CptOrm, **overrides: float) -> Any:
    """Run the real ``GET /cpt/{id}/sbt-profile`` handler against a stub repo.

    ``overrides`` are the endpoint's optional query parameters
    (``gunsat_kNm3`` / ``gwater_kNm3``); omitted means the FastAPI defaults,
    which are the same defaults ``LithoSuggestionRequest`` carries.
    """

    class _StubRepo:
        def __init__(self, _session: Any) -> None:
            pass

        async def get_by_id(self, _cpt_id: Any) -> CptOrm:
            return cpt

    monkeypatch.setattr("groundmodel.api.routers.cpt.CptRepository", _StubRepo)
    return asyncio.run(
        get_cpt_sbt_profile(
            cpt_id=cpt.id,
            # The row's own scope — the guard is exercised separately below.
            project_id=cpt.app_project_id,  # type: ignore[arg-type]
            session=None,  # type: ignore[arg-type]
            **overrides,  # type: ignore[arg-type]
        )
    )


@pytest.mark.parametrize(
    ("water_depth_m", "water_depth_source", "expected_gwt_m", "expected_label"),
    _STATES,
)
def test_the_profile_and_the_segmenter_agree_in_every_provenance_state(
    monkeypatch: pytest.MonkeyPatch,
    water_depth_m: float | None,
    water_depth_source: str | None,
    expected_gwt_m: float,
    expected_label: str,
) -> None:
    """One water table per CPT, whatever wrote it — and the strip says which."""
    cpt = _make_cpt(water_depth_m, water_depth_source)

    used_by_segmenter = _segmenter_gwt_depth_m(monkeypatch, cpt)
    profile = _profile_response(monkeypatch, cpt)

    # isclose, not ==: the segmenter's depth is read back as ``niveau - yw``,
    # and that round-trip through a TAW level costs a float ULP (5.0 - 3.3 =
    # 1.7000000000000002). A ULP is not a different water table; a metre is.
    assert math.isclose(profile.gwt_m, used_by_segmenter, abs_tol=1e-9), (
        "the SBT profile was computed under a different water table than the "
        f"segmenter's (segmenter used {used_by_segmenter} m)"
    )
    assert profile.gwt_m == expected_gwt_m
    assert profile.gwt_source == expected_label


def test_the_profile_and_the_segmenter_agree_on_the_engineers_unit_weights(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """γ from Settings → Litho segmenter feeds the strip, not just the ghosts.

    The hint under that setting says it "feeds the Robertson Ic". If the strip
    kept the built-in 16 kN/m³ while the segmenter ran on the engineer's 19,
    the two surfaces would disagree for a reason the strip attributes to
    normalised-vs-non-normalised — the exact confusion this feature removes.
    """
    cpt = _make_cpt(1.7, WaterDepthSource.GEF.value)
    gunsat = 19.0
    gwater = 10.2

    drive = _segmenter_drive(monkeypatch, cpt, gunsat_kNm3=gunsat, gwater_kNm3=gwater)
    profile = _profile_response(monkeypatch, cpt, gunsat_kNm3=gunsat, gwater_kNm3=gwater)

    # Reproduce the SEGMENTER's own normalised zones from the kwargs it was
    # handed, straight off the frozen module — an independent drive, not the
    # endpoint's own output compared with itself.
    stress = stress_profile(
        depths_m=_DEPTHS,
        qc_mpa=_QC,
        fs_mpa=_FS,
        niveau_m=drive["niveau_m"],
        yw_m=drive["yw_m"],
        gunsat_kNm3=drive["gunsat_kNm3"],
        gwater_kNm3=drive["gwater_kNm3"],
    )
    expected = sbt_zone_series(
        qtn_f_ic_series(depths_m=_DEPTHS, qc_mpa=_QC, fs_mpa=_FS, stress=stress)
    )
    assert any(z is not None for z in expected), "the fixture classifies nothing — vacuous gate"
    assert profile.zone_normalised == expected, (
        "the strip was normalised under different unit weights than the segmenter"
    )


def test_a_non_default_unit_weight_actually_reaches_the_pipeline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Guard the guard: a silently-ignored γ would make the parity test vacuous."""
    cpt = _make_cpt(1.7, WaterDepthSource.GEF.value)

    default = _profile_response(monkeypatch, cpt)
    heavier = _profile_response(monkeypatch, cpt, gunsat_kNm3=25.0)

    assert heavier.ic != default.ic, "γ made no difference — it is not threaded through"


def test_the_project_scope_guard_is_applied_before_anything_is_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A CPT from another project 404s — the profile is not a scope hole."""
    cpt = _make_cpt(None, None)

    class _StubRepo:
        def __init__(self, _session: Any) -> None:
            pass

        async def get_by_id(self, _cpt_id: Any) -> CptOrm:
            return cpt

    monkeypatch.setattr("groundmodel.api.routers.cpt.CptRepository", _StubRepo)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            get_cpt_sbt_profile(
                cpt_id=cpt.id,
                project_id=uuid4(),  # a DIFFERENT project
                session=None,  # type: ignore[arg-type]
            )
        )
    assert exc.value.status_code == 404
