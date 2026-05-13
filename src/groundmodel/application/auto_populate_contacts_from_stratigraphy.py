"""Auto-populate FormationContact rows from a borehole's stratigraphy.

The geological-model editor's "Apply stratigraphy" button funnels
through this use case. For each borehole in scope:

* Find a FORMAL_STRATIGRAPHY observation first; fall through to
  INFORMAL_STRATIGRAPHY only when no formal observation exists.
* For each layer in the chosen observation with ``top_m > 0`` (the
  surface itself is not a contact), find or auto-create a project
  formation matching the layer's description string.
* Create a FormationContact at that depth, linked to the source
  observation + layer via ``observation_layer_id`` so re-running
  the button is idempotent (an existing contact for that layer
  short-circuits before any mutation).

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

        # Pre-load every existing contact in the model so the
        # ``observation_layer_id`` dedup check is O(1) per layer.
        used_layer_ids: set[UUID] = {
            cid
            for cid in (
                await self._session.execute(
                    select(FormationContactOrm.observation_layer_id).where(
                        FormationContactOrm.model_id == model_id,
                        FormationContactOrm.observation_layer_id.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
            if cid is not None
        }

        # Pre-load every project formation. The (project_id, name)
        # lookup is case-insensitive — DOV layer descriptions arrive
        # in mixed case across imports, but two formations called
        # "Boom" and "boom" should resolve to the same project
        # formation when auto-populating.
        formations_stmt = select(GeologicalFormationOrm).where(
            GeologicalFormationOrm.app_project_id == project_id
        )
        formations_by_lower_name: dict[str, GeologicalFormationOrm] = {
            f.name.lower(): f
            for f in (await self._session.execute(formations_stmt)).scalars().all()
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
        skipped_existing = 0
        skipped_unmatched = 0
        skipped_no_stratigraphy = 0

        for borehole in boreholes:
            # Per the spec: formal wins. Fall through to informal only
            # when the borehole has NO formal stratigraphy observation.
            chosen = self._choose_observation(borehole.observations)
            if chosen is None:
                skipped_no_stratigraphy += 1
                self.debug(f"Borehole {borehole.id}: no stratigraphy observation, skipped")
                continue

            for layer in chosen.layers:
                # Surface — not a contact (the formation's TOP is at
                # the layer's top, and a layer starting at the
                # ground surface has nothing to anchor against).
                if layer.top_m <= 0.0:
                    continue
                if layer.id in used_layer_ids:
                    skipped_existing += 1
                    continue
                description = (layer.description or "").strip()
                if not description:
                    skipped_unmatched += 1
                    self.debug(
                        f"Borehole {borehole.id} layer {layer.id}: empty description, skipped"
                    )
                    continue

                # Find or create the matching formation. Case-insensitive
                # match on the trimmed description string.
                key = description.lower()
                formation = formations_by_lower_name.get(key)
                if formation is None:
                    formation = GeologicalFormationOrm(
                        id=uuid7(),
                        app_project_id=project_id,
                        name=description,
                        color=_palette_colour_for(description),
                        display_order=next_display_order,
                    )
                    next_display_order += 1
                    self._session.add(formation)
                    formations_by_lower_name[key] = formation
                    created_formation_ids.append(formation.id)

                contact = FormationContactOrm(
                    id=uuid7(),
                    model_id=model_id,
                    formation_id=formation.id,
                    borehole_id=borehole.id,
                    depth_top_m=layer.top_m,
                    source="borehole_observation",
                    confidence="high",
                    observation_id=chosen.id,
                    observation_layer_id=layer.id,
                )
                self._session.add(contact)
                used_layer_ids.add(layer.id)
                created_contact_ids.append(contact.id)

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
    def _choose_observation(
        observations: Iterable[ObservationOrm],
    ) -> ObservationOrm | None:
        """Pick the stratigraphy observation to use for a borehole.

        Formal wins on conflict — if the borehole has BOTH a
        FORMAL_STRATIGRAPHY and an INFORMAL_STRATIGRAPHY observation,
        formal's layers seed the contacts and informal is ignored.
        Falls through to informal only when no formal observation
        exists. Returns ``None`` when neither stream is present.
        """
        formal: ObservationOrm | None = None
        informal: ObservationOrm | None = None
        for obs in observations:
            if obs.observation_type == ObservationType.FORMAL_STRATIGRAPHY.value:
                formal = obs
                break  # formal short-circuits — we don't need informal
            if obs.observation_type == ObservationType.INFORMAL_STRATIGRAPHY.value:
                informal = obs
        return formal or informal
