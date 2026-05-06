from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from uuid import UUID

from uuid6 import uuid7


class JobStatus(Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


@dataclass
class Job:
    type: str
    payload: dict
    id: UUID = field(default_factory=uuid7)
    status: JobStatus = JobStatus.PENDING
    result: dict | None = None
    logs: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None
