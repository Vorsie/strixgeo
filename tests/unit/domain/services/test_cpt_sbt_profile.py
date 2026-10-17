"""Both classifiers, per depth point, side by side — and neither is the other.

Owner ruling (dogfeed 2026-08-03): the per-CPT plot surface shows BOTH the full
normalised Robertson-2015 pipeline's zone-per-depth strip AND the non-normalised
``I_SBT`` strip alongside it, so the engineer can see where stress-normalisation
changes the answer instead of being handed one number.

The rules under test:
  * the Ic the strip is drawn against is the SAME Ic the CPT chart draws — one
    pipeline, not a second implementation;
  * the non-normalised index is the published closed form, hand-checkable;
  * a point with no sleeve friction is UNCLASSIFIABLE in both columns — never
    silently filled in;
  * the profile reports the water table it used and where that number came from.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.cpt_sbt_profile import compute_sbt_profile
from groundmodel.domain.services.gwt_resolution import ResolvedGwt
from groundmodel.domain.services.robertson_2015 import ic_series_2015

# Three hand-checkable points plus one with no sleeve friction.
#   idx 0 — qc 10 MPa / fs 0.05 MPa → Rf 0.5 %  → I_SBT ≈ 1.7336 → zone 6 (sand)
#   idx 1 — qc  0.3 MPa / fs 0.03 MPa → Rf 10 % → I_SBT ≈ 3.7264 → zone 2 (organic)
#   idx 2 — qc  2 MPa / fs 0.04 MPa → Rf 2 %    → I_SBT ≈ 2.6947 → zone 4 (clayey silt)
#   idx 3 — fs missing                          → both columns None
_DEPTHS: list[float] = [1.0, 2.0, 3.0, 4.0]
_QC: list[float] = [10.0, 0.3, 2.0, 5.0]
_FS: list[float | None] = [0.05, 0.03, 0.04, None]

_GWT = ResolvedGwt(gwt_m=1.5, source="engineer")


def _hand_i_sbt(qc_mpa: float, fs_mpa: float) -> float:
    """Closed-form I_SBT, written out here independently of the module."""
    rf = fs_mpa / qc_mpa * 100.0
    return math.sqrt((3.47 - math.log10(qc_mpa / 0.1)) ** 2 + (math.log10(rf) + 1.22) ** 2)


def test_the_non_normalised_index_matches_the_published_closed_form() -> None:
    """I_SBT is qc/pa and Rf only — no stress profile, no iteration."""
    profile = compute_sbt_profile(depths_m=_DEPTHS, qc_mpa=_QC, fs_mpa=_FS, gwt=_GWT)

    assert profile.i_sbt[0] is not None
    # Spot-check against the number worked out by hand in the header comment,
    # so a wrong pa or a dropped ×100 on Rf shows up as a wrong VALUE, not just
    # a disagreement with another implementation of the same formula.
    assert math.isclose(profile.i_sbt[0], 1.7336, abs_tol=1e-4)
    assert math.isclose(profile.i_sbt[0], _hand_i_sbt(10.0, 0.05), rel_tol=1e-12)
    assert math.isclose(profile.i_sbt[1], _hand_i_sbt(0.3, 0.03), rel_tol=1e-12)
    assert math.isclose(profile.i_sbt[2], _hand_i_sbt(2.0, 0.04), rel_tol=1e-12)


def test_the_non_normalised_zones_follow_the_published_breakpoints() -> None:
    """1.7 → clean sand (6); 3.7 → organic (2); 2.7 → clayey silt (4)."""
    profile = compute_sbt_profile(depths_m=_DEPTHS, qc_mpa=_QC, fs_mpa=_FS, gwt=_GWT)

    assert profile.zone_non_normalised[0] == 6
    assert profile.zone_non_normalised[1] == 2
    assert profile.zone_non_normalised[2] == 4


def test_the_strip_is_drawn_against_the_same_ic_the_chart_draws() -> None:
    """The profile's Ic IS the chart's Ic — one pipeline under one water table."""
    profile = compute_sbt_profile(depths_m=_DEPTHS, qc_mpa=_QC, fs_mpa=_FS, gwt=_GWT)

    assert profile.ic == ic_series_2015(depths_m=_DEPTHS, qc_mpa=_QC, fs_mpa=_FS, gwt_m=_GWT.gwt_m)


def test_the_normalised_strip_classifies_every_point_that_has_an_ic() -> None:
    """A point the pipeline could normalise gets a zone in 1..9."""
    profile = compute_sbt_profile(depths_m=_DEPTHS, qc_mpa=_QC, fs_mpa=_FS, gwt=_GWT)

    for ic, zone in zip(profile.ic, profile.zone_normalised):
        if ic is None:
            assert zone is None
        else:
            assert zone is not None and 1 <= zone <= 9


def test_a_point_without_sleeve_friction_is_unclassifiable_in_both_columns() -> None:
    """No fs → no friction ratio → no index, in either classifier. Never guessed."""
    profile = compute_sbt_profile(depths_m=_DEPTHS, qc_mpa=_QC, fs_mpa=_FS, gwt=_GWT)

    assert profile.ic[3] is None
    assert profile.zone_normalised[3] is None
    assert profile.i_sbt[3] is None
    assert profile.zone_non_normalised[3] is None


def test_the_profile_carries_the_water_table_it_used_and_its_provenance() -> None:
    """Data Integrity Rule 1 — a derived strip says what it was derived from."""
    profile = compute_sbt_profile(depths_m=_DEPTHS, qc_mpa=_QC, fs_mpa=_FS, gwt=_GWT)

    assert profile.gwt_m == 1.5
    assert profile.gwt_source == "engineer"
    assert profile.depths_m == _DEPTHS


def test_an_empty_series_produces_an_empty_profile_not_a_crash() -> None:
    """A header-only CPT yields empty arrays, and still reports its water table."""
    profile = compute_sbt_profile(depths_m=[], qc_mpa=[], fs_mpa=[], gwt=_GWT)

    assert profile.depths_m == []
    assert profile.ic == []
    assert profile.zone_normalised == []
    assert profile.i_sbt == []
    assert profile.zone_non_normalised == []
    assert profile.gwt_source == "engineer"
