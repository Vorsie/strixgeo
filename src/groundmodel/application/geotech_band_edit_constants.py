"""Constants shared by the packing-band edit verbs and the readers of their marks."""

from __future__ import annotations

# The ``litho_layer.source`` token every HAND edit of a packing band stamps.
# Written by set-class, split, merge, move-boundary and move-restated-contact;
# READ by DivideBoreholes to decide which boreholes first-subdivision-wins
# still protects (owner ruling 2026-08-23: *"you only decide how the boreholes
# get divided after user review"* — the skip guards the engineer's work, not
# the machine's first guess).
#
# A constant rather than a literal repeated at each site, because a writer and
# that reader drifting apart fails SILENTLY and destructively: the divide would
# simply stop recognising a hand-edited borehole and re-plan over it, throwing
# away exactly the work the skip exists to keep.
#
# One of the four tokens the layer table's CHECK constraint accepts — see
# ``LithoLayerSourceLiteral`` for the full set.
MANUAL_BAND_SOURCE = "manual"
