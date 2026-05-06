from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class Piezometer:
    name: str
    location_x: float
    location_y: float
    installation_depth_m: float
    id: UUID = field(default_factory=uuid7)
