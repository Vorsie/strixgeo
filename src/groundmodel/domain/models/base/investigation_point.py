from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class InvestigationPoint:
    name: str
    location_x: float
    location_y: float
    elevation_m: float | None = None
    id: UUID = field(default_factory=uuid7)
