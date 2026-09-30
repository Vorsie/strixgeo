"""Rules for a hand-edited borehole track (owner 2026-09-29).

The owner wants to add or change any track on a borehole by hand. The rules the
session main set for the interval editor, in its own words:

* intervals are top < base;
* within the borehole's total depth — WARN, do not block, when deeper (his
  boreholes sometimes carry descriptions deeper than diepte_tot);
* no overlaps within one track (BLOCK);
* gaps are allowed, with a warning;
* depths on the 1 mm grain, like litho layers.

Pure-function tests: no DB, no I/O.
"""

from __future__ import annotations

from groundmodel.domain.services.validate_track_intervals import validate_track_intervals
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.domain.value_objects.track_interval import TrackInterval


def _desc(top: float, base: float, text: str = "grijze klei") -> TrackInterval:
    """A description-track interval."""
    return TrackInterval(top_m=top, base_m=base, description=text)


def _codes(issues: tuple) -> list[str]:
    """The issue codes, in order."""
    return [i.code for i in issues]


def test_a_clean_contiguous_track_passes_with_no_issue() -> None:
    """Top < base, touching intervals, inside the total depth: nothing to say."""
    result = validate_track_intervals(
        "lithological_description",
        [_desc(0.0, 1.2), _desc(1.2, 3.5)],
        total_depth_m=5.0,
    )
    assert result.errors == ()
    assert result.warnings == ()
    assert [(i.top_m, i.base_m) for i in result.intervals] == [(0.0, 1.2), (1.2, 3.5)]


def test_top_must_be_above_base_or_the_track_is_refused() -> None:
    """An interval whose base is not deeper than its top is refused, with its key path."""
    result = validate_track_intervals(
        "lithological_description", [_desc(0.0, 1.0), _desc(2.0, 2.0)], total_depth_m=None
    )
    assert _codes(result.errors) == ["base_not_below_top"]
    assert result.errors[0].loc == "intervals.1.base_m"


def test_two_intervals_that_overlap_block_the_save() -> None:
    """No overlaps within one track: 1.0-2.5 and 2.0-3.0 share half a metre -> refused."""
    result = validate_track_intervals(
        "lithological_description", [_desc(1.0, 2.5), _desc(2.0, 3.0)], total_depth_m=None
    )
    assert _codes(result.errors) == ["intervals_overlap"]
    assert result.errors[0].loc == "intervals.1.top_m"


def test_overlap_is_judged_after_sorting_by_depth() -> None:
    """Rows typed out of order still overlap when their depth ranges do."""
    result = validate_track_intervals(
        "lithological_description", [_desc(2.0, 3.0), _desc(1.0, 2.5)], total_depth_m=None
    )
    assert _codes(result.errors) == ["intervals_overlap"]


def test_a_gap_between_intervals_is_allowed_with_a_warning() -> None:
    """Gaps allowed, with a warning badge: 1.0 -> 1.5 is a gap, not an error."""
    result = validate_track_intervals(
        "lithological_description", [_desc(0.0, 1.0), _desc(1.5, 2.0)], total_depth_m=None
    )
    assert result.errors == ()
    assert _codes(result.warnings) == ["gap_between_intervals"]


def test_deeper_than_the_total_depth_warns_but_does_not_block() -> None:
    """Descriptions deeper than diepte_tot are real on his boreholes: warn, never block."""
    result = validate_track_intervals(
        "lithological_description", [_desc(0.0, 6.0)], total_depth_m=5.0
    )
    assert result.errors == ()
    assert _codes(result.warnings) == ["below_total_depth"]


def test_depths_are_snapped_to_the_millimetre_grain() -> None:
    """1 mm grain like litho layers: 1.23449 is stored as 1.234 and 1.2346 as 1.235."""
    result = validate_track_intervals(
        "lithological_description", [_desc(0.0, 1.23449), _desc(1.23449, 2.0)], total_depth_m=None
    )
    assert result.errors == ()
    assert [(i.top_m, i.base_m) for i in result.intervals] == [(0.0, 1.234), (1.234, 2.0)]


def test_an_interval_thinner_than_a_millimetre_is_refused() -> None:
    """Rounded onto the grain, 1.0001-1.0004 collapses to nothing: base not below top."""
    result = validate_track_intervals(
        "lithological_description", [_desc(1.0001, 1.0004)], total_depth_m=None
    )
    assert _codes(result.errors) == ["base_not_below_top"]


