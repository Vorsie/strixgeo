"""Abstract base class for laboratory tests performed on a borehole sample."""

from abc import ABC
from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class LabTest(ABC):
    """Abstract base for lab tests — GrainSize, Atterberg, Triaxial, etc."""

    sample_id: UUID
    id: UUID = field(default_factory=uuid7)
