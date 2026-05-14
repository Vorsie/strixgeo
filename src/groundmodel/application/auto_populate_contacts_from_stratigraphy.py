"""Auto-populate FormationContact rows from a borehole's stratigraphy.

The geological-model editor's "Seed from stratigraphy" button
funnels through this use case. Per borehole:

* Resolve both stratigraphy streams: FORMAL_STRATIGRAPHY (the
  standardized regional classification, e.g. ``HyEg - Lid van
  Egem``) and INFORMAL_STRATIGRAPHY (the engineer's working name,
  e.g. ``Boom Klei``).
* Walk the FORMAL stream as the primary layer source (formal is
  the authoritative regional model). Fall through to walking the
  INFORMAL stream only when the borehole carries no formal
  observation.
* For each primary layer (including the topmost — ``top_m == 0`` is
  a valid contact, the top of the topmost formation), find a
  counterpart in the OTHER stream by max-overlap of the two
  intervals.
* Build the formation with the split DOV convention:
    name         = informal description (working name)
    regional_ref = formal description   (regional reference)
  Falling back to the primary stream's own description on whichever
  field has no counterpart.
* Match formations across boreholes by ``regional_ref`` when
  present (stable cross-borehole key — same formal code = same
  formation), falling back to ``name`` otherwise.
* Create a FormationContact at the layer's top depth, linked to
  the source observation + layer via ``observation_layer_id`` so
  re-running the button is idempotent.

The use case owns transaction discipline: one commit for the whole
batch. A partial-failure (e.g. FK violation mid-loop) rolls
everything back via the session's auto-rollback.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid6 import uuid7

from groundmodel.application.recompute_formation_surface import (
    RecomputeFormationSurface,
)
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Default colour palette for auto-created formations — cycles per
# formation, deterministic so the same description always lands on
# the same hue. Engineers rename + recolour after the auto-populate
# pass; this is just a "don't be invisible" default.
_DEFAULT_FORMATION_COLOURS = (
    "#a8a29e",  # warm grey
    "#fbbf24",  # amber
    "#a3e635",  # lime
    "#22d3ee",  # cyan
    "#a78bfa",  # violet
    "#fb7185",  # rose
    "#f97316",  # orange
    "#84cc16",  # green
    "#0ea5e9",  # sky
    "#c084fc",  # purple
)


def _palette_colour_for(name: str) -> str:
    """Stable hue from the formation name — same string → same colour."""
    h = 0
    for ch in name:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return _DEFAULT_FORMATION_COLOURS[h % len(_DEFAULT_FORMATION_COLOURS)]


@dataclass(frozen=True)
class AutoPopulateOutcome:
    """Summary of a single auto-populate run."""

    created_contact_ids: list[UUID]
    created_formation_ids: list[UUID]
    skipped_existing: int
    skipped_unmatched: int
    skipped_no_stratigraphy: int


class AutoPopulateContactsFromStratigraphy(GroundModelLogger):
    """Seed a geological model with contacts derived from DOV stratigraphy."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        borehole_ids: Iterable[UUID],
    ) -> AutoPopulateOutcome:
        """Walk every borehole in scope and seed contacts.

        Parameters
        ----------
        project_id : UUID
            The owning project — bounds the formation-name lookup so
            we don't reuse a formation belonging to a different
            project.
        model_id : UUID
            Geological model under which the new contacts land.
        borehole_ids : Iterable[UUID]
            Boreholes to process. Typically the set projected onto
            the active cross-section. Caller is responsible for
            scoping; this use case doesn't filter further.

        Returns
        -------
        AutoPopulateOutcome
            Counts + ids so the API layer can build a meaningful
            response and the frontend can patch local state by id.
        """
        borehole_id_list = list(borehole_ids)
        self.info(f"Auto-populate: model={model_id} boreholes={len(borehole_id_list)}")
        if not borehole_id_list:
            return AutoPopulateOutcome([], [], 0, 0, 0)

        # Eager-load every observation + every layer for every borehole
        # in scope in one round-trip. Stratigraphy streams are small
        # (typically <30 layers per borehole) so the up-front load
        # outweighs per-borehole lazy fetches.
        bh_stmt = (
            select(BoreholeOrm)
            .where(
                BoreholeOrm.id.in_(borehole_id_list),
                BoreholeOrm.app_project_id == project_id,
            )
            .options(selectinload(BoreholeOrm.observations).selectinload(ObservationOrm.layers))
        )
        boreholes = list((await self._session.execute(bh_stmt)).scalars().all())

        # Pre-load every existing contact in the model so the dedup
        # checks are O(1) per layer. Two indices needed:
        #
        # * ``used_layer_ids``: skip layers we've already auto-populated
        #   from (idempotency on observation_layer_id).
        # * ``occupied_anchor_formation``: skip layers whose
        #   (anchor, formation) tuple already has a contact, regardless
        #   of source. This is the "user overrides are absolute" rule —
        #   if the engineer manually placed a Boom Klei contact on
        #   borehole-X, re-running auto-populate must NOT add a second
        #   one alongside it. Same protection if the contact came from
        #   a previous auto-populate that the user then dragged or
        #   overwrote — the existence of the (anchor, formation) tuple
        #   wins, no matter how it got there.
        contact_rows = list(
            (
                await self._session.execute(
                    select(
                        FormationContactOrm.observation_layer_id,
                        FormationContactOrm.borehole_id,
                        FormationContactOrm.formation_id,
                    ).where(FormationContactOrm.model_id == model_id)
                )
            ).all()
        )
        used_layer_ids: set[UUID] = {row[0] for row in contact_rows if row[0] is not None}
        occupied_anchor_formation: set[tuple[UUID, UUID]] = {
            (row[1], row[2]) for row in contact_rows if row[1] is not None
        }

        # Pre-load every project formation. Two indices: a stable
        # cross-borehole key (regional_ref — formal stratigraphy code)
        # and a fallback name index for informal-only formations.
        # Lookups are case-insensitive — DOV layer descriptions arrive
        # in mixed case across imports.
        formations_stmt = select(GeologicalFormationOrm).where(
            GeologicalFormationOrm.app_project_id == project_id
        )
        existing_formations = list((await self._session.execute(formations_stmt)).scalars().all())
        formations_by_regional_ref: dict[str, GeologicalFormationOrm] = {
            f.regional_ref.lower(): f for f in existing_formations if f.regional_ref
        }
        formations_by_name: dict[str, GeologicalFormationOrm] = {
            f.name.lower(): f for f in existing_formations
        }
        next_display_order = (
            await self._session.execute(
                select(func.coalesce(func.max(GeologicalFormationOrm.display_order), -1)).where(
                    GeologicalFormationOrm.app_project_id == project_id
                )
            )
        ).scalar_one() + 1

        created_contact_ids: list[UUID] = []
        created_formation_ids: list[UUID] = []
        # Tracks every formation that received a new contact in this
        # run. Used to scope the post-batch surface recompute to just
        # the affected pairs (no point recomputing untouched formations).
        touched_formations: set[UUID] = set()
        skipped_existing = 0
        skipped_unmatched = 0
        skipped_no_stratigraphy = 0

        for borehole in boreholes:
            # Resolve both streams. Formal is the authoritative regional
            # source for layer boundaries when present; informal is
            # walked only when no formal observation exists.
            formal_obs = self._find_observation(
                borehole.observations, ObservationType.FORMAL_STRATIGRAPHY
            )
            informal_obs = self._find_observation(
                borehole.observations, ObservationType.INFORMAL_STRATIGRAPHY
            )
            if formal_obs is None and informal_obs is None:
                skipped_no_stratigraphy += 1
                self.debug(f"Borehole {borehole.id}: no stratigraphy observation, skipped")
                continue

            primary_obs = formal_obs if formal_obs is not None else informal_obs
            other_obs = informal_obs if formal_obs is not None else None
            assert primary_obs is not None  # narrowed by the guard above
            primary_is_formal = formal_obs is not None
            other_layers = list(other_obs.layers) if other_obs is not None else []

            for layer in primary_obs.layers:
                # Negative depth is invalid (parser bug or corrupt
                # source). top_m == 0 IS allowed — that's the topmost
                # formation's top, which the user explicitly wants.
                if layer.top_m < 0.0:
                    continue
                if layer.id in used_layer_ids:
                    skipped_existing += 1
                    continue
                primary_desc = (layer.description or "").strip()
                if not primary_desc:
                    skipped_unmatched += 1
                    self.debug(
                        f"Borehole {borehole.id} layer {layer.id}: empty description, skipped"
                    )
                    continue

                # Find counterpart layer in the other stream by max
                # interval-overlap. Returns None when no other stream,
                # or when no overlapping layer exists.
                counterpart = self._best_overlap(layer.top_m, layer.base_m, other_layers)
                counterpart_desc = (counterpart.description or "").strip() if counterpart else None

                # DOV split: name = informal description, regional_ref
                # = formal description. Each falls back to the primary
                # stream's own description on whichever side has no
                # counterpart.
                if primary_is_formal:
                    regional_ref: str | None = primary_desc
                    name = counterpart_desc or primary_desc
                else:
                    regional_ref = None  # informal-only borehole
                    name = primary_desc

                # Find or create. regional_ref is the cross-borehole
                # key when present (same formal code = same formation,
                # even if a different borehole used a different working
                # name). Falls back to the name index when no formal.
                formation: GeologicalFormationOrm | None = None
                if regional_ref:
                    formation = formations_by_regional_ref.get(regional_ref.lower())
                if formation is None:
                    formation = formations_by_name.get(name.lower())
                if formation is None:
                    formation = GeologicalFormationOrm(
                        id=uuid7(),
                        app_project_id=project_id,
                        name=name,
                        regional_ref=regional_ref,
                        color=_palette_colour_for(regional_ref or name),
                        display_order=next_display_order,
                    )
                    next_display_order += 1
                    self._session.add(formation)
                    if regional_ref:
                        formations_by_regional_ref[regional_ref.lower()] = formation
                    formations_by_name[name.lower()] = formation
                    created_formation_ids.append(formation.id)

                # USER OVERRIDES ARE ABSOLUTE — if a contact already
                # exists for this (borehole, formation) pair (whether
                # the user placed it manually, dragged an old auto-pick
                # to a different depth, or it survives from a previous
                # auto-populate), do NOT create a second one alongside
                # it. The user's existing pick wins.
                anchor_formation_key = (borehole.id, formation.id)
                if anchor_formation_key in occupied_anchor_formation:
                    skipped_existing += 1
                    self.debug(
                        f"Borehole {borehole.id} formation {formation.id}: "
                        f"existing contact preserved, layer auto-create skipped"
                    )
                    continue

                contact = FormationContactOrm(
                    id=uuid7(),
                    model_id=model_id,
                    formation_id=formation.id,
                    borehole_id=borehole.id,
                    depth_top_m=layer.top_m,
                    source="borehole_observation",
                    confidence="high",
                    observation_id=primary_obs.id,
                    observation_layer_id=layer.id,
                )
                self._session.add(contact)
                used_layer_ids.add(layer.id)
                occupied_anchor_formation.add(anchor_formation_key)
                touched_formations.add(formation.id)
                created_contact_ids.append(contact.id)

        # Refresh the TIN cache for every formation the auto-populate
        # actually touched. ``execute_many`` dedups so each pair runs
        # one Delaunay call regardless of how many contacts seeded it.
        await self._session.flush()
        await RecomputeFormationSurface(self._session).execute_many(
            (model_id, fid) for fid in touched_formations
        )
        await self._session.commit()
        self.success(
            f"Auto-populate done: model={model_id} "
            f"+{len(created_contact_ids)} contacts, "
            f"+{len(created_formation_ids)} formations, "
            f"skipped {skipped_existing} existing / "
            f"{skipped_unmatched} unmatched / "
            f"{skipped_no_stratigraphy} no-stratigraphy"
        )
        return AutoPopulateOutcome(
            created_contact_ids=created_contact_ids,
            created_formation_ids=created_formation_ids,
            skipped_existing=skipped_existing,
            skipped_unmatched=skipped_unmatched,
            skipped_no_stratigraphy=skipped_no_stratigraphy,
        )

    @staticmethod
    def _find_observation(
        observations: Iterable[ObservationOrm],
        kind: ObservationType,
    ) -> ObservationOrm | None:
        """Return the first observation of ``kind`` on the borehole, or None.

        A borehole's observations are unique per type in practice
        (DOV doesn't ship two formal stratigraphy interpretations
        for one boring), so "first match" is equivalent to "the
        match" — the helper is just a one-liner factored out so
        the use case body stays readable.
        """
        for obs in observations:
            if obs.observation_type == kind.value:
                return obs
        return None

    @staticmethod
    def _best_overlap(
        top_m: float,
        base_m: float,
        candidates: Iterable[object],
    ) -> object | None:
        """Find the candidate layer with the largest depth-interval overlap.

        Used to pair a primary-stream layer with its counterpart in
        the other stream (formal vs informal). Overlap is the
        intersection length: ``max(0, min(b1, b2) - max(t1, t2))``.
        Returns the candidate with max overlap; None when no
        candidate overlaps at all (no informal layer covers this
        depth range).

        Type-erased to ``object`` because callers pass
        ObservationLayerOrm rows with the same ``top_m`` / ``base_m``
        / ``description`` columns; static typing here would force a
        circular import for a one-line helper.
        """
        best: object | None = None
        best_overlap = 0.0
        for cand in candidates:
            cand_top = float(getattr(cand, "top_m"))
            cand_base = float(getattr(cand, "base_m"))
            overlap = min(base_m, cand_base) - max(top_m, cand_top)
            if overlap > best_overlap:
                best_overlap = overlap
                best = cand
        return best
