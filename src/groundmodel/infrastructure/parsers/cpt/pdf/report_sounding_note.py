"""ReportSoundingNote: one note on a triaged sounding, as a code plus params."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ReportSoundingNote:
    """What the user should look at before importing, as a stable code.

    The desktop renders the sentence from its catalogues (translate at the
    presentation boundary); the English ``ReportSounding.warnings`` sentence at
    the same index is the fallback for a code the desktop does not know.

    Parameters
    ----------
    code : str
        One of the ``NOTE_*`` codes in ``report_sounding_note_constants``.
    params : dict
        Values the sentence names (``{"count": 22}`` for clipped points).
    """

    code: str
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return the note as a JSON-ready dict for the UI."""
        return {"code": self.code, "params": dict(self.params)}
