"""What a DOV bbox re-import does with one incoming interpretation (owner 2026-10-01)."""

from __future__ import annotations

from enum import StrEnum


class DovInterpretationVerdict(StrEnum):
    """The dedup verdict on one interpretation the DOV WFS returned.

    ``ATTACH``: a permkey the borehole never held - attach it (refresh-on-
    duplicate keeps filling in what DOV published since).
    ``ALREADY_PRESENT``: the borehole holds a track with that permkey - skip;
    the stored track (and any hand edit on it) is never overwritten.
    ``DELETED_BY_USER``: the user deleted that track - skip; it stays deleted.
    """

    ATTACH = "attach"
    ALREADY_PRESENT = "already_present"
    DELETED_BY_USER = "deleted_by_user"
