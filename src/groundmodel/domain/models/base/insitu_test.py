"""Abstract base class for all in-situ geotechnical tests."""
from abc import ABC
from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class InSituTest(ABC):
    """Abstract base for in-situ tests — CPT, DMT, SPT, PMT, VST."""
    location_x: float
    location_y: float
    elevation_m: float | None = None
    id: UUID = field(default_factory=uuid7)
