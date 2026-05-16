"""Unit tests for the dedupe survivor-selection key (debt #38).

``_survivor_priority`` is the pure function that decides WHICH contact
survives in a duplicate (model, anchor, formation) group. Dedupe
determinism is exactly this ordering, so it gets a focused pure test
that runs in the pre-commit unit suite (no DB) — a regression here
would silently keep the wrong pick and the integration tests are the
only thing that would catch it today.

Lower tuple value wins (ascending sort, ``members[0]`` survives).
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from groundmodel.application.deduplicate_formation_contacts import (
    _survivor_priority,
)

_UNSET = object()


def _c(
    *,
    source: str = "manual_pick",
    observation_layer_id: object | None = None,
    created_at: datetime | None | object = _UNSET,
) -> SimpleNamespace:
    # Sentinel so a caller can pass created_at=None explicitly (the
    # "row has no timestamp" case) without it being defaulted away.
    resolved = datetime(2026, 1, 1, tzinfo=UTC) if created_at is _UNSET else created_at
    return SimpleNamespace(
        source=source,
        observation_layer_id=observation_layer_id,
        created_at=resolved,
    )


def test_source_rank_orders_manual_over_interpolated_over_observation() -> None:
    """manual_pick beats interpolated beats borehole_observation."""
    manual = _survivor_priority(_c(source="manual_pick"))
    interp = _survivor_priority(_c(source="interpolated"))
    obs = _survivor_priority(_c(source="borehole_observation"))
    # Manual edits beat any auto-derived row.
    assert manual < interp < obs


def test_unknown_source_sorts_last() -> None:
    """An unrecognised source gets the sentinel rank 99 (sorts last)."""
    known = _survivor_priority(_c(source="manual_pick"))
    unknown = _survivor_priority(_c(source="something_new"))
    assert known < unknown
    # The unknown-source rank is the documented sentinel (99).
    assert _survivor_priority(_c(source="zzz"))[0] == 99


def test_observation_layer_provenance_breaks_a_source_tie() -> None:
    """Within one source, a row with observation provenance wins."""
    # Same source → the row WITH provenance (observation_layer_id set)
    # wins. This keeps auto-populate idempotent on re-run.
    with_prov = _survivor_priority(
        _c(source="borehole_observation", observation_layer_id="layer-1")
    )
    without_prov = _survivor_priority(_c(source="borehole_observation", observation_layer_id=None))
    assert with_prov < without_prov


def test_recency_breaks_a_full_tie() -> None:
    """With source + provenance tied, the most-recent contact wins."""
    # Same source + same provenance state → most-recent created_at wins.
    older = _survivor_priority(_c(created_at=datetime(2026, 1, 1, tzinfo=UTC)))
    newer = _survivor_priority(_c(created_at=datetime(2026, 6, 1, tzinfo=UTC)))
    assert newer < older


def test_source_rank_dominates_recency() -> None:
    """Source rank is primary: an old manual pick beats a new interpolated."""
    # A brand-new interpolated row must NOT beat an old manual pick —
    # source rank is the primary key, recency only the final tiebreak.
    old_manual = _survivor_priority(
        _c(source="manual_pick", created_at=datetime(2020, 1, 1, tzinfo=UTC))
    )
    new_interp = _survivor_priority(
        _c(source="interpolated", created_at=datetime(2026, 12, 31, tzinfo=UTC))
    )
    assert old_manual < new_interp


def test_missing_created_at_is_tolerated() -> None:
    """A null created_at yields a 0.0 recency component, no crash."""
    # created_at None → 0.0 recency component, no crash.
    assert _survivor_priority(_c(created_at=None))[2] == 0.0
