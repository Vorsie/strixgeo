"""Pydantic schema for a single parse validation finding."""

from pydantic import BaseModel


class ValidationIssueSchema(BaseModel):
    """Serialisable representation of a ValidationIssue from the GEF parser."""

    level: str  # "error" | "warning" | "info"
    code: str
    message: str
    rows: list[int]
