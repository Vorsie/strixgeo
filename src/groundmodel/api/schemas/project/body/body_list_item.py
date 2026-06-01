"""Pydantic schema: :class:`BodyListItem` (response shape for ``GET /bodies``)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class BodyListItem(BaseModel):
    """One row returned by ``GET /projects/{pid}/geology/models/{mid}/lenses``.

    Carries the body-with-extent metadata introduced in the slice-1 schema
    pivot.  The ``source_investigation_id`` and ``extent_*`` columns replace
    the old ``content_key`` — the body is now anchored to its defining
    investigation and its lateral reach is tracked explicitly.

    Attributes
    ----------
    id : UUID
        ``BodyOrm`` primary key.
    app_project_id : UUID
        Project scope.
    model_id : UUID
        The lithostratigraphic model this body belongs to.
    formation_id : UUID
        The geological formation this body is a segment of.
    body_ordinal : int
        Zero-based ordinal assigned by the correlation resolver; distinguishes
        multiple separate bodies of the same formation within a model.
    source_investigation_id : UUID
        The investigation whose correlation defines this body.
    name : str | None
        Optional human-readable label; ``None`` when the user has not yet
        named this body.
    primary_section_id : UUID | None
        The cross-section from which the naming gesture was invoked.

    extent_left_kind : str | None
        Lateral extent kind on the left side
        (``'pinch_out_halfway'``, ``'extrapolated'``, ``'open'``, or ``None``
        when the side has not been claimed yet).
    extent_left_target_contact_id : UUID | None
        The formation contact that marks the left terminus (when applicable).
    extent_left_neighbour_inv_id : UUID | None
        The neighbouring investigation used to compute the halfway point or
        extrapolation anchor on the left.

    extent_right_kind : str | None
        Same as ``extent_left_kind`` but for the right lateral extent.
    extent_right_target_contact_id : UUID | None
        Same as ``extent_left_target_contact_id`` but for the right side.
    extent_right_neighbour_inv_id : UUID | None
        Same as ``extent_left_neighbour_inv_id`` but for the right side.

    created_at : datetime
        Row creation timestamp.
    updated_at : datetime
        Row last-modified timestamp.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    model_id: UUID
    formation_id: UUID
    body_ordinal: int
    source_investigation_id: UUID
    name: str | None
    primary_section_id: UUID | None

    extent_left_kind: str | None
    extent_left_target_contact_id: UUID | None
    extent_left_neighbour_inv_id: UUID | None

    extent_right_kind: str | None
    extent_right_target_contact_id: UUID | None
    extent_right_neighbour_inv_id: UUID | None

    created_at: datetime
    updated_at: datetime
