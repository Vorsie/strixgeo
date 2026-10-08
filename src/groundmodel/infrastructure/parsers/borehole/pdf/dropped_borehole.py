"""DroppedBorehole: a borehole print of a report that is NOT offered for import."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DroppedBorehole:
    """A print the triage set aside, with the reason in words.

    Owner 2026-10-08: a borehole printed again with exactly the same data
    (rows identical over the overlap: depths, descriptions, samples) is
    dropped with a notice, like the CPT digitiser's dropped sheets. A repeat
    that differs is never dropped here.

    Parameters
    ----------
    key : str
        The dropped print's ``"<name>@p<first page>"``.
    name : str
        The borehole name.
    pages : tuple of int
        The pages of the dropped print.
    reason : str
        ``"duplicate"``.
    kept_key : str
        The key of the print that stays listed.
    note : str
        One sentence for the user.
    """

    key: str
    name: str
    pages: tuple[int, ...]
    reason: str
    kept_key: str
    note: str

    def to_dict(self) -> dict[str, Any]:
        """Return the dropped print as a JSON-ready dict."""
        return {
            "key": self.key,
            "name": self.name,
            "pages": list(self.pages),
            "reason": self.reason,
            "kept_key": self.kept_key,
            "note": self.note,
        }
