"""Stable lens identity — content key (#163f Slice 2 carry-forward).

A detected lens body's persistent identity is the SET of three contacts that
define it: the two source contacts that bound the body on the full-thickness
investigation, plus the single target contact it pinches to. The lens's
``body_ordinal`` is volatile (the resolver re-numbers it as correlations
change), so user-authored boundary shapes must NOT be keyed on it. They key on
this content hash instead, which is stable as long as the three contacts exist
— so a re-detection that only shifts ordinals recovers the same shape.

Pure: no I/O, no ORM.
"""

from __future__ import annotations

from uuid import UUID


def lens_content_key(
    contact_above_id: UUID,
    contact_below_id: UUID,
    target_contact_id: UUID,
) -> str:
    """Deterministic, order-independent key for a lens body's defining contacts.

    Parameters
    ----------
    contact_above_id, contact_below_id : UUID
        The two source contacts bounding the lens body on the full-thickness
        investigation (the lens top + base).
    target_contact_id : UUID
        The single contact the lens pinches to on the other investigation.

    Returns
    -------
    str
        A stable string (sorted contact ids joined by ``|``). Identical for
        the same set of contacts regardless of argument order.
    """
    return "|".join(
        sorted(str(cid) for cid in (contact_above_id, contact_below_id, target_contact_id))
    )
