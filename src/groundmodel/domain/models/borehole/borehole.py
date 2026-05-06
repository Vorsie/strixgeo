"""Borehole domain model."""
from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class Borehole:
    """Physical borehole — location anchor for borehole tests and samples."""
    name: str
    location_x: float
    location_y: float
    elevation_m: float | None = None
    total_depth_m: float | None = None
    id: UUID = field(default_factory=uuid7)
