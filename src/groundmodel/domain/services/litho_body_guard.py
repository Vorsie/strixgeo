"""Pure helper: guard that two geotech contacts belong to the same litho body.

Used by ``CorrelateLithoContacts`` on the geotechnical model path to hard-block a
packing correlation whose two bands are in different lithostratigraphic bodies.
A NAD packing class is always a subdivision of ONE litho body; a packing edge
must never cross a body boundary (two separate sand bodies must not merge into
one packing body simply because they share the same soil code).

Pure module — no I/O, no logger, no session.  The caller is responsible for
building the ``litho_body_of`` lookup before invoking this helper.
"""

from __future__ import annotations


def same_litho_body(
    litho_body_of: dict[str, str | None],
    contact_a: str,
    contact_b: str,
) -> bool:
    """Return ``True`` iff both contacts map to the same NON-None litho body id.

    Conservative guard: an unmapped contact (key absent) or a contact whose
    litho body could not be resolved (value is ``None``) both return ``False``
    so that an unresolvable band always blocks the correlation rather than
    silently permitting a potentially cross-body edge.

    Parameters
    ----------
    litho_body_of : dict[str, str | None]
        Maps geotech contact id (string) → parent litho body id (string), or
        ``None`` when the body could not be resolved (e.g. the geotech band has
        no corresponding accepted litho layer or the litho layer's body_id is
        not yet stamped).
    contact_a : str
        ID of the first geotech contact.
    contact_b : str
        ID of the second geotech contact.

    Returns
    -------
    bool
        ``True`` when both contacts resolve to the same non-``None`` litho body
        id.  ``False`` for any unmapped, ``None``-mapped, or cross-body pair.
    """
    a = litho_body_of.get(contact_a)
    b = litho_body_of.get(contact_b)
    return a is not None and a == b
