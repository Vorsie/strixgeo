"""DroppedSheet: a CPT sheet of a report that is NOT offered for import."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DroppedSheet:
    """A sheet the triage set aside, with the reason in words.

    Owner 2026-09-30: desk-study reprints are thrown away (the user looks them
    up in DOV / the other project himself), a sheet printed twice is dropped
    with a notice, and a sheet the digitiser could not read is named so the
    user knows it is missing.

    Parameters
    ----------
    sounding_id : str
        The printed id (or ``"page N"`` when none was read).
    page_numbers : tuple of int
        The pages concerned.
    reason : str
        ``"desk-study"``, ``"duplicate"`` or ``"unread"``.
    note : str
        One sentence for the user.
    """

    sounding_id: str
    page_numbers: tuple[int, ...]
    reason: str
    note: str

    def to_dict(self) -> dict[str, Any]:
        """Return the sheet as a JSON-ready dict for the UI."""
        return {
            "sounding_id": self.sounding_id,
            "page_numbers": list(self.page_numbers),
            "reason": self.reason,
            "note": self.note,
        }
