"""Closed Literal aliases shared by the FormationContact schemas.

Type aliases, not classes — the one-class-per-file rule governs classes;
these stay grouped so a new contact source/confidence is a single edit.
"""

from __future__ import annotations

from typing import Literal

# Closed enum for the source column. Pydantic enforces these literally;
# the DB column stays plain VARCHAR so adding a new source is a
# Pydantic-only change.
ContactSource = Literal["borehole_observation", "manual_pick", "interpolated"]
ContactConfidence = Literal["high", "medium", "low"]
