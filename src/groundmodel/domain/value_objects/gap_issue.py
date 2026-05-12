"""Result type for the geological-model no-gaps validator.

A ``GapIssue`` is a single problem flagged by
``GeologyValidator.validate_no_gaps`` (formerly in the geology
repository, moved out as part of debt #36 — domain value objects
don't belong in infrastructure files). The validator returns a
list of these; an empty list means the model's stratigraphy is
clean for the borehole.

This value object lives in the domain layer because:

* It carries domain semantics (formation contacts, depths) and
  business invariants (a contact below the borehole's total depth
  is a domain-level mistake, not an infrastructure concern).
* It is consumed by API schemas and any future domain-side
  consumer (cross-section editor, export pipeline) without
  forcing a dependency on infrastructure.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class GapIssue:
    """One problem found by the no-gaps validator.

    Attributes
    ----------
    kind : str
        One of ``"missing_surface_contact"``, ``"duplicate_depth"``,
        ``"contact_below_test"``, ``"no_contacts"``. New kinds may
        be added; callers should treat unknown kinds as warnings
        rather than crash.
    detail : str
        Free-text explanation suitable for the UI.
    depth_m : float | None
        Depth involved in the issue, when relevant.
    contact_ids : tuple[UUID, ...]
        Contact rows the issue points at (for the editor to
        highlight). Empty tuple when no specific contact is at
        fault (e.g. ``no_contacts``).
    """

    kind: str
    detail: str
    depth_m: float | None = None
    contact_ids: tuple[UUID, ...] = ()
