"""Value object: :class:`FormationSurfaceInput`."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from uuid import UUID

from groundmodel.domain.value_objects.tin_surface import TinSurface


@dataclass(frozen=True)
class FormationSurfaceInput:
    """Minimal projection of a formation's TIN for the crossing check.

    Carries the formation's id (so issues can name the offenders),
    its display name (so the issue ``detail`` is readable), its
    stratigraphic order (lower = older — drives the "younger should
    sit above" rule), and the cached TIN. The validator never
    recomputes the TIN; it consumes whatever the cache holds.

    The optional ``contact_lookup`` maps each TIN vertex back to the
    formation_contact row that produced it, so a detected crossing
    can surface "which picks are wrong" rather than just "these two
    formations intersect". Key = ``(round(x_m, 2), round(y_m, 2))``
    (cm precision — enough to disambiguate any realistic survey
    grid; matches the same rounding used to build the map upstream
    in the application layer). When empty, crossings still get
    detected but ``GapIssue.contact_ids`` stays empty (graceful
    degradation — the banner remains non-clickable).
    """

    formation_id: UUID
    name: str
    display_order: int
    surface: TinSurface
    contact_lookup: Mapping[tuple[float, float], UUID] = field(default_factory=dict)
