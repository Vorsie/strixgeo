"""Pydantic schema: :class:`ClaimBodyExtentRequest`."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class ClaimBodyExtentRequest(BaseModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/bodies``.

    Sets one lateral extent on an EXISTING body in a single call. The body
    is identified directly by ``body_id`` — the single source of truth the
    candidate suggester and the body-acting UI already hold. The resolver
    (``ResolveLithoInstances``) owns body creation; this endpoint never
    creates a body row.

    Use ``PATCH`` on the same body to add the other side's extent or update
    the name.

    Parameters
    ----------
    body_id : UUID
        The body whose lateral extent is being claimed. Must already exist
        in the model (the resolver stamps one body per accepted instance).
    side : {'left', 'right'}
        Which lateral extent is being claimed.
    kind : {'pinch_out_halfway', 'extrapolated', 'open'}
        Nature of the lateral extent on the claimed side.
        * ``'pinch_out_halfway'`` — the body terminates at the midpoint
          between the body's source investigation and ``neighbour_inv_id``.
        * ``'extrapolated'`` — the body extends past the last known contact
          toward ``neighbour_inv_id`` using the dip extrapolation rule.
        * ``'open'`` — no explicit lateral terminus; the body is drawn to
          the section edge.
    source_investigation_id : UUID | None
        Optional. Retained only for logging / back-filling a body's source
        if it is ever NULL. Not required — the body already carries its
        own ``source_investigation_id``.
    neighbour_inv_id : UUID | None
        Required for ``'pinch_out_halfway'`` and ``'extrapolated'``.
        Ignored for ``'open'``.
    primary_section_id : UUID | None
        The cross-section from which the gesture was invoked.  Stored so
        the perpendicular-companion use case can locate the section.
    """

    body_id: UUID
    side: Literal["left", "right"]
    kind: Literal["pinch_out_halfway", "extrapolated", "open"]
    source_investigation_id: UUID | None = None
    neighbour_inv_id: UUID | None = None
    primary_section_id: UUID | None = None
