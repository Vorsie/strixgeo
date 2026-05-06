from abc import ABC
from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7


@dataclass
class LabTest(ABC):
    sample_id: UUID
    id: UUID = field(default_factory=uuid7)
