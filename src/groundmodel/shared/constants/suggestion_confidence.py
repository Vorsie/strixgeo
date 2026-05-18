"""Confidence enum for a suggested lithostratigraphic layer boundary.

Relocated out of ``domain.services.litho_segmentation`` (a logic module)
into ``shared/`` so the API schema layer can reference it without
importing from the domain layer (debt #54 — layer purity). The enum is
data, not logic; the segmenter service imports it back from here.
"""

from __future__ import annotations

from enum import StrEnum


class SuggestionConfidence(StrEnum):
    """Confidence in a suggested lithostratigraphic layer boundary.

    HIGH   — major, persistent SBT zone; at least 2 × minimum_layer_thickness_m
             of contiguous signal.
    MEDIUM — passes the minimum_layer_thickness_m threshold but the zone is thin.
    LOW    — result of a greedy-merge (the run was originally too thin and was
             absorbed into a neighbour).
    """

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
