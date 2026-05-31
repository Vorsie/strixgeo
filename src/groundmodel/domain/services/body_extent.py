"""BodyExtent + DetectedBody dataclasses — the domain primitives.

Returned by ``detect_body_extents``. Consumed by ``DetectBodies`` to
populate the ``body`` table's extent columns + by the renderer to
draw wedges.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.shared.constants.extent_kind import ExtentKind


@dataclass(frozen=True)
class BodyExtent:
    """One side's extent marker for a detected or user-claimed body.

    Parameters
    ----------
    kind : ExtentKind
        The mechanism by which the body terminates on this side.
        ``'to_target'`` = auto-detected bilateral closure at a specific
        contact; ``'pinch_out_halfway'`` / ``'extrapolated'`` / ``'open'``
        are user-claimed.
    target_contact_id : UUID
        The contact the closure lands at.  Populated when
        ``kind == 'to_target'``; the caller is responsible for setting a
        meaningful id on user-claimed extents where the target is known.
    neighbour_investigation_id : UUID
        The investigation that ``target_contact_id`` lives on.  Also
        populated for ``'pinch_out_halfway'`` and ``'extrapolated'`` where
        a neighbour investigation is referenced directly.

    Notes
    -----
    Both fields are present on every ``BodyExtent`` that the detector
    returns.  The only absent case is when a side has no claim at all —
    the caller returns ``None`` from the detection function instead of
    constructing an extent with dummy ids.
    """

    kind: ExtentKind
    target_contact_id: UUID  # the contact closure lands at (for to_target)
    neighbour_investigation_id: UUID  # the investigation that contact lives on


@dataclass(frozen=True)
class DetectedBody:
    """A body the detector found, with per-side extents.

    The detector only produces bodies with bilateral closure (both
    ``extent_left`` and ``extent_right`` populated, both
    ``kind = 'to_target'``).  User-claimed bodies are created via the
    application layer, not the domain detector.

    Parameters
    ----------
    formation_id : UUID
        The geological formation this body belongs to.
    source_investigation_id : UUID
        The investigation the body was sourced from (the one that
        triggered the bilateral-closure check).
    contact_above_id : UUID
        The litho contact marking the top of the body on the source
        investigation.
    contact_below_id : UUID
        The litho contact marking the base of the body on the source
        investigation.
    extent_left : BodyExtent or None
        Closure on the left side (lower investigation index along the
        section).  ``None`` when the detector found no bilateral closure
        on this side.
    extent_right : BodyExtent or None
        Closure on the right side.  ``None`` when the detector found no
        bilateral closure on this side.
    """

    formation_id: UUID
    source_investigation_id: UUID
    contact_above_id: UUID
    contact_below_id: UUID
    extent_left: BodyExtent | None
    extent_right: BodyExtent | None
