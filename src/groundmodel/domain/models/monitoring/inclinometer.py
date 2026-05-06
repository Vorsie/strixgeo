from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class Inclinometer:
    name: str
    location_x: float
    location_y: float
    depth_m: float
    id: UUID = field(default_factory=uuid7)
