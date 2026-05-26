"""Unit tests for ``auto_correlate_helpers``.

These tests cover the extracted ``_mutual_nearest_neighbour`` helper in
isolation from the formation-level auto-correlate orchestrator.  The
formation-level tests (``test_auto_correlate.py``) exercise the same
helper indirectly via the full pipeline; this module pins the helper's
behavioural contract on its own so the contact-level algorithm
(#133 Phase 2+3) can rely on it as a stable shared dep.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.auto_correlate_helpers import (
    _CandidatePair,
    _mnn_by_id,
    _mutual_nearest_neighbour,
    mutual_nearest_neighbour,
)


def _make_uuid(seed: int) -> UUID:
    """Deterministic UUID for test fixtures.

    Parameters
    ----------
    seed : int
        Integer seed used as the UUID's int representation.

    Returns
    -------
    UUID
        A deterministic UUID built from ``seed``.
    """
    return UUID(int=seed)


def test_mnn_empty_returns_empty() -> None:
    """No candidates → no survivors."""
    assert _mutual_nearest_neighbour([]) == []


def test_mnn_single_candidate_passes_through() -> None:
    """A lone candidate trivially survives MNN (it is its own best on both sides)."""
    fa = _make_uuid(1)
    fb = _make_uuid(2)
    cand = _CandidatePair(
        formation_a_id=fa,
        formation_b_id=fb,
        depth_a=1.0,
        depth_b=1.05,
        residual=0.05,
    )
    result = _mutual_nearest_neighbour([cand])
    assert result == [cand]


def test_mnn_drops_non_mutual_pair() -> None:
    """When A1's best B is B1 but B1's best A is A2 → drop the (A1, B1) pair.

    Setup: A1→B1 has residual 0.5, but A2→B1 has residual 0.1.  B1 prefers
    A2.  A1 has no other candidate.  The pair (A1, B1) is not mutual and
    must be dropped.  (A2, B1) remains mutual and survives.
    """
    fa1 = _make_uuid(1)
    fa2 = _make_uuid(2)
    fb1 = _make_uuid(10)
    c1 = _CandidatePair(
        formation_a_id=fa1,
        formation_b_id=fb1,
        depth_a=1.0,
        depth_b=1.5,
        residual=0.5,
    )
    c2 = _CandidatePair(
        formation_a_id=fa2,
        formation_b_id=fb1,
        depth_a=5.0,
        depth_b=5.1,
        residual=0.1,
    )
    result = _mutual_nearest_neighbour([c1, c2])
    assert len(result) == 1
    assert result[0].formation_a_id == fa2
    assert result[0].formation_b_id == fb1


def test_mnn_picks_best_when_multiple_competing() -> None:
    """Three A formations × two B formations: assignment must be 1:1 by best score."""
    fa1 = _make_uuid(1)
    fa2 = _make_uuid(2)
    fa3 = _make_uuid(3)
    fb1 = _make_uuid(10)
    fb2 = _make_uuid(11)

    candidates = [
        _CandidatePair(fa1, fb1, 1.0, 1.05, 0.05),  # A1 best for B1, B1 best for A1
        _CandidatePair(fa1, fb2, 1.0, 5.05, 4.05),
        _CandidatePair(fa2, fb1, 5.0, 1.05, 4.05),
        _CandidatePair(fa2, fb2, 5.0, 5.05, 0.05),  # A2 best for B2, B2 best for A2
        _CandidatePair(fa3, fb1, 9.0, 1.05, 7.95),
        _CandidatePair(fa3, fb2, 9.0, 5.05, 3.95),  # A3 has no mutual partner
    ]
    result = _mutual_nearest_neighbour(candidates)

    # Expect two surviving mutual pairs: (A1,B1) and (A2,B2).
    assert len(result) == 2
    pairs = {(c.formation_a_id, c.formation_b_id) for c in result}
    assert pairs == {(fa1, fb1), (fa2, fb2)}


def test_mnn_public_alias_matches_private() -> None:
    """``mutual_nearest_neighbour`` is the public alias for ``_mutual_nearest_neighbour``."""
    assert mutual_nearest_neighbour is _mutual_nearest_neighbour


@dataclass(frozen=True)
class _GenericItem:
    """Tiny stand-in dataclass for exercising ``_mnn_by_id`` directly.

    The generic core does not know about ``_CandidatePair``; this test
    fixture confirms that any (id_a, id_b, residual) projection works.
    """

    left: UUID
    right: UUID
    score: float


def test_mnn_by_id_works_on_custom_dataclass() -> None:
    """``_mnn_by_id`` operates on any item type given key + residual callables.

    Setup: three items between two pairs of ids.  Item ``c1`` has the
    lowest residual and ties up (L1, R1) mutually.  ``c2`` competes for
    R1 from a different left endpoint but loses on residual; it should
    be dropped.  ``c3`` is the unique candidate for (L2, R2) and
    survives trivially.
    """
    l1 = _make_uuid(101)
    l2 = _make_uuid(102)
    r1 = _make_uuid(201)
    r2 = _make_uuid(202)
    c1 = _GenericItem(left=l1, right=r1, score=0.1)
    c2 = _GenericItem(left=l2, right=r1, score=0.5)  # loses to c1 on R1
    c3 = _GenericItem(left=l2, right=r2, score=0.2)

    result = _mnn_by_id(
        [c1, c2, c3],
        key_a=lambda it: it.left,
        key_b=lambda it: it.right,
        residual=lambda it: it.score,
    )

    assert result == [c1, c3]
