"""Pure helper: pair geotech sub-bands across two tests by identical packing sequence.

Used by the geotech auto-correlation (``SubdivideAllBodies``): within one litho
body, two adjacent tests' packing sub-band stacks are connected 1:1 ONLY when
their NAD-class sequences are identical (same count, same order). Any mismatch
yields no pairs -- the engineer connects those manually. See spec section 4.
"""

from __future__ import annotations


def aligned_same_sequence_pairs(
    left: list[tuple[str, int | None]],
    right: list[tuple[str, int | None]],
) -> list[tuple[str, str]]:
    """Return aligned (left_layer_id, right_layer_id) pairs iff the sequences match.

    Parameters
    ----------
    left, right : list[tuple[str, int | None]]
        Each test's sub-band stack as ``(layer_id, nad_class)`` ordered top->base,
        for ONE litho unit on that test.  A ``nad_class`` of ``None`` (skeleton /
        last-resort band) is allowed and compares equal to another ``None`` here;
        the spec section 8 null-skip lives in the caller, not in this helper.

    Returns
    -------
    list[tuple[str, str]]
        One pair per band when the two NAD-class sequences are identical;
        ``[]`` on any length or class mismatch (and when either side is empty).
        ``None`` classes participate in the equality check; dropping aligned
        null-class pairs is the caller's responsibility.
    """
    if not left or not right or len(left) != len(right):
        return []
    if [c for _id, c in left] != [c for _id, c in right]:
        return []
    return [(la, rb) for (la, _lc), (rb, _rc) in zip(left, right)]
