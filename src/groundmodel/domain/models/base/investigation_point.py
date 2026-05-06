"""Named investigation point with XY location coordinates."""
from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class InvestigationPoint:
    """Named point in the project coordinate system."""
    name: str
    location_x: float
    location_y: float
    elevation_m: float | None = None
    id: UUID = field(default_factory=uuid7)
