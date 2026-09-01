"""Carry user "Separate" rulings across a geotech re-subdivide.

A ``body_separation`` row (the "Separate" verb, debt #278 R5) anchors two geotech
bands by their ``litho_layer`` ids — "the body containing layer_a is never the same
body as the body containing layer_b". ``SubdivideAllBodies`` / ``DivideBoreholes``
throw every geotech band away and rebuild it with a fresh ``uuid7``, and the anchor
FKs are ``ON DELETE CASCADE``, so without a carry the engineer's ruling vanishes on
the next re-subdivide.

All the machinery lives in ``pair_ruling_reanchor`` (``_PairRulingReanchor`` + the
neutral dataclasses + the pure planner), shared with the "Join with…" verb. This
module is the thin separation specialisation: ``moot_is_loss=True`` — a separation
whose two anchors fuse onto ONE rebuilt band is LOST (a body cannot be separated
from itself). The separation-flavoured names (``CapturedSeparation``,
``plan_separation_reanchor``, …) are kept as back-compat aliases so existing callers
and tests import them from here unchanged.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, ClassVar

from groundmodel.application.geotech_tie_reanchor import RebuiltBand
from groundmodel.application.pair_ruling_reanchor import (
    CapturedPairRuling,
    LostPairRuling,
    MatchedPairRuling,
    PairRulingReanchorPlan,
    _PairRulingReanchor,
    plan_pair_ruling_reanchor,
)
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm

# Back-compat aliases — the first use of the shared shape was the "Separate" verb,
# and callers / tests import the separation-flavoured names from this module. Each
# IS the neutral class.
CapturedSeparation = CapturedPairRuling
MatchedSeparation = MatchedPairRuling
LostSeparation = LostPairRuling
SeparationReanchorPlan = PairRulingReanchorPlan


def plan_separation_reanchor(
    captured: Sequence[CapturedPairRuling],
    rebuilt_bands: Sequence[RebuiltBand],
) -> PairRulingReanchorPlan:
    """Back-compat wrapper: plan a SEPARATION re-anchor (fused → lost).

    Parameters
    ----------
    captured : Sequence[CapturedPairRuling]
        Separations recorded before the reset.
    rebuilt_bands : Sequence[RebuiltBand]
        The bands the rebuild produced.

    Returns
    -------
    PairRulingReanchorPlan
        The matched / lost / duplicate outcome, with the fused case counted as a
        loss (a separation cannot be carried onto one band).
    """
    return plan_pair_ruling_reanchor(captured, rebuilt_bands, moot_is_loss=True)


class BodySeparationReanchor(_PairRulingReanchor):
    """Capture user "Separate" rulings before a reset and re-anchor them after it.

    A fused pair is a LOSS — a body cannot be separated from itself (debt #278 R5).
    """

    orm_cls: ClassVar[type[Any]] = BodySeparationOrm
    noun: ClassVar[str] = "separation"
    moot_is_loss: ClassVar[bool] = True
