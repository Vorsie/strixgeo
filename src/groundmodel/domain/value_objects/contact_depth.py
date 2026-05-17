"""Value object: :class:`ContactDepth`."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ContactDepth:
    """Minimal projection of a formation contact for the validator.

    Carries only the fields the no-gaps check needs — id (so issues
    can point back at the offending row) and depth_top_m. Keeping
    the shape narrow means the validator has no opinion on how
    contacts are stored or rehydrated.
    """

    id: UUID
    depth_top_m: float
