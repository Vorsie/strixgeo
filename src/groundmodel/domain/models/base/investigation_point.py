from dataclasses import dataclass, field
from uuid import UUID, uuid4


@dataclass
class InvestigationPoint:
    name: str
    location_x: float
    location_y: float
    elevation_m: float | None = None
    id: UUID = field(default_factory=uuid4)
