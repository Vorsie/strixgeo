"""Constants for the lens-inference engine (#101 R2).

All thresholds and token values live here so the engine module stays
free of magic literals.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Depth-range overlap
# ---------------------------------------------------------------------------

# A layer is considered to overlap the body's depth range when the
# overlap ratio (intersection / body_range_length) meets this minimum.
# Set to zero: any overlap — even a single point — counts.
# This is deliberately permissive: a thin clay drape that just nicks the
# body's depth band is still "different lithology present there".
# Raise only if false-positives become a practical problem in dogfeed.
MIN_OVERLAP_RATIO: float = 0.0

# ---------------------------------------------------------------------------
# Source tokens (mirrors CHECK constraint in migration h2b3c4d5e6f7)
# ---------------------------------------------------------------------------

SOURCE_INFERRED: str = "inferred"
SOURCE_MANUAL: str = "manual"
SOURCE_OBSERVED: str = "observed"

# The set of sources the engine may rewrite (i.e. its own prior output).
# Sources NOT in this set are user intent and must be preserved.
ENGINE_OWNED_SOURCES: frozenset[str] = frozenset({SOURCE_INFERRED})

# ---------------------------------------------------------------------------
# Investigation kind tokens
# ---------------------------------------------------------------------------

KIND_BOREHOLE: str = "borehole"
KIND_CPT: str = "cpt"
