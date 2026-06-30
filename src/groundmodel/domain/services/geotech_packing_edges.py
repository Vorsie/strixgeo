"""Pure helper: align geotech sub-bands across two tests by LCS on NAD packing class.

Used by the geotech auto-correlation (``SubdivideAllBodies``): within one litho
body, two adjacent tests' packing sub-band stacks are connected by the
longest-common-subsequence (LCS) of their NAD-class sequences.  Bands with
no counterpart in the LCS stay unconnected (they pinch or onlap); the engineer
connects those manually.  See spec section 4.

A ``nad_class`` of ``None`` (skeleton band, no CPT qc) never matches any
other band — not even another ``None`` — so skeleton bands are excluded from
auto-connection per spec §8.
"""

from __future__ import annotations


def aligned_same_class_pairs(
    left: list[tuple[str, int | None]],
    right: list[tuple[str, int | None]],
) -> list[tuple[str, str]]:
    """Return aligned (left_layer_id, right_layer_id) pairs via LCS on NAD class.

    Computes the longest common subsequence (LCS) of the two NAD-class
    sequences, preserving order on both sides.  Each position in the LCS
    becomes a geotech edge candidate connecting the corresponding layer on
    each test.  A ``nad_class`` of ``None`` (skeleton / last-resort band)
    never matches any other band — including another ``None`` — so skeleton
    bands are excluded from auto-connection per spec §8.

    This replaces the earlier full-sequence-equality match
    (``aligned_same_sequence_pairs``), which required both stacks to be
    identical in length and class order — failing the real-data case where
    two columns in the same litho body have different packing-class counts
    but share at least one class (e.g. ``[6, 6, 7, 8]`` vs ``[6, 8, 5]``
    produces 2 LCS pairs instead of nothing).

    Parameters
    ----------
    left, right : list[tuple[str, int | None]]
        Each test's sub-band stack as ``(layer_id, nad_class)`` ordered
        top->base for ONE litho unit on that test.  Empty lists are allowed.

    Returns
    -------
    list[tuple[str, str]]
        Aligned ``(left_layer_id, right_layer_id)`` pairs in top->base order,
        one per position in the order-preserving LCS.  An empty list when the
        LCS is empty (no shared NAD classes, or either side is empty).
    """
    n, m = len(left), len(right)
    if not n or not m:
        return []

    # Standard O(n * m) DP for LCS length.
    # dp[i][j] = LCS length of left[:i] and right[:j].
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        _, l_class = left[i - 1]
        for j in range(1, m + 1):
            _, r_class = right[j - 1]
            # None never matches (skeleton bands excluded from auto-connection).
            if l_class is not None and r_class is not None and l_class == r_class:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    # Traceback: collect pairs in reverse (bottom-right → top-left),
    # then reverse at the end to restore top→base order.
    pairs: list[tuple[str, str]] = []
    i, j = n, m
    while i > 0 and j > 0:
        l_id, l_class = left[i - 1]
        r_id, r_class = right[j - 1]
        if (
            l_class is not None
            and r_class is not None
            and l_class == r_class
            and dp[i][j] == dp[i - 1][j - 1] + 1
        ):
            pairs.append((l_id, r_id))
            i -= 1
            j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            # Prefer consuming from the left side on ties (deterministic traceback).
            i -= 1
        else:
            j -= 1

    pairs.reverse()
    return pairs
