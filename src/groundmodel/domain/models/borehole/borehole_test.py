"""Abstract base class for tests performed inside a borehole."""
from abc import ABC
from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class BoreholeTest(ABC):
    """Abstract base for borehole tests — SPT, PMT, VST."""
    borehole_id: UUID
    depth_m: float
    id: UUID = field(default_factory=uuid7)
