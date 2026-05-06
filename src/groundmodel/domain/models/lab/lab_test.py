from abc import ABC
from dataclasses import dataclass, field
from uuid import UUID, uuid4


@dataclass
class LabTest(ABC):
    sample_id: UUID
    id: UUID = field(default_factory=uuid4)
