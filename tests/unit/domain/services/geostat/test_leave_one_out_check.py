"""Cover up each test, guess it from its neighbours, flag it when it is > 3σ off.

Real data: tests/fixtures/geostat/worked_example_top_egem.json (17 picks on top Egem).
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from groundmodel.domain.services.geostat import leave_one_out_check
from groundmodel.domain.services.geostat.geostat_constants import (
    STATUS_CHECKED,
    STATUS_FIT_FAILED,
    STATUS_TOO_FEW_PICKS,
)
from groundmodel.domain.services.geostat.leave_one_out_check import check_formation_picks
from groundmodel.domain.services.geostat.pick_noise_floor import pick_noise_floor_m
from groundmodel.domain.value_objects.pick_observation import PickObservation
from groundmodel.shared.exceptions import GeostatFitError

FIXTURE = Path(__file__).parents[4] / "fixtures" / "geostat" / "worked_example_top_egem.json"


def _picks(*, drop: str | None = None) -> list[PickObservation]:
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))["picks"]
    return [
        PickObservation(
            contact_id=r["name"],
            investigation_id=r["name"],
            investigation_kind=r["kind"],
            investigation_name=r["name"],
            x_m=r["x"],
            y_m=r["y"],
            elevation_m=r["ground_elevation_m"] - r["depth_top_m"],
            noise_floor_m=pick_noise_floor_m(r["kind"]),
        )
        for r in rows
        if r["name"] != drop
    ]


def _flagged(result) -> set[str]:  # noqa: ANN001 — FormationPickCheck
    return {f.pick.investigation_name for f in result.flags}


def test_b16_and_s16_disagree_at_the_same_spot() -> None:
    """Stored picks: borehole B16 and CPT S16 stand 0.4 m apart and differ 1.7 m → both flagged."""
    result = check_formation_picks(_picks())
    assert result.status == STATUS_CHECKED
    flagged = _flagged(result)
    assert {"GEO-02/146-B16", "GEO-02/145-S16"} <= flagged
    b16 = next(f for f in result.flags if f.pick.investigation_name == "GEO-02/146-B16")
    assert b16.nearest.investigation_name == "GEO-02/145-S16"
    assert b16.nearest_distance_m < 1.0
    # 2025-01415 S4 (13 m high ground) is recorded, not asserted: it is the owner's call.
    print("S4 flagged:", "2025-01415 S4" in flagged)


def test_borehole_floor_keeps_b12_s12_quiet() -> None:
    """B12/S12 stand at the same spot and differ 0.41 m: normal for a log in 0.5 m steps."""
    assert not {"GEO-02/146-B12", "GEO-02/145-S12"} & _flagged(check_formation_picks(_picks()))
    assert not {"GEO-02/146-B12", "GEO-02/145-S12"} & _flagged(
        check_formation_picks(_picks(drop="GEO-02/146-B16"))
    )


def test_after_the_owner_ruling_b16_s16_is_clean() -> None:
    """With B16's wrong pick removed, S16 fits its neighbours again."""
    assert "GEO-02/145-S16" not in _flagged(check_formation_picks(_picks(drop="GEO-02/146-B16")))


def test_masking_trap_single_fit_hides_the_bad_pair() -> None:
    """One fit for all picks learns its noise FROM B16/S16 and then calls them normal.

    The refit (default) judges each test by a model fitted without it.
    """
    naive = _flagged(check_formation_picks(_picks(), refit=False))
    refitted = _flagged(check_formation_picks(_picks()))
    assert "GEO-02/146-B16" not in naive
    assert "GEO-02/145-S16" not in naive
    assert "GEO-02/146-B16" in refitted
    assert "GEO-02/145-S16" in refitted


def test_too_few_picks() -> None:
    """Five picks cannot carry a three-parameter fit."""
    result = check_formation_picks(_picks()[:5])
    assert result.status == STATUS_TOO_FEW_PICKS
    assert result.flags == ()


def test_coverage_is_reported() -> None:
    """The self-check is a share between 0 and 1."""
    result = check_formation_picks(_picks(drop="GEO-02/146-B16"))
    assert result.coverage_90 is not None
    assert 0.0 <= result.coverage_90 <= 1.0


def test_floors_counterfactual_b12_s12_flagged_without_them() -> None:
    """Spec §7: without the source floors, B12/S12 (one spot, 0.41 m apart) get flagged.

    The borehole floor is what keeps them quiet in ``test_borehole_floor_keeps_b12_s12_quiet``.
    """
    picks = [dataclasses.replace(p, noise_floor_m=0.0) for p in _picks(drop="GEO-02/146-B16")]
    result = check_formation_picks(picks)
    print(
        "zero-floor flags:",
        [(f.pick.investigation_name, round(f.z_score, 2)) for f in result.flags],
    )
    assert result.status == STATUS_CHECKED
    assert {"GEO-02/146-B12", "GEO-02/145-S12"} & _flagged(result)


def test_nan_elevation_is_a_failed_fit_not_a_crash() -> None:
    """A NaN elevation is a loading bug: fit_failed with the reason, and no flags."""
    picks = _picks()
    picks[0] = dataclasses.replace(picks[0], elevation_m=float("nan"))
    result = check_formation_picks(picks)
    assert result.status == STATUS_FIT_FAILED
    assert result.reason is not None
    assert "NaN" in result.reason
    assert result.flags == ()


def test_unstable_refit_falls_back_and_is_counted(monkeypatch: pytest.MonkeyPatch) -> None:
    """A refit that fails must not kill the check, but the fallback to the full fit is recorded.

    The full fit is the masked model, so a pick judged by it is judged less strictly.
    """
    real_fit = leave_one_out_check.fit_covariance_model
    calls = {"n": 0}

    def fit_then_fail(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202 — same signature as the real fit
        calls["n"] += 1
        if calls["n"] == 1:
            return real_fit(*args, **kwargs)
        raise GeostatFitError("refit did not converge")

    monkeypatch.setattr(leave_one_out_check, "fit_covariance_model", fit_then_fail)
    picks = _picks()
    result = check_formation_picks(picks)
    assert result.status == STATUS_CHECKED
    assert result.refit_fallbacks == len(picks)
