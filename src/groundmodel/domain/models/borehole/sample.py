from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class Sample:
    borehole_id: UUID
    depth_top_m: float
    depth_base_m: float
    description: str = ""
    id: UUID = field(default_factory=uuid7)
