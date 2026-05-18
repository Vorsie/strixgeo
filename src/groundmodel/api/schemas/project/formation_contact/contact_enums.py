"""Closed Literal aliases shared by the FormationContact schemas.

Type aliases, not classes — the one-class-per-file rule governs classes;
these stay grouped so a new contact source/confidence is a single edit.
"""

from __future__ import annotations

from typing import Literal

# Closed enum for the source column. Pydantic enforces these literally;
# the DB column stays plain VARCHAR so adding a new source is a
# Pydantic-only change.
ContactSource = Literal[
    "borehole_observation",
    "manual_pick",
    "interpolated",
    # Contact copied from the parent geological model by the litho-Seed
    # use case (SeedLithoFromGeologicalModel). Must round-trip through
    # FormationContactCreate/UpdateRequest.source without a 422.
    "geological_model_seed",
    # Synthetic contact committed by the pinch-out extrapolation tool. Has
    # no borehole or CPT anchor — carries synthetic_x/y/elevation_m directly.
    # In the dedup survivor priority it is slotted after the real-data trio
    # (manual_pick/interpolated/borehole_observation) so it never evicts a
    # real pick; its true dedup safety is the use case's 409 idempotency.
    # See DeduplicateFormationContacts._survivor_priority.
    "pinch_out_extrapolation",
]
ContactConfidence = Literal["high", "medium", "low"]
