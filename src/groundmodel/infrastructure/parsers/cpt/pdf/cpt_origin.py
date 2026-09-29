"""CptOrigin enum."""

from __future__ import annotations

from enum import StrEnum


class CptOrigin(StrEnum):
    """Whether a CPT graph page belongs to the report's own campaign.

    Owner 2026-09-28: reports reprint desk-study soundings (older DOV sheets,
    other projects) next to the campaign's own tests; only the campaign's own
    soundings are new data.

    Members
    -------
    CAMPAIGN
        A sounding of the campaign the report is about.
    DESK_STUDY
        A reprinted sounding from the desk study (DOV, another project).
    UNKNOWN
        Not decidable from the page (no sounding block, no DOV mark).
    """

    CAMPAIGN = "campaign"
    DESK_STUDY = "desk-study"
    UNKNOWN = "unknown"
