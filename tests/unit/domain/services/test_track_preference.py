"""Which track the sections draw when a borehole carries several of one kind.

The session main's rule (2026-09-29), in its own words: "the manual one wins if
present, else the newest edited, else today's rule". Today's rule is the first
observation of that kind in ``observation_date`` order (the ORM relationship's
``order_by``). ONE helper, used by every consumer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from groundmodel.domain.services.track_preference import (
    order_by_track_preference,
    preferred_track,
)


@dataclass
class _Obs:
    """Structural stand-in for an observation row / response."""

    name: str
    observation_type: str
    source: str = "dov"
    edited_manually_at: datetime | None = None


_T1 = datetime(2026, 9, 1, tzinfo=UTC)
_T2 = datetime(2026, 9, 20, tzinfo=UTC)


def test_with_only_imported_tracks_the_first_in_date_order_wins() -> None:
    """Today's rule is unchanged when nobody edited anything."""
    tracks = [_Obs("old", "coded_lithology"), _Obs("new", "coded_lithology")]
    assert preferred_track(tracks, "coded_lithology").name == "old"


def test_a_manual_track_wins_over_an_imported_one() -> None:
    """The manual one wins if present — even when it sorts last by date."""
    tracks = [
        _Obs("dov", "coded_lithology"),
        _Obs("hand", "coded_lithology", source="manual", edited_manually_at=_T1),
    ]
    assert preferred_track(tracks, "coded_lithology").name == "hand"


def test_an_edited_import_wins_over_an_untouched_import() -> None:
    """Else the newest edited."""
    tracks = [
        _Obs("untouched", "formal_stratigraphy"),
        _Obs("edited", "formal_stratigraphy", edited_manually_at=_T1),
    ]
    assert preferred_track(tracks, "formal_stratigraphy").name == "edited"


def test_between_two_edited_imports_the_newest_edit_wins() -> None:
    """Newest edited: the later edit timestamp comes first."""
    tracks = [
        _Obs("edited-early", "formal_stratigraphy", edited_manually_at=_T1),
        _Obs("edited-late", "formal_stratigraphy", edited_manually_at=_T2),
    ]
    assert preferred_track(tracks, "formal_stratigraphy").name == "edited-late"


def test_a_manual_track_beats_a_more_recently_edited_import() -> None:
    """Manual outranks edited, whatever the timestamps say."""
    tracks = [
        _Obs("edited", "coded_lithology", edited_manually_at=_T2),
        _Obs("hand", "coded_lithology", source="manual", edited_manually_at=_T1),
    ]
    assert preferred_track(tracks, "coded_lithology").name == "hand"


def test_no_track_of_that_kind_answers_none() -> None:
    """A borehole without the kind has no preferred track."""
    assert preferred_track([_Obs("a", "coded_lithology")], "formal_stratigraphy") is None


def test_ordering_puts_each_kinds_preferred_track_first_and_keeps_the_rest_stable() -> None:
    """The detail response is ordered so a consumer's first-match lookup finds the winner.

    Kinds keep their first-appearance order; within a kind the preferred track
    leads and the untouched imports keep their date order.
    """
    tracks = [
        _Obs("strat-dov", "formal_stratigraphy"),
        _Obs("lith-dov-1", "coded_lithology"),
        _Obs("lith-dov-2", "coded_lithology"),
        _Obs("lith-hand", "coded_lithology", source="manual", edited_manually_at=_T1),
    ]
    ordered = [t.name for t in order_by_track_preference(tracks)]
    assert ordered == ["strat-dov", "lith-hand", "lith-dov-1", "lith-dov-2"]


def test_the_winner_can_be_restricted_to_tracks_with_intervals() -> None:
    """A consumer that needs layers (the litho suggester) skips an empty winner."""

    @dataclass
    class _WithLayers(_Obs):
        layers: tuple = ()

    tracks = [
        _WithLayers("dov", "coded_lithology", layers=(1,)),
        _WithLayers("hand-empty", "coded_lithology", source="manual", edited_manually_at=_T1),
    ]
    winner = preferred_track(tracks, "coded_lithology", require=lambda t: bool(t.layers))
    assert winner.name == "dov"
