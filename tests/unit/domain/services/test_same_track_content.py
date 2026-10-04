"""Does an edited track hold exactly what DOV published? (owner dogfeed 2026-10-01)

The rule the session main set after the owner's undo finding: "an undo that
restores a track to exactly its DOV content clears the 'edited by hand' mark,
while an undo that leaves a difference keeps it". This pins the comparison:
"exactly its DOV content" means the same intervals as the track editor would
store them - on the 1 mm grain, text stripped, in depth order - so a round
trip through the editor never reads as a hand edit; any real difference (a
depth, a code, a word, an admixture, a row more or less) does.

Pure-function tests: no DB, no I/O.
"""

from __future__ import annotations

from groundmodel.domain.services.validate_track_intervals import same_track_content
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.domain.value_objects.track_interval import TrackInterval

DOV = (
    TrackInterval(
        top_m=0.0,
        base_m=2.0,
        color="bruingrijs",
        main_soil_codes=("FZ",),
        admixtures=(Admixture("KL", "W", False), Admixture("GL", "M", True)),
    ),
    TrackInterval(top_m=2.0, base_m=4.0, main_soil_codes=("KL", "LE")),
)


def test_the_dov_content_sent_back_unchanged_is_the_dov_content() -> None:
    """The undo sends DOV's intervals back verbatim: same content."""
    assert same_track_content(DOV, DOV)


def test_an_editor_round_trip_is_not_a_difference() -> None:
    """Order, the sub-mm grain, stray spaces, '' for nothing and admixture order are not edits."""
    round_trip = (
        TrackInterval(top_m=2.0004, base_m=4.0, main_soil_codes=(" KL", "LE ")),
        TrackInterval(
            top_m=0.0,
            base_m=1.9996,
            color=" bruingrijs ",
            description="",
            main_soil_codes=("FZ",),
            admixtures=(Admixture("GL", "M", True), Admixture("KL", "W", False)),
        ),
    )
    assert same_track_content(round_trip, DOV)


def test_a_moved_boundary_leaves_a_difference() -> None:
    """One boundary 1 cm deeper: still a hand edit."""
    moved = (
        TrackInterval(
            top_m=0.0,
            base_m=2.01,
            color="bruingrijs",
            main_soil_codes=("FZ",),
            admixtures=DOV[0].admixtures,
        ),
        TrackInterval(top_m=2.01, base_m=4.0, main_soil_codes=("KL", "LE")),
    )
    assert not same_track_content(moved, DOV)


def test_a_changed_code_word_or_admixture_leaves_a_difference() -> None:
    """A main soil code, a colour, an admixture amount, the locally flag: each one is an edit."""
    first, second = DOV
    variants = [
        (first, TrackInterval(top_m=2.0, base_m=4.0, main_soil_codes=("LE", "KL"))),
        (TrackInterval(**{**first.__dict__, "color": "grijs"}), second),
        (
            TrackInterval(
                **{
                    **first.__dict__,
                    "admixtures": (Admixture("KL", "M", False), Admixture("GL", "M", True)),
                }
            ),
            second,
        ),
        (
            TrackInterval(
                **{
                    **first.__dict__,
                    "admixtures": (Admixture("KL", "W", True), Admixture("GL", "M", True)),
                }
            ),
            second,
        ),
    ]
    for variant in variants:
        assert not same_track_content(variant, DOV), variant


def test_a_row_more_or_less_leaves_a_difference() -> None:
    """A dropped row or an added row is an edit."""
    assert not same_track_content(DOV[:1], DOV)
    extra = (*DOV, TrackInterval(top_m=4.0, base_m=5.0, main_soil_codes=("ZA",)))
    assert not same_track_content(extra, DOV)


def test_field_log_values_compare_the_same_way() -> None:
    """A field-log track: the value is the content."""
    dov = (
        TrackInterval(top_m=0.0, base_m=1.5, value="groenbruin"),
        TrackInterval(top_m=1.5, base_m=5.0, value="grijs"),
    )
    assert same_track_content(tuple(reversed(dov)), dov)
    changed = (dov[0], TrackInterval(top_m=1.5, base_m=5.0, value="zwart"))
    assert not same_track_content(changed, dov)
