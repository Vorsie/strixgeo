from dataclasses import dataclass, field
from uuid import UUID, uuid4


@dataclass
class Inclinometer:
    name: str
    location_x: float
    location_y: float
    depth_m: float
    id: UUID = field(default_factory=uuid4)
