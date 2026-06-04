"""Unit tests for ``auto_correlate_helpers._mnn_by_id``.

Pin the mutual-nearest-neighbour reducer's behavioural contract in isolation:
empty / single / non-mutual drop / 1:1 best assignment / deterministic
tie-break / generic-item support. ``_mnn_by_id`` is the live shared dependency
of the contact-level auto-correlate algorithm (#133); these tests guard it
directly (the old formation-level ``_CandidatePair`` wrapper was removed once
its only caller was its own test).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.auto_correlate_helpers import _mnn_by_id


@dataclass(frozen=True)
class _Item:
    """Tiny (id_a, id_b, residual) stand-in for exercising ``_mnn_by_id``."""

    a: UUID
    b: UUID
    r: float


def _uid(seed: int) -> UUID:
    """Deterministic UUID from an integer seed."""
    return UUID(int=seed)


def _mnn(items: list[_Item]) -> list[_Item]:
    """Run the reducer with the standard (a, b, r) projections."""
    return _mnn_by_id(items, key_a=lambda x: x.a, key_b=lambda x: x.b, residual=lambda x: x.r)


def test_empty_returns_empty() -> None:
    """No candidates → no survivors."""
    assert _mnn([]) == []


def test_single_candidate_passes_through() -> None:
    """A lone candidate trivially survives (its own best on both sides)."""
    item = _Item(a=_uid(1), b=_uid(2), r=0.05)
    assert _mnn([item]) == [item]


def test_drops_non_mutual_pair() -> None:
    """A1→B1 (residual 0.5) loses B1 to A2→B1 (residual 0.1); only (A2,B1) survives."""
    a1, a2, b1 = _uid(1), _uid(2), _uid(10)
    c1 = _Item(a=a1, b=b1, r=0.5)
    c2 = _Item(a=a2, b=b1, r=0.1)
    result = _mnn([c1, c2])
    assert result == [c2]


def test_picks_best_when_multiple_competing() -> None:
    """Three A × two B: assignment is 1:1 by best residual — (A1,B1) and (A2,B2)."""
    a1, a2, a3 = _uid(1), _uid(2), _uid(3)
    b1, b2 = _uid(10), _uid(11)
    items = [
        _Item(a1, b1, 0.05),  # A1 best for B1, B1 best for A1
        _Item(a1, b2, 4.05),
        _Item(a2, b1, 4.05),
        _Item(a2, b2, 0.05),  # A2 best for B2, B2 best for A2
        _Item(a3, b1, 7.95),
        _Item(a3, b2, 3.95),  # A3 has no mutual partner
    ]
    pairs = {(c.a, c.b) for c in _mnn(items)}
    assert pairs == {(a1, b1), (a2, b2)}


def test_breaks_ties_by_opposite_key() -> None:
    """Equal residuals competing for the same endpoint → the lower opposite UUID wins."""
    a = _uid(10)
    b_high, b_low = _uid(20), _uid(5)
    survivors = _mnn([_Item(a=a, b=b_high, r=0.5), _Item(a=a, b=b_low, r=0.5)])
    assert len(survivors) == 1
    assert survivors[0].b == b_low


def test_works_on_any_item_via_key_callables() -> None:
    """The generic core operates on any item type given key + residual callables."""

    @dataclass(frozen=True)
    class _Generic:
        left: UUID
        right: UUID
        score: float

    l1, l2 = _uid(101), _uid(102)
    r1, r2 = _uid(201), _uid(202)
    c1 = _Generic(left=l1, right=r1, score=0.1)
    c2 = _Generic(left=l2, right=r1, score=0.5)  # loses to c1 on R1
    c3 = _Generic(left=l2, right=r2, score=0.2)
    result = _mnn_by_id(
        [c1, c2, c3],
        key_a=lambda it: it.left,
        key_b=lambda it: it.right,
        residual=lambda it: it.score,
    )
    assert result == [c1, c3]
