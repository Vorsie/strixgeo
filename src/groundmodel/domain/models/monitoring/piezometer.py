"""Piezometer monitoring instrument model."""
from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class Piezometer:
    """Piezometer — measures pore water pressure at a given installation depth."""
    name: str
    location_x: float
    location_y: float
    installation_depth_m: float
    id: UUID = field(default_factory=uuid7)
