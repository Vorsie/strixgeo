"""Pure helper: guard that two geotech contacts can be tied without crossing bodies.

Owner ruling (2026-08-04): a contact is a SURFACE — it touches the band above
it and the band below it, so it touches up to TWO lithostratigraphic bodies.
A packing correlation between two contacts is legitimate whenever the two
surfaces bound at least one SHARED litho body ("if one matches it matches"):
it is then a surface tie of that body's boundary, exactly like the litho
stage's own cross-lithology surface ties.  Body formation stays safe because
the resolver never unions cross-class bands — a half-matched tie renders as a
line and constrains geometry (the unmatched band tapers out to the tied
contact) without merging packing bodies.

What the guard still refuses: contact pairs whose adjacent-body sets are
DISJOINT — two separate sand bodies must never merge into one packing body via
this gesture — and any contact whose neighbourhood cannot be resolved at all.

Pure module — no I/O, no logger, no session.  The caller builds the
``adjacent_bodies_of`` lookup before invoking this helper.
"""

from __future__ import annotations


def shares_litho_body(
    adjacent_bodies_of: dict[str, set[str]],
    contact_a: str,
    contact_b: str,
) -> bool:
    """Return ``True`` iff the two contacts touch at least one common litho body.

    Conservative guard: an unmapped contact, or one whose adjacent-body set is
    empty (no band above or below resolved to an accepted, body-stamped litho
    layer), always blocks the correlation rather than silently permitting a
    potentially cross-body edge.

    Parameters
    ----------
    adjacent_bodies_of : dict[str, set[str]]
        Maps geotech contact id (string) → the set of litho body ids of the
        bands directly above and below that contact.  Unresolvable neighbours
        are simply absent from the set.
    contact_a : str
        ID of the first geotech contact.
    contact_b : str
        ID of the second geotech contact.

    Returns
    -------
    bool
        ``True`` when the two sets intersect; ``False`` for any unmapped
        contact, empty set, or disjoint pair.
    """
    a = adjacent_bodies_of.get(contact_a) or set()
    b = adjacent_bodies_of.get(contact_b) or set()
    return bool(a & b)
