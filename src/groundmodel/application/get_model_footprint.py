"""Use case — re-derive the model's footprint ring from the last stored voxel build.

The 3-D viewer draws the model's footprint boundary as a subtle closed ring so
"the model ends here" reads as an EDGE, not a hole (owner ballot 2026-08-26,
v1.0 MVP). The ring must be the EXACT alpha hull ``BuildVoxelLithoModel``
clipped the labelling to — a client-side re-derivation would be a second
source of truth and could draw a boundary that does not match the geometry.

``LithoBuildGenerationOrm.payload`` persists the voxel build payload AS
RECEIVED, before any transform (see the comment at
``build_voxel_litho_model.py`` around ``sections_received = sections`` — it
says verbatim that the as-received projected-foot column positions are kept
precisely because "the footprint hull needs them"), so the hull is fully
reproducible from persisted state without re-running the build:

1. Rehydrate the stored ``payload["sections"]`` into
   :class:`~groundmodel.domain.services.voxel_litho.voxel_types.SectionPartitionInput`
   value objects via
   :func:`~groundmodel.application.litho_generation_payload.sections_from_generation_payload`
   — the exact inverse of the ``_generation_payload`` writer, in the same layer
   and, like the writer, free of any hand-listed field names.
2. Load the model's resolved picks
   (``LithoLayerRepository.load_body_picks``) and group them into
   per-investigation observed columns exactly as ``BuildVoxelLithoModel``
   does, so the SAME two hull inputs (the section columns' projected feet +
   the investigations' true drilled positions) are supplied here.
3. Call ``build_domain_from_sections`` (see
   ``groundmodel.domain.services.voxel_litho.build_domain_from_sections``)
   and return ``domain.polygon``.

Verified against the build code before writing this module (both checked by
reading ``build_voxel_litho_model.py`` directly, not assumed):

* Body-aliasing (``apply_body_aliases``) rewrites only ``region.body_id``
  values — never a column's ``world_x``/``world_y`` nor a region's polygon —
  so it cannot move the hull. This use case skips it entirely.
* The build calls ``build_domain_from_sections`` with ``sections_as_drawn``
  (the payload after aliasing but BEFORE ``apply_true_column_positions``
  re-seats columns onto their true map position), not the re-seated sections.
  Since aliasing never touches column or polygon geometry, ``sections_as_drawn``
  and the stored ``payload`` (captured even earlier, pre-alias) carry identical
  column positions and region polygons — the two differ only in ``body_id``
  labels, which ``build_domain_from_sections`` never reads. So rehydrating the
  stored payload reproduces the exact footprint input the build used. This use
  case therefore does NOT call ``apply_true_column_positions`` either.

"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.build_voxel_litho_model import _investigation_columns_from_picks
from groundmodel.application.litho_generation_payload import (
    sections_from_generation_payload,
)
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (
    build_domain_from_sections,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_NOT_BUILT_REASON = (
    'this model has not been built yet — click "Build 3-D model" first to see a footprint'
)
_PAYLOAD_UNREADABLE_REASON = (
    "the stored build payload could not be read (likely written by an older build) — "
    "rebuild the 3-D model to refresh it"
)
_FOOTPRINT_UNBUILDABLE_REASON = (
    "the investigations do not frame an area — a footprint needs at least 3 that do not "
    "sit on one line"
)


@dataclass(frozen=True)
class ModelFootprintOutcome:
    """Result of re-deriving a model's footprint ring from its last build.

    Parameters
    ----------
    polygon : list[tuple[float, float]]
        Closed ring of ``(x_m, y_m)`` vertices in the project CRS, WITHOUT a
        repeated last vertex — exactly what ``alpha_hull_polygon`` returns.
        Empty when no ring is available; see ``unavailable_reason``.
    generation_id : UUID | None
        The build generation the ring was derived from. ``None`` when
        ``polygon`` is empty because no generation exists at all.
    built_at : datetime | None
        That generation's ``created_at``. ``None`` alongside ``generation_id``.
    unavailable_reason : str | None
        Plain-English reason when ``polygon`` is empty. ``None`` when a ring
        was returned.
    """

    polygon: list[tuple[float, float]]
    generation_id: UUID | None = None
    built_at: datetime | None = None
    unavailable_reason: str | None = None


class GetModelFootprint(GroundModelLogger):
    """Re-derive a lithostratigraphic model's footprint ring from its last build.

    A pure read: no row is written, no build runs. Reads the latest
    :class:`~groundmodel.infrastructure.db.models.litho_build_generation_orm.LithoBuildGenerationOrm`
    row for the model and replays the same footprint computation
    ``BuildVoxelLithoModel`` ran, so the ring the viewer draws always matches
    the actual build geometry.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, model_id: UUID) -> ModelFootprintOutcome:
        """Return the footprint ring for ``model_id``'s last successful build.

        Never raises for a degenerate or missing build state — every failure
        mode answers an empty ``polygon`` with a human-readable
        ``unavailable_reason`` instead, so the 3-D viewer's footprint request
        never turns a "nothing built yet" state into an HTTP error.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to derive the footprint for.

        Returns
        -------
        ModelFootprintOutcome
            The ring (possibly empty) plus provenance / reason.
        """
        self.info(f"GetModelFootprint: model={model_id}")

        generation = await self._latest_generation(model_id)
        if generation is None:
            self.info(
                f"GetModelFootprint: model={model_id} — no build generation stored (never built)"
            )
            return ModelFootprintOutcome(polygon=[], unavailable_reason=_NOT_BUILT_REASON)

        try:
            sections = sections_from_generation_payload(generation.payload)
        except (KeyError, TypeError, ValueError) as err:
            top_level_keys = (
                sorted(generation.payload) if isinstance(generation.payload, dict) else []
            )
            self.warning(
                f"GetModelFootprint: model={model_id} generation={generation.id} — stored payload "
                f"could not be read ({type(err).__name__}: {err}); top-level keys found: "
                f"{top_level_keys}"
            )
            return ModelFootprintOutcome(
                polygon=[],
                generation_id=generation.id,
                built_at=generation.created_at,
                unavailable_reason=_PAYLOAD_UNREADABLE_REASON,
            )

        picks = await LithoLayerRepository(self._session).load_body_picks(model_id)
        investigation_columns = _investigation_columns_from_picks(picks)
        self.debug(
            f"GetModelFootprint: model={model_id} generation={generation.id} — "
            f"{len(sections)} section(s), honoring {len(investigation_columns)} investigation "
            f"column(s) from {len(picks)} pick(s)"
        )

        try:
            domain = build_domain_from_sections(
                sections,
                investigation_positions=tuple(
                    (c.investigation_id, c.world_x, c.world_y) for c in investigation_columns
                ),
            )
        except ValueError as err:
            self.warning(
                f"GetModelFootprint: model={model_id} generation={generation.id} — footprint "
                f"unbuildable — {err}"
            )
            return ModelFootprintOutcome(
                polygon=[],
                generation_id=generation.id,
                built_at=generation.created_at,
                unavailable_reason=_FOOTPRINT_UNBUILDABLE_REASON,
            )

        self.success(
            f"GetModelFootprint: model={model_id} generation={generation.id} — "
            f"{len(domain.polygon)}-vertex ring"
        )
        return ModelFootprintOutcome(
            polygon=list(domain.polygon),
            generation_id=generation.id,
            built_at=generation.created_at,
        )

    async def _latest_generation(self, model_id: UUID) -> LithoBuildGenerationOrm | None:
        """Return the most recently created build generation for ``model_id``.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model to scope the query to.

        Returns
        -------
        LithoBuildGenerationOrm | None
            The newest row by ``created_at``, or ``None`` if the model has
            never been built.
        """
        stmt = (
            select(LithoBuildGenerationOrm)
            .where(LithoBuildGenerationOrm.model_id == model_id)
            .order_by(LithoBuildGenerationOrm.created_at.desc())
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()
