"""Asynchronous job domain model."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from uuid6 import uuid7

from groundmodel.domain.models.job_status import JobStatus


@dataclass
class Job:
    """Asynchronous job — tracks payload, status, and execution logs."""

    type: str
    payload: dict[str, Any]
    id: UUID = field(default_factory=uuid7)
    status: JobStatus = JobStatus.PENDING
    result: dict[str, Any] | None = None
    logs: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None
