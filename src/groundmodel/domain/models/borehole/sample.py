"""Borehole sample domain model."""
from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class Sample:
    """Physical sample taken from a borehole at a depth interval."""
    borehole_id: UUID
    depth_top_m: float
    depth_base_m: float
    description: str = ""
    id: UUID = field(default_factory=uuid7)