def test_a_negative_top_is_refused() -> None:
    """Depths are below the collar: a top above the ground surface is not a depth."""
    result = validate_track_intervals(
        "lithological_description", [_desc(-0.5, 1.0)], total_depth_m=None
    )
    assert _codes(result.errors) == ["negative_depth"]


def test_a_track_needs_at_least_one_interval() -> None:
    """An empty track is not a track; deleting it is the explicit path."""
    result = validate_track_intervals("lithological_description", [], total_depth_m=None)
    assert _codes(result.errors) == ["no_intervals"]


def test_a_coded_lithology_interval_needs_a_main_soil_code() -> None:
    """A coded track row with no main soil says nothing: refused on its own key path."""
    result = validate_track_intervals(
        "coded_lithology",
        [TrackInterval(top_m=0.0, base_m=1.0, main_soil_codes=("FZ",)), TrackInterval(1.0, 2.0)],
        total_depth_m=None,
    )
    assert _codes(result.errors) == ["missing_main_soil_code"]
    assert result.errors[0].loc == "intervals.1.main_soil_codes"


def test_a_coded_interval_keeps_its_admixtures() -> None:
    """The admixtures ride through validation untouched (raw DOV tokens)."""
    adm = Admixture(soil_code="KL", amount="W", locally=True)
    result = validate_track_intervals(
        "geotechnical_coding",
        [TrackInterval(top_m=0.0, base_m=1.0, main_soil_codes=("FZ",), admixtures=(adm,))],
        total_depth_m=None,
    )
    assert result.errors == ()
    assert result.intervals[0].admixtures == (adm,)


def test_a_field_log_interval_needs_a_value() -> None:
    """A colour row with no colour is refused."""
    result = validate_track_intervals(
        "color", [TrackInterval(top_m=0.0, base_m=1.0, value="  ")], total_depth_m=None
    )
    assert _codes(result.errors) == ["missing_value"]
    assert result.errors[0].loc == "intervals.0.value"


def test_a_description_or_stratigraphy_interval_needs_text() -> None:
    """A formal-stratigraphy row with no unit code is refused."""
    result = validate_track_intervals(
        "formal_stratigraphy", [TrackInterval(top_m=0.0, base_m=1.0)], total_depth_m=None
    )
    assert _codes(result.errors) == ["missing_description"]


def test_an_unknown_track_kind_is_refused() -> None:
    """Kinds come from the observation types plus the field-log kinds, nothing else."""
    result = validate_track_intervals("drill_method", [_desc(0.0, 1.0)], total_depth_m=None)
    assert _codes(result.errors) == ["unknown_kind"]
    assert result.errors[0].loc == "kind"


# --- owner 2026-09-30: "i want max 3 admixtures in coded lithology" -----------


def _coded_with(n_admixtures: int) -> TrackInterval:
    """A coded-lithology row carrying ``n_admixtures`` admixtures."""
    return TrackInterval(
        top_m=0.0,
        base_m=1.0,
        main_soil_codes=("Z",),
        admixtures=tuple(
            Admixture(soil_code=code, amount="W", locally=False)
            for code in ("K", "L", "H", "G", "S")[:n_admixtures]
        ),
    )


def test_a_coded_lithology_row_with_three_admixtures_is_accepted() -> None:
    """Max 3 admixtures in coded lithology: three is the limit, and allowed."""
    result = validate_track_intervals("coded_lithology", [_coded_with(3)], total_depth_m=None)
    assert result.errors == ()


def test_a_fourth_admixture_on_a_coded_lithology_row_is_refused() -> None:
    """Max 3 admixtures in coded lithology: a fourth is refused, with its key path."""
    result = validate_track_intervals("coded_lithology", [_coded_with(4)], total_depth_m=None)
    assert _codes(result.errors) == ["too_many_admixtures"]
    assert result.errors[0].loc == "intervals.0.admixtures"


def test_the_admixture_cap_holds_on_the_geotechnical_coding_track_too() -> None:
    """Both coded kinds carry admixtures; the cap is the same on each."""
    result = validate_track_intervals("geotechnical_coding", [_coded_with(5)], total_depth_m=None)
    assert _codes(result.errors) == ["too_many_admixtures"]
