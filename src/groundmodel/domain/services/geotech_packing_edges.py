"""Pure helper: pair geotech sub-bands across two tests by shared NAD packing class.

Used by the geotech auto-correlation (``SubdivideAllBodies``): within ONE
correlated litho unit, each packing band on the left test connects to EVERY band
on the right test that shares its (non-null) NAD class -- regardless of count or
order. The resolver's connected-components then unions a recurring class within
the unit into ONE body (owner decision; the engineer splits manually). A
``None`` class (skeleton / last-resort band) never auto-connects. See spec §5
(2026-06-26).
"""

from __future__ import annotations


def same_class_pairs(
    left: list[tuple[str, int | None]],
    right: list[tuple[str, int | None]],
) -> list[tuple[str, str]]:
    """Return (left_layer_id, right_layer_id) pairs for every same-NAD-class band.

    Spec §5 (2026-06-26): within ONE correlated litho unit, connect each packing
    band on the left test to EVERY band on the right test that shares its
    (non-null) NAD class -- regardless of count or order. The resolver's
    connected-components then unions a recurring class within the unit into ONE
    body (owner decision; the engineer splits manually). A ``None`` class
    (skeleton band) never auto-connects.

    Parameters
    ----------
    left, right : list[tuple[str, int | None]]
        Each test's packing sub-band stack as ``(layer_id, nad_class)`` for ONE
        litho unit on that test (order irrelevant).

    Returns
    -------
    list[tuple[str, str]]
        One pair per same-class (left, right) combination; ``[]`` when either
        side is empty.
    """
    out: list[tuple[str, str]] = []
    for la, ca in left:
        if ca is None:
            continue
        for rb, cb in right:
            if cb == ca:
                out.append((la, rb))
    return out
