"""Job lifecycle state enumeration."""

from enum import Enum


class JobStatus(Enum):
    """Lifecycle states for an asynchronous job."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"
