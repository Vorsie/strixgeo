"""Carry user "Join with…" rulings across a geotech re-subdivide.

A ``body_union`` row (the "Join with…" verb, debt #278) anchors two geotech bands
by their ``litho_layer`` ids — "the body containing layer_a IS the body containing
layer_b". ``SubdivideAllBodies`` / ``DivideBoreholes`` throw every geotech band
away and rebuild it with a fresh ``uuid7``, and the anchor FKs are
``ON DELETE CASCADE``, so without a carry the engineer's "these ARE the same body"
ruling vanishes on the next re-subdivide.

The carry is identical to the "Separate" verb's, so all the machinery lives in
``pair_ruling_reanchor`` (``_PairRulingReanchor`` + the pure planner). This module
is the thin union specialisation: it flips the ONE behavioural difference —
``moot_is_loss=False`` — so a union whose two anchors fuse onto ONE rebuilt band is
SATISFIED (the two masses already merged, the must-link redundant), reported at
INFO, never the WARNING loss a separation records there.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, ClassVar

from groundmodel.application.geotech_tie_reanchor import RebuiltBand
from groundmodel.application.pair_ruling_reanchor import (
    CapturedPairRuling,
    PairRulingReanchorPlan,
    _PairRulingReanchor,
    plan_pair_ruling_reanchor,
)
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm

# The captured-ruling shape is verb-agnostic; callers / tests import it under a
# union-flavoured name. It IS ``CapturedPairRuling``.
CapturedUnion = CapturedPairRuling


def plan_union_reanchor(
    captured: Sequence[CapturedPairRuling],
    rebuilt_bands: Sequence[RebuiltBand],
) -> PairRulingReanchorPlan:
    """Plan a UNION re-anchor (fused → satisfied, never lost).

    Parameters
    ----------
    captured : Sequence[CapturedPairRuling]
        Unions recorded before the reset.
    rebuilt_bands : Sequence[RebuiltBand]
        The bands the rebuild produced.

    Returns
    -------
    PairRulingReanchorPlan
        The matched / lost / satisfied outcome, with a fused pair counted as
        satisfied (the masses already merged, so the join is redundant).
    """
    return plan_pair_ruling_reanchor(captured, rebuilt_bands, moot_is_loss=False)


class BodyUnionReanchor(_PairRulingReanchor):
    """Capture user "Join with…" rulings before a reset and re-anchor them after it.

    A fused pair is SATISFIED, not a loss — the two masses merged, so the
    must-link is redundant (debt #278).
    """

    orm_cls: ClassVar[type[Any]] = BodyUnionOrm
    noun: ClassVar[str] = "union"
    moot_is_loss: ClassVar[bool] = False
