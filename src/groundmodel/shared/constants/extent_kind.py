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


# --- Side constants ----------------------------------------------------------

#: The two valid side values for body extent columns.  Used as the canonical
#: validation guard in ClaimBodyExtent and ClearBodyExtent so neither
#: use case defines its own local tuple (single source of truth).
EXTENT_SIDES: tuple[str, str] = ("left", "right")


# --- Provenance --------------------------------------------------------------

# Per-side provenance of a body extent (``body.extent_<side>_provenance``).
#
# ``auto``  — set + freely recomputed by ``DetectBodies`` every pass: the
#             ``to_target`` bilateral closures AND the auto-completed
#             ``pinch_out_halfway`` / ``open`` defaults that keep a body from
#             ever persisting with a null lateral side.
# ``user``  — an explicit ``ClaimBodyExtent``.  The auto pass NEVER overwrites
#             or clears a ``user`` side.
#
# Distinct from the KIND: an auto-pinch and a user-pinch share a kind but must
# be treated differently, so kind alone cannot gate the auto pass (the reason
# the kind-based ``is_user_claimed_extent_kind`` heuristic could not own +
# recompute the pinch/open defaults — they went stale).
EXTENT_PROVENANCE_AUTO = "auto"
EXTENT_PROVENANCE_USER = "user"

#: All valid provenance values (validation / drift guard).
EXTENT_PROVENANCE_VALUES: frozenset[str] = frozenset(
    {EXTENT_PROVENANCE_AUTO, EXTENT_PROVENANCE_USER}
)


def is_user_claimed_extent_kind(kind: str | None) -> bool:
    """Return True iff ``kind`` represents a user-claimed extent.

    The detector NEVER overwrites a user-claimed extent (spec §5.2).
    Reconcile sweeps NEVER delete bodies with at least one user-claimed
    extent. NULL and ``to_target`` are NOT user-claimed.

    .. deprecated::
        Provenance now lives in the explicit ``extent_<side>_provenance``
        column (``auto`` / ``user``), not the kind.  New gates should check
        ``provenance == EXTENT_PROVENANCE_USER`` so an *auto-defaulted* pinch /
        open (which the auto pass owns + recomputes) is not mistaken for a
        user claim.  Retained for the bundle-restore / legacy paths that have
        not yet been migrated to the column.
    """
    return kind in _USER_CLAIMED_KINDS
