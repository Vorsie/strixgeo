"""Outcome of one raw lab import."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID


@dataclass
class LabSeriesImportResult:
    """What one ``ImportLabSeriesFile.execute`` did.

    Parameters
    ----------
    test_id : UUID
        The stored test (kept on refresh and on a no-op).
    sample_id : UUID
        The sample it hangs on.
    kind : str
        ``"oedometer"`` or ``"triaxial"``.
    created_sample : bool
        True when the import created the sample (no existing one matched).
    refreshed : bool
        True when a stored test with the same identity was replaced (consented).
    unchanged : bool
        True when the same file was already stored: nothing was written.
    issues : list[dict[str, Any]]
        The parser findings of this file.
    has_errors : bool
        True when any finding is an ERROR.
    """

    test_id: UUID
    sample_id: UUID
    kind: str
    created_sample: bool = False
    refreshed: bool = False
    unchanged: bool = False
    issues: list[dict[str, Any]] = field(default_factory=list)
    has_errors: bool = False
