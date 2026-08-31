"""Carry user "Separate" rulings across a geotech re-subdivide.

The problem
-----------
A ``body_separation`` row anchors two geotech bands by their ``litho_layer`` ids
("the body containing layer_a is never the same body as the body containing
layer_b"). ``SubdivideAllBodies`` / ``DivideBoreholes`` throw every geotech band
away and rebuild it with a fresh ``uuid7``, and both anchor foreign keys are
``ON DELETE CASCADE`` — so Postgres removes the separation as a side effect of
the layer wipe, silently, exactly as it removed accepted ties before the tie
re-anchor existed. The engineer's "these are NOT the same body" ruling would
vanish on the next re-subdivide.

The rule
--------
This mirrors the tie re-anchor precedent (``geotech_tie_reanchor``), captured
before the reset and re-created after the rebuild inside the SAME transaction.
Each anchor is re-matched by the owner's three-part band identity:

1. **Same investigation, same depth interval, same NAD class** — the band came
   back untouched. Carried.
2. Failing that, **the single same-class band overlapping where the anchor was**
   — the same band with a boundary dragged. Carried.
3. Failing THAT — nothing overlapping, or several same-class candidates — the
   anchor is uncarryable. Unlike a tie, a separation has no ``review_reason``
   column to defer the question to the engineer, so the conservative answer is
   to DROP the separation (report it LOST, logged at WARNING) rather than risk
   re-pointing it onto the wrong mass and suppressing a body-join the engineer
   never forbade. An uncarryable ruling is never silent.

A separation whose two anchors resolve to ONE band (the two masses merged on
re-subdivide) is moot — a body cannot be separated from itself — and is reported
lost the same way.

Where it runs
-------------
``SubdivideAllBodies`` captures before its reset and re-anchors after the CPT
bands are materialised (against the rebuilt index PLUS the bands a scoped run
left standing). ``DivideBoreholes`` does the same around its borehole rebuild.
Both run the re-anchor BEFORE their post-rebuild body resolve, so the resolve
already honours the restored separations.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
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
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class CapturedSeparation:
    """A user separation, recorded before the reset destroys its anchors.

    Attributes
    ----------
    separation_id : UUID
        The id of the ``body_separation`` row before the reset. Kept for logging
        only — the re-created row gets a fresh ``uuid7`` because the old row is
        gone by then.
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
class MatchedSeparation:
    """A captured separation and the rebuilt bands it will be re-created against.

    Attributes
    ----------
    captured : CapturedSeparation
        The separation as it was before the reset.
    layer_a_id : UUID
        Canonical lesser new anchor id.
    layer_b_id : UUID
        Canonical greater new anchor id (``layer_a_id < layer_b_id``).
    """

    captured: CapturedSeparation
    layer_a_id: UUID
    layer_b_id: UUID


@dataclass(frozen=True)
class LostSeparation:
    """A separation that could not be re-anchored, and which anchors resolved.

    Attributes
    ----------
    captured : CapturedSeparation
        The captured separation being dropped.
    matched_a : bool
        Whether anchor A found a rebuilt band.
    matched_b : bool
        Whether anchor B found a rebuilt band. When BOTH are ``True`` the two
        anchors resolved to the SAME band (the masses fused), which is why the
        separation is still lost.
    """

    captured: CapturedSeparation
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
            f"separation {self.captured.separation_id}: "
            f"A={_describe_identity(self.captured.identity_a)} "
            f"B={_describe_identity(self.captured.identity_b)} [{verdict}]"
        )


@dataclass
class SeparationReanchorPlan:
    """Outcome of matching captured separations against the rebuilt bands.

    Attributes
    ----------
    matched : list[MatchedSeparation]
        Separations that will be re-created, each with its new anchor ids.
    lost : list[LostSeparation]
        Separations with at least one anchor that found no band (or whose anchors
        fused into one).
    skipped_duplicate : int
        Matched separations dropped because an earlier one already claimed the
        same ``(model, layer pair)`` — the DB uniqueness made visible instead of
        raised.
    """

    matched: list[MatchedSeparation] = field(default_factory=list)
    lost: list[LostSeparation] = field(default_factory=list)
    skipped_duplicate: int = 0


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


def plan_separation_reanchor(
    captured: Sequence[CapturedSeparation],
    rebuilt_bands: Sequence[RebuiltBand],
) -> SeparationReanchorPlan:
    """Match captured separations onto the bands the rebuild produced.

    Parameters
    ----------
    captured : Sequence[CapturedSeparation]
        Separations recorded before the reset.
    rebuilt_bands : Sequence[RebuiltBand]
        Every band the rebuild materialised (plus the bands a scoped run left
        standing), with their new layer ids.

    Returns
    -------
    SeparationReanchorPlan
        Matched separations with their new anchor ids, plus the losses.
    """
    by_identity: dict[BandIdentity, UUID] = {}
    by_investigation: dict[str, list[RebuiltBand]] = defaultdict(list)
    for band in rebuilt_bands:
        by_identity.setdefault(band.identity, band.layer_id)
        by_investigation[band.identity.investigation_id].append(band)

    plan = SeparationReanchorPlan()
    claimed: set[tuple[UUID, UUID]] = set()

    for sep in captured:
        new_a = _match_anchor(sep.identity_a, by_identity, by_investigation)
        new_b = _match_anchor(sep.identity_b, by_identity, by_investigation)
        if new_a is None or new_b is None:
            plan.lost.append(
                LostSeparation(
                    captured=sep, matched_a=new_a is not None, matched_b=new_b is not None
                )
            )
            continue
        if new_a == new_b:
            # Both anchors landed on one band — the two masses merged, so the
            # separation is moot (a body cannot be separated from itself).
            plan.lost.append(LostSeparation(captured=sep, matched_a=True, matched_b=True))
            continue
        layer_a_id, layer_b_id = (new_a, new_b) if new_a < new_b else (new_b, new_a)
        key = (layer_a_id, layer_b_id)
        if key in claimed:
            plan.skipped_duplicate += 1
            continue
        claimed.add(key)
        plan.matched.append(
            MatchedSeparation(captured=sep, layer_a_id=layer_a_id, layer_b_id=layer_b_id)
        )

    return plan


