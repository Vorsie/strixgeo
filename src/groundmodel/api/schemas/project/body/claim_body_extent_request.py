"""Pydantic schema: :class:`ClaimBodyExtentRequest`."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class ClaimBodyExtentRequest(BaseModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/bodies``.

    Creates a body row and sets one lateral extent in a single call.
    Use ``PATCH`` on an existing body to add the other side's extent or
    update the name.

    Parameters
    ----------
    formation_id : UUID
        The geological formation this body is a segment of.
    source_investigation_id : UUID
        The investigation whose correlation defines this body.
    side : {'left', 'right'}
        Which lateral extent is being claimed.
    kind : {'pinch_out_halfway', 'extrapolated', 'open'}
        Nature of the lateral extent on the claimed side.
        * ``'pinch_out_halfway'`` — the body terminates at the midpoint
          between ``source_investigation_id`` and ``neighbour_inv_id``.
        * ``'extrapolated'`` — the body extends past the last known contact
          toward ``neighbour_inv_id`` using the dip extrapolation rule.
        * ``'open'`` — no explicit lateral terminus; the body is drawn to
          the section edge.
    neighbour_inv_id : UUID | None
        Required for ``'pinch_out_halfway'`` and ``'extrapolated'``.
        Ignored for ``'open'``.
    primary_section_id : UUID | None
        The cross-section from which the gesture was invoked.  Stored so
        the perpendicular-companion use case can locate the section.
    """

    formation_id: UUID
    source_investigation_id: UUID
    side: Literal["left", "right"]
    kind: Literal["pinch_out_halfway", "extrapolated", "open"]
    neighbour_inv_id: UUID | None = None
    primary_section_id: UUID | None = None
