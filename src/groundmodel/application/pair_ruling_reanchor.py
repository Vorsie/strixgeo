"""Carry user pair-rulings across a geotech re-subdivide — the shared machinery.

Two verbs write a "this pair of bands" ruling the resolver honours: **Separate**
(a cannot-link — "these are NOT the same body") and **Join with…** (a must-link —
"these ARE the same body"). Both anchor two geotech bands by their ``litho_layer``
ids; both have ``ON DELETE CASCADE`` anchor FKs, so ``SubdivideAllBodies`` /
``DivideBoreholes`` — which throw every geotech band away and rebuild it with a
fresh ``uuid7`` — silently take the ruling with them unless it is carried across.

The carry is identical for both, so the matcher and the capture/reanchor plumbing
live here ONCE. ``body_separation_reanchor`` and ``body_union_reanchor`` are the
two thin verb specialisations that import from this module and set three class
attributes:

* ``orm_cls`` — which table the ruling rows live in;
* ``noun`` — the word the logs use ("separation" / "union");
* ``moot_is_loss`` — the ONE behavioural difference. When both anchors re-anchor
  onto ONE rebuilt band the two masses fused: a **separation** is then LOST (a
  body cannot be separated from itself), but a **union** is SATISFIED (already one
  mass, the must-link redundant) — dropped at INFO, never a WARNING loss.

Each anchor is re-matched by the owner's three-part band identity:

1. **Same investigation, same depth interval, same NAD class** — the band came
   back untouched. Carried.
2. Failing that, **the single same-class band overlapping where the anchor was**
   — the same band with a boundary dragged. Carried.
3. Failing THAT — nothing overlapping, or several same-class candidates — the
   anchor is uncarryable. A pair ruling has no ``review_reason`` column to defer
   the question to the engineer, so the conservative answer is to DROP the ruling
   (report it LOST, logged at WARNING) rather than risk re-pointing it onto the
   wrong mass. An uncarryable ruling is never silent.

Where it runs
-------------
``SubdivideAllBodies`` captures before its reset and re-anchors after the CPT
bands are materialised (against the rebuilt index PLUS the bands a scoped run left
standing). ``DivideBoreholes`` does the same around its borehole rebuild. Both run
the re-anchor BEFORE their post-rebuild body resolve, so the resolve already
honours the restored rulings.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, ClassVar
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.geotech_tie_reanchor import (
    BandIdentity,
    RebuiltBand,
    load_band_identities,
    overlap_mm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class CapturedPairRuling:
    """A user pair ruling, recorded before the reset destroys its anchors.

    Attributes
    ----------
    separation_id : UUID
        The id of the ruling row before the reset (a ``body_separation`` or
        ``body_union`` id). Kept for logging only — the re-created row gets a
        fresh ``uuid7`` because the old row is gone by then. The field name is
        retained from the first (separation) use for back-compat with callers and
        tests that build it by hand.
    identity_a : BandIdentity
        Three-part identity (investigation / depth interval / NAD class) of
        anchor A's band.
    identity_b : BandIdentity
        Same for anchor B.
    anchor_kind_a : str
        ``'cpt'`` or ``'borehole'`` for anchor A.
    anchor_kind_b : str
        Same for anchor B.
    """

    separation_id: UUID
    identity_a: BandIdentity
    identity_b: BandIdentity
    anchor_kind_a: str
    anchor_kind_b: str


@dataclass(frozen=True)
class MatchedPairRuling:
    """A captured ruling and the rebuilt bands it will be re-created against.

    Attributes
    ----------
    captured : CapturedPairRuling
        The ruling as it was before the reset.
    layer_a_id : UUID
        Canonical lesser new anchor id.
    layer_b_id : UUID
        Canonical greater new anchor id (``layer_a_id < layer_b_id``).
    """

    captured: CapturedPairRuling
    layer_a_id: UUID
    layer_b_id: UUID


@dataclass(frozen=True)
class LostPairRuling:
    """A ruling that could not be re-anchored, and which anchors resolved.

    Attributes
    ----------
    captured : CapturedPairRuling
        The captured ruling being dropped.
    matched_a : bool
        Whether anchor A found a rebuilt band.
    matched_b : bool
        Whether anchor B found a rebuilt band. When BOTH are ``True`` the two
        anchors resolved to the SAME band (the masses fused) — a loss only for a
        separation (a union treats that as satisfied, never a loss).
    """

    captured: CapturedPairRuling
    matched_a: bool
    matched_b: bool

    def describe(self) -> str:
        """One-line human description naming both anchors and their verdicts."""
        if self.matched_a and self.matched_b:
            verdict = "both anchors resolved to one band (masses fused)"
        else:
            verdict = (
                f"A={'matched' if self.matched_a else 'band_absent'} "
                f"B={'matched' if self.matched_b else 'band_absent'}"
            )
        return (
            f"{self.captured.separation_id}: "
            f"A={_describe_identity(self.captured.identity_a)} "
            f"B={_describe_identity(self.captured.identity_b)} [{verdict}]"
        )


@dataclass
class PairRulingReanchorPlan:
    """Outcome of matching captured rulings against the rebuilt bands.

    Attributes
    ----------
    matched : list[MatchedPairRuling]
        Rulings that will be re-created, each with its new anchor ids.
    lost : list[LostPairRuling]
        Rulings with at least one anchor that found no band (or, for a
        separation, whose anchors fused into one).
    skipped_duplicate : int
        Matched rulings dropped because an earlier one already claimed the same
        ``(model, layer pair)`` — the DB uniqueness made visible instead of
        raised.
    satisfied : list[CapturedPairRuling]
        Rulings whose two anchors fused onto ONE rebuilt band AND for which that
        is NOT a loss (a union: the masses already merged, so the must-link is
        redundant). Always empty for a separation.
    """

    matched: list[MatchedPairRuling] = field(default_factory=list)
    lost: list[LostPairRuling] = field(default_factory=list)
    skipped_duplicate: int = 0
    satisfied: list[CapturedPairRuling] = field(default_factory=list)


def _describe_identity(identity: BandIdentity) -> str:
    """Render a band identity for a log line."""
    return (
        f"inv={identity.investigation_id} "
        f"{identity.depth_top_mm / 1000.0:.3f}-{identity.depth_base_mm / 1000.0:.3f} m "
        f"nad={identity.nad_class}"
    )


def _match_anchor(
    identity: BandIdentity,
    by_identity: dict[BandIdentity, UUID],
    by_investigation: dict[str, list[RebuiltBand]],
) -> UUID | None:
    """Find the rebuilt band an anchor re-anchors onto, or ``None``.

    Tier 1: exact three-part identity. Tier 2: the single same-class band
    overlapping where the anchor was (a moved boundary). Anything else —
    nothing overlapping, or an ambiguous set of candidates — is uncarryable.

    Parameters
    ----------
    identity : BandIdentity
        The captured anchor's identity.
    by_identity : dict[BandIdentity, UUID]
        Exact-identity → new layer id.
    by_investigation : dict[str, list[RebuiltBand]]
        Every rebuilt band, grouped by investigation.

    Returns
    -------
    UUID | None
        The new layer id, or ``None`` when the anchor is uncarryable.
    """
    exact = by_identity.get(identity)
    if exact is not None:
        return exact
    same_class = [
        band
        for band in by_investigation.get(identity.investigation_id, [])
        if band.identity.nad_class == identity.nad_class and overlap_mm(identity, band) > 0
    ]
    if len(same_class) == 1:
        return same_class[0].layer_id
    return None


def plan_pair_ruling_reanchor(
    captured: Sequence[CapturedPairRuling],
    rebuilt_bands: Sequence[RebuiltBand],
    *,
    moot_is_loss: bool,
) -> PairRulingReanchorPlan:
    """Match captured rulings onto the bands the rebuild produced.

    Parameters
    ----------
    captured : Sequence[CapturedPairRuling]
        Rulings recorded before the reset.
    rebuilt_bands : Sequence[RebuiltBand]
        Every band the rebuild materialised (plus the bands a scoped run left
        standing), with their new layer ids.
    moot_is_loss : bool
        When ``True`` (a separation), a ruling whose two anchors fused onto one
        band is LOST (a body cannot be separated from itself). When ``False`` (a
        union), the fused case is SATISFIED — the masses already merged — and
        goes to ``plan.satisfied`` instead.

    Returns
    -------
    PairRulingReanchorPlan
        Matched rulings with their new anchor ids, plus the losses / satisfied.
    """
    by_identity: dict[BandIdentity, UUID] = {}
    by_investigation: dict[str, list[RebuiltBand]] = defaultdict(list)
    for band in rebuilt_bands:
        by_identity.setdefault(band.identity, band.layer_id)
        by_investigation[band.identity.investigation_id].append(band)

    plan = PairRulingReanchorPlan()
    claimed: set[tuple[UUID, UUID]] = set()

    for ruling in captured:
        new_a = _match_anchor(ruling.identity_a, by_identity, by_investigation)
        new_b = _match_anchor(ruling.identity_b, by_identity, by_investigation)
        if new_a is None or new_b is None:
            plan.lost.append(
                LostPairRuling(
                    captured=ruling, matched_a=new_a is not None, matched_b=new_b is not None
                )
            )
            continue
        if new_a == new_b:
            # Both anchors landed on one band — the two masses merged. A
            # separation is moot-and-lost here; a union is satisfied-by-geometry.
            if moot_is_loss:
                plan.lost.append(LostPairRuling(captured=ruling, matched_a=True, matched_b=True))
            else:
                plan.satisfied.append(ruling)
            continue
        layer_a_id, layer_b_id = (new_a, new_b) if new_a < new_b else (new_b, new_a)
        key = (layer_a_id, layer_b_id)
        if key in claimed:
            plan.skipped_duplicate += 1
            continue
        claimed.add(key)
        plan.matched.append(
            MatchedPairRuling(captured=ruling, layer_a_id=layer_a_id, layer_b_id=layer_b_id)
        )

    return plan


class _PairRulingReanchor(GroundModelLogger):
    """Capture user pair-rulings before a reset and re-anchor them after it.

    The two halves belong to the same transaction: ``capture`` runs before the
    layer wipe and ``reanchor`` after the rebuild, and the caller commits once.
    Subclasses set the three class attributes; the plumbing here is verb-agnostic.

    Attributes
    ----------
    orm_cls : type[Any]
        The ORM class the rulings live in (``BodySeparationOrm`` /
        ``BodyUnionOrm``). Typed ``type[Any]`` — the generic plumbing reads
        ``orm_cls.model_id`` / ``.layer_a_id`` etc. as SQLAlchemy column
        expressions, which a concrete ``type[Base]`` bound would hide.
    noun : str
        The word the logs use ("separation" / "union").
    moot_is_loss : bool
        Whether a fused pair (both anchors → one band) is a loss.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session, owned by the caller.
    """

    orm_cls: ClassVar[type[Any]]
    noun: ClassVar[str]
    moot_is_loss: ClassVar[bool]

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def capture(
        self,
        model_id: UUID,
        *,
        restrict_to_anchor_kind: str | None = None,
        restrict_to_investigation_ids: set[UUID] | None = None,
    ) -> list[CapturedPairRuling]:
        """Record every ruling of a model with its anchors' band identities.

        Must run before the reset: once the layer wipe fires, the anchors are
        gone and their investigation / depth / class can no longer be read. The
        two restrictions mirror the tie capture — a ruling neither anchor of which
        the rebuild touches keeps its row and would be doubled if captured.

        Parameters
        ----------
        model_id : UUID
            The geotechnical model whose rulings are captured.
        restrict_to_anchor_kind : str | None
            When given (``'cpt'`` / ``'borehole'``), keep only rulings with at
            least one anchor on that kind of investigation.
        restrict_to_investigation_ids : set[UUID] | None
            When given, keep only rulings with at least one anchor on one of these
            investigations — the columns a section-scoped rebuild is about to
            delete and re-create.

        Returns
        -------
        list[CapturedPairRuling]
            One entry per ruling whose two anchors could both be resolved. A
            ruling with an unresolvable anchor is skipped and logged at WARNING —
            it is already broken and nothing can be carried.
        """
        cls_name = type(self).__name__
        scope_label = (
            "all"
            if restrict_to_investigation_ids is None
            else str(len(restrict_to_investigation_ids))
        )
        self.debug(
            f"{cls_name}.capture: model={model_id} "
            f"restrict_to_anchor_kind={restrict_to_anchor_kind} "
            f"restrict_to_investigations={scope_label}"
        )
        rows = (
            (
                await self._session.execute(
                    select(self.orm_cls).where(self.orm_cls.model_id == model_id)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            self.info(
                f"{cls_name}.capture: model={model_id} has no {self.noun} — "
                f"nothing to carry across the rebuild"
            )
            return []

        scoped_keys = (
            None
            if restrict_to_investigation_ids is None
            else {str(inv_id) for inv_id in restrict_to_investigation_ids}
        )
        anchor_ids = {r.layer_a_id for r in rows} | {r.layer_b_id for r in rows}
        identities = await load_band_identities(self._session, anchor_ids)

        captured: list[CapturedPairRuling] = []
        unresolved = 0
        out_of_scope = 0
        for row in rows:
            entry_a = identities.get(row.layer_a_id)
            entry_b = identities.get(row.layer_b_id)
            if (
                restrict_to_anchor_kind is not None
                and entry_a is not None
                and entry_b is not None
                and restrict_to_anchor_kind not in (entry_a[1], entry_b[1])
            ):
                out_of_scope += 1
                continue
            if (
                scoped_keys is not None
                and entry_a is not None
                and entry_b is not None
                and entry_a[0].investigation_id not in scoped_keys
                and entry_b[0].investigation_id not in scoped_keys
            ):
                out_of_scope += 1
                continue
            if entry_a is None or entry_b is None:
                unresolved += 1
                self.warning(
                    f"{cls_name}.capture: {self.noun} {row.id} has an anchor that "
                    f"is not a resolvable geotech band "
                    f"(a={row.layer_a_id} {'ok' if entry_a else 'MISSING'}, "
                    f"b={row.layer_b_id} {'ok' if entry_b else 'MISSING'}) — "
                    f"it cannot be carried across the rebuild"
                )
                continue
            captured.append(
                CapturedPairRuling(
                    separation_id=row.id,
                    identity_a=entry_a[0],
                    identity_b=entry_b[0],
                    anchor_kind_a=entry_a[1],
                    anchor_kind_b=entry_b[1],
                )
            )

        self.info(
            f"{cls_name}.capture: model={model_id} captured {len(captured)} "
            f"{self.noun}(s) ({unresolved} unresolvable anchor(s) skipped, "
            f"{out_of_scope} not touched by this rebuild)"
        )
        return captured

    async def reanchor(
        self,
        *,
        model_id: UUID,
        captured: list[CapturedPairRuling],
        rebuilt_bands: list[RebuiltBand],
    ) -> PairRulingReanchorPlan:
        """Re-create the captured rulings against the rebuilt bands.

        A ruling whose band is gone is logged at WARNING with both anchors'
        identities and counted in the returned plan, never silently dropped. A
        fused pair is a WARNING loss for a separation, an INFO "satisfied" for a
        union.

        Parameters
        ----------
        model_id : UUID
            Model id stamped on each re-created ruling.
        captured : list[CapturedPairRuling]
            Rulings recorded by :meth:`capture`.
        rebuilt_bands : list[RebuiltBand]
            Bands the rebuild materialised, plus any a scoped run left standing.

        Returns
        -------
        PairRulingReanchorPlan
            Matched / lost / satisfied / duplicate-skipped counts.
        """
        cls_name = type(self).__name__
        if not captured:
            return PairRulingReanchorPlan()

        plan = plan_pair_ruling_reanchor(captured, rebuilt_bands, moot_is_loss=self.moot_is_loss)

        # Nothing should remain (the reset's cascade emptied the table for this
        # model), but re-reading is cheap and makes the pass safe to call anywhere.
        existing = await self._load_existing_keys(model_id)

        written = 0
        for match in plan.matched:
            key = (match.layer_a_id, match.layer_b_id)
            if key in existing:
                plan.skipped_duplicate += 1
                continue
            existing.add(key)
            self._session.add(
                self.orm_cls(
                    id=uuid7(),
                    model_id=model_id,
                    layer_a_id=match.layer_a_id,
                    layer_b_id=match.layer_b_id,
                )
            )
            written += 1
        await self._session.flush()

        for lost in plan.lost:
            self.warning(f"{cls_name}.reanchor: {self.noun} LOST — {lost.describe()}")
        for sat in plan.satisfied:
            # A union whose masses fused is honoured by geometry — not a loss.
            self.info(
                f"{cls_name}.reanchor: {self.noun} satisfied by geometry (anchors fused) — "
                f"A={_describe_identity(sat.identity_a)} B={_describe_identity(sat.identity_b)}"
            )

        if plan.lost:
            self.warning(
                f"{cls_name}.reanchor: {len(plan.lost)} user {self.noun}(s) could "
                f"not be re-anchored to a rebuilt band and were dropped"
            )
        self.success(
            f"{cls_name}.reanchor: model={model_id} "
            f"re-anchored={written}/{len(captured)} lost={len(plan.lost)} "
            f"satisfied={len(plan.satisfied)} skipped_duplicate={plan.skipped_duplicate}"
        )
        return plan

    async def _load_existing_keys(self, model_id: UUID) -> set[tuple[UUID, UUID]]:
        """Load the ``(layer_a_id, layer_b_id)`` pairs already present for the model.

        Parameters
        ----------
        model_id : UUID
            The geotech model.

        Returns
        -------
        set[tuple[UUID, UUID]]
            One canonical pair per persisted ruling.
        """
        rows = (
            await self._session.execute(
                select(
                    self.orm_cls.layer_a_id,
                    self.orm_cls.layer_b_id,
                ).where(self.orm_cls.model_id == model_id)
            )
        ).all()
        return {(r.layer_a_id, r.layer_b_id) for r in rows}
