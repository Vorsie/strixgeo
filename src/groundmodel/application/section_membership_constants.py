"""Constants of the section-membership rule (see ``section_membership.py``)."""

from __future__ import annotations

# The cross-section fields whose change can move a test on or off the section
# — and so into or out of every model of the project (owner ruling
# 2026-09-23: only tests a section draws feed a model). A PATCH touching any
# of these stales the project's built surfaces; a rename, a vertical
# exaggeration, a depth clamp, a display order or a view-state change does not,
# because none of them changes which tests project onto the line.
#
# ``epsg`` is in the set because the corridor test runs in the section's CRS:
# re-declaring it re-projects every test against the line.
SECTION_MEMBERSHIP_FIELDS: frozenset[str] = frozenset(
    {
        "start_x",
        "start_y",
        "end_x",
        "end_y",
        "epsg",
        "projection_buffer_m",
        "excluded_borehole_ids",
        "excluded_cpt_ids",
    }
)
