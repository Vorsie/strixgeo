"""Shared snapshot types for body-extent domain logic.

``ContactStackEntry``, ``ContactStack``, and ``ContactEdge`` are reused by
``detect_crossing_pinch_outs`` and ``auto_correlate_contact_edges``.  The
``detect_body_extents`` function and the ``BodyExtent``/``DetectedBody``
primitives were retired in the body-extent refactor (Task 5, 2026-06-06).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ContactStackEntry:
    """One contact within an investigation's depth-sorted stack.

    Parameters
    ----------
    contact_id : UUID
        The unique id of this contact row.
    formation_id : UUID
        The formation whose top is marked by this contact (Strix convention:
        ``FormationContact.formation_id`` is the formation that starts here
        and extends downward to the next contact).
    depth_top_m : float
        Depth of this contact in metres, positive-down.
    """

    contact_id: UUID
    formation_id: UUID
    depth_top_m: float


@dataclass(frozen=True)
class ContactStack:
    """All contacts on one investigation, sorted by depth_top_m ascending.

    Parameters
    ----------
    investigation_id : UUID
        The investigation this stack belongs to.
    entries : tuple[ContactStackEntry, ...]
        Depth-sorted contact entries for this investigation.
    """

    investigation_id: UUID
    entries: tuple[ContactStackEntry, ...]


@dataclass(frozen=True)
class ContactEdge:
    """User-approved contact-correlation edge.

    Parameters
    ----------
    contact_a_id : UUID
        First endpoint of the edge.
    contact_b_id : UUID
        Second endpoint of the edge.
    """

    contact_a_id: UUID
    contact_b_id: UUID
