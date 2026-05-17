"""Value object: :class:`ContactPoint3D`."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ContactPoint3D:
    """One source point for the TIN — a contact's (x, y, elevation_m).

    The TIN compute treats contact_id as opaque metadata so the
    cache-validity checksum can include it (and detect a "swap one
    contact for another at the same xyz" change, which would have
    the same triangulation but different downstream interpretation).
    """

    contact_id: str
    x_m: float
    y_m: float
    elevation_m: float
