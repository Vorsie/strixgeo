"""Constants for the litho-column digest that geotech band-sets are stamped with.

See :mod:`groundmodel.domain.services.litho_column_digest` for the semantics.
"""

from __future__ import annotations

from typing import Final

# Prefix on every digest so a future change to WHAT is digested is visible
# rather than silently comparable against the old shape.  Bumping this makes
# every stored stamp mismatch, which would read as "the whole model is stale" —
# so a bump MUST be accompanied by a migration that clears
# ``geological_model.derived_from_litho_digests``.  Unknown provenance is quiet
# (see ``stale_column_ids``); a false model-wide alarm is not.
LITHO_DIGEST_VERSION: Final[str] = "v1"

# Depths are compared at millimetre resolution.  Two reasons, both load-bearing:
#
# 1. ``litho_layer.depth_base_m`` is DERIVED — the FC→LL contiguity trigger
#    rebuilds it as ``LEAD(depth_top_m)`` — so a base can come back re-rounded
#    through float without anyone having moved anything.  Sub-millimetre slack
#    must not read as an edit.
# 2. A millimetre is already finer than the project's own litho boundary clamp
#    (backend 0.001 m), and debt #266's provenance test separates a hand edit
#    from segmenter output by 1.6-4.2 mm — so mm resolution still sees the very
#    edit that motivated this signal.
LITHO_DIGEST_DEPTH_DECIMALS: Final[int] = 3

# 128 bits of blake2b.  The digest is an equality tag over at most a few hundred
# short strings per project, never a security boundary; 16 bytes keeps the JSONB
# map small enough to ride the .strix bundle without a second thought.
LITHO_DIGEST_SIZE_BYTES: Final[int] = 16

# Field and record separators for the canonical form.  Chosen because neither
# can occur inside a formatted depth or a UUID, so the canonical string can
# never be ambiguous between two different stacks.
LITHO_DIGEST_FIELD_SEPARATOR: Final[str] = "|"
LITHO_DIGEST_RECORD_SEPARATOR: Final[str] = "\n"
