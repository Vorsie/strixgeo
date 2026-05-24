"""Pydantic schema: :class:`CreateLithoLensResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.cross_section import CrossSectionResponse


class CreateLithoLensResponse(BaseModel):
    """Body returned by ``POST .../geology/models/{model_id}/lenses``.

    Parameters
    ----------
    lens_id : UUID
        The newly-created :class:`LithoLens` entity id.
    synthetic_contact_ids : list[UUID]
        :class:`FormationContact` rows committed as wedge-tip synthetic
        contacts — one per absent column per side where geometry was
        computable.  An absent column with no computable geometry on
        either side contributes zero ids (the error is raised only when
        ALL absent columns fail to produce any synthetic contact).
    skipped_absent_count : int
        Number of absent investigations for which wedge-tip geometry
        could not be computed.  Non-zero means the lens is under-
        constrained on at least one side; the user should add a present
        contact closer to the absent column and re-edit the lens.
    updated_section : CrossSectionResponse
        The section row after all new synthetic contact ids were unioned
        into ``seeded_formation_contact_ids`` (explicit-content
        invariant).
    """

    lens_id: UUID
    synthetic_contact_ids: list[UUID]
    skipped_absent_count: int
    updated_section: CrossSectionResponse
