"""Single source of truth for the body extent_kind enum.

The body model carries an ``extent_<side>_kind`` per side; this module
holds the canonical string values + a helper for the provenance rule
(detector-set vs user-claimed) that gates the reconcile sweep.

See ``docs/superpowers/specs/2026-05-31-body-with-extent-design.md``
sections 4.3 + 5.2 for the semantics.
"""

from __future__ import annotations

from typing import Literal

# --- Enum values -------------------------------------------------------------

# Closure at a specific target contact (auto-detected bilateral closure).
EXTENT_KIND_TO_TARGET = "to_target"

# Terminates halfway to the named neighbour investigation. User-claimed.
EXTENT_KIND_PINCH_OUT_HALFWAY = "pinch_out_halfway"

# Dip-extrapolation closure (absorbs the retired ExtrapolatePinchOut tool).
# User-claimed.  Endpoint computed at render time, not stored.
EXTENT_KIND_EXTRAPOLATED = "extrapolated"

# Explicitly extends to / past the section boundary. User-claimed.
EXTENT_KIND_OPEN = "open"

#: Static type alias for the four extent kind values.  Downstream consumers
#: should annotate parameters / return types / ORM columns as ``ExtentKind``
#: (not bare ``str``) so type checkers narrow correctly and string-literal
#: misspellings surface at type-check time instead of runtime.
ExtentKind = Literal[
    "to_target",
    "pinch_out_halfway",
    "extrapolated",
    "open",
]

# All known values for validation. Drift guard: adding a value here without
# updating the test set + renderer dispatch + UI menu is a test failure.
EXTENT_KIND_VALUES: frozenset[str] = frozenset(
    {
        EXTENT_KIND_TO_TARGET,
        EXTENT_KIND_PINCH_OUT_HALFWAY,
        EXTENT_KIND_EXTRAPOLATED,
        EXTENT_KIND_OPEN,
    }
)

# --- Provenance helper -------------------------------------------------------

_USER_CLAIMED_KINDS: frozenset[str] = frozenset(
    {
        EXTENT_KIND_PINCH_OUT_HALFWAY,
        EXTENT_KIND_EXTRAPOLATED,
        EXTENT_KIND_OPEN,
    }
)


def is_user_claimed_extent_kind(kind: str | None) -> bool:
    """Return True iff ``kind`` represents a user-claimed extent.

    The detector NEVER overwrites a user-claimed extent (spec §5.2).
    Reconcile sweeps NEVER delete bodies with at least one user-claimed
    extent. NULL and ``to_target`` are NOT user-claimed.
    """
    return kind in _USER_CLAIMED_KINDS
