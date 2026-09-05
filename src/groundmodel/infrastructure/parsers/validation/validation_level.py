"""Severity levels for parser validation findings."""

from enum import StrEnum


class ValidationLevel(StrEnum):
    """Severity of a parse validation issue."""

    ERROR = "error"
    WARNING = "warning"
    INFO = "info"