class BodySeparationReanchor(GroundModelLogger):
    """Capture user separations before a reset and re-anchor them after it.

    The two halves belong to the same transaction: ``capture`` runs before the
    layer wipe and ``reanchor`` after the rebuild, and the caller commits once.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session, owned by the caller.
    """

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
    ) -> list[CapturedSeparation]:
        """Record every separation of a model with its anchors' band identities.

        Must run before the reset: once the layer wipe fires, the anchors are
        gone and their investigation / depth / class can no longer be read. The
        two restrictions mirror the tie capture — a separation neither anchor of
        which the rebuild touches keeps its row and would be doubled if captured.

        Parameters
        ----------
        model_id : UUID
            The geotechnical model whose separations are captured.
        restrict_to_anchor_kind : str | None
            When given (``'cpt'`` / ``'borehole'``), keep only separations with
            at least one anchor on that kind of investigation — a rebuild that
            deletes only the borehole bands leaves a CPT↔CPT separation's row
            untouched.
        restrict_to_investigation_ids : set[UUID] | None
            When given, keep only separations with at least one anchor on one of
            these investigations — the columns a section-scoped rebuild is about
            to delete and re-create.

        Returns
        -------
        list[CapturedSeparation]
            One entry per separation whose two anchors could both be resolved.
            A separation with an unresolvable anchor is skipped and logged at
            WARNING — it is already broken and nothing can be carried.
        """
        scope_label = (
            "all"
            if restrict_to_investigation_ids is None
            else str(len(restrict_to_investigation_ids))
        )
        self.debug(
            f"BodySeparationReanchor.capture: model={model_id} "
            f"restrict_to_anchor_kind={restrict_to_anchor_kind} "
            f"restrict_to_investigations={scope_label}"
        )
        rows = (
            (
                await self._session.execute(
                    select(BodySeparationOrm).where(BodySeparationOrm.model_id == model_id)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            self.info(
                f"BodySeparationReanchor.capture: model={model_id} has no separation — "
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

        captured: list[CapturedSeparation] = []
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
                    f"BodySeparationReanchor.capture: separation {row.id} has an anchor that "
                    f"is not a resolvable geotech band "
                    f"(a={row.layer_a_id} {'ok' if entry_a else 'MISSING'}, "
                    f"b={row.layer_b_id} {'ok' if entry_b else 'MISSING'}) — "
                    f"it cannot be carried across the rebuild"
                )
                continue
            captured.append(
                CapturedSeparation(
                    separation_id=row.id,
                    identity_a=entry_a[0],
                    identity_b=entry_b[0],
                    anchor_kind_a=entry_a[1],
                    anchor_kind_b=entry_b[1],
                )
            )

        self.info(
            f"BodySeparationReanchor.capture: model={model_id} captured {len(captured)} "
            f"separation(s) ({unresolved} unresolvable anchor(s) skipped, "
            f"{out_of_scope} not touched by this rebuild)"
        )
        return captured

    async def reanchor(
        self,
        *,
        model_id: UUID,
        captured: list[CapturedSeparation],
        rebuilt_bands: list[RebuiltBand],
    ) -> SeparationReanchorPlan:
        """Re-create the captured separations against the rebuilt bands.

        A separation whose band is gone (or whose masses fused) is logged at
        WARNING with both anchors' identities and counted in the returned plan,
        never silently dropped.

        Parameters
        ----------
        model_id : UUID
            Model id stamped on each re-created separation.
        captured : list[CapturedSeparation]
            Separations recorded by :meth:`capture`.
        rebuilt_bands : list[RebuiltBand]
            Bands the rebuild materialised, plus any a scoped run left standing.

        Returns
        -------
        SeparationReanchorPlan
            Matched / lost / duplicate-skipped counts.
        """
        if not captured:
            return SeparationReanchorPlan()

        plan = plan_separation_reanchor(captured, rebuilt_bands)

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
                BodySeparationOrm(
                    id=uuid7(),
                    model_id=model_id,
                    layer_a_id=match.layer_a_id,
                    layer_b_id=match.layer_b_id,
                )
            )
            written += 1
        await self._session.flush()

        for lost in plan.lost:
            self.warning(f"BodySeparationReanchor.reanchor: separation LOST — {lost.describe()}")

        if plan.lost:
            self.warning(
                f"BodySeparationReanchor.reanchor: {len(plan.lost)} user separation(s) could "
                f"not be re-anchored to a rebuilt band and were dropped"
            )
        self.success(
            f"BodySeparationReanchor.reanchor: model={model_id} "
            f"re-anchored={written}/{len(captured)} lost={len(plan.lost)} "
            f"skipped_duplicate={plan.skipped_duplicate}"
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
            One canonical pair per persisted separation.
        """
        rows = (
            await self._session.execute(
                select(
                    BodySeparationOrm.layer_a_id,
                    BodySeparationOrm.layer_b_id,
                ).where(BodySeparationOrm.model_id == model_id)
            )
        ).all()
        return {(r.layer_a_id, r.layer_b_id) for r in rows}
