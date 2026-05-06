from abc import ABC
from dataclasses import dataclass, field
from uuid import UUID, uuid4


@dataclass
class BoreholeTest(ABC):
    borehole_id: UUID
    depth_m: float
    id: UUID = field(default_factory=uuid4)
