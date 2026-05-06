from dataclasses import dataclass, field
from uuid import UUID, uuid4


@dataclass
class Piezometer:
    name: str
    location_x: float
    location_y: float
    installation_depth_m: float
    id: UUID = field(default_factory=uuid4)
