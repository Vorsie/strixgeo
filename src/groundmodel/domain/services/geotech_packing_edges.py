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

    # O(n * m) DP on SUFFIXES: dp[i][j] = LCS length of left[i:] and right[j:].
    # A suffix table lets the reconstruction walk FORWARD from the top, taking
    # every match as EARLY (shallow) as possible. That tie-break is load-
    # bearing (owner refinement 2026-08-06): when equally-long alignments
    # exist, the pairing of the two TOPMOST sub-bands is the litho tie
    # restated — the connection the engineer already approved — so the
    # aligner must keep the tops together rather than tie a surface band to a
    # deep band. (The previous prefix-table bottom-up traceback did the
    # opposite: [loose, dense] vs [loose, loose] paired the left top with the
    # right BOTTOM.)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        _, l_class = left[i]
        for j in range(m - 1, -1, -1):
            _, r_class = right[j]
            # None never matches (skeleton bands excluded from auto-connection).
            if l_class is not None and r_class is not None and l_class == r_class:
                dp[i][j] = dp[i + 1][j + 1] + 1
            else:
                dp[i][j] = max(dp[i + 1][j], dp[i][j + 1])

    # Forward reconstruction, top→base: take a match whenever it belongs to
    # an optimal alignment; otherwise advance the side whose suffix keeps the
    # longer LCS (left first on ties, deterministic).
    pairs: list[tuple[str, str]] = []
    i, j = 0, 0
    while i < n and j < m:
        l_id, l_class = left[i]
        r_id, r_class = right[j]
        if (
            l_class is not None
            and r_class is not None
            and l_class == r_class
            and dp[i][j] == dp[i + 1][j + 1] + 1
        ):
            pairs.append((l_id, r_id))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1

    return pairs


def aligned_pairs_with_forced_top(
    left: list[tuple[str, int | None]],
    right: list[tuple[str, int | None]],
) -> list[tuple[str, str]]:
    """Force the topmost pair regardless of class, then LCS the suffixes.

    The topmost sub-band of each stack owns the very contact surface the litho
    tie joins, so for a DIRECT litho pair the restatement pair exists even
    when the two top classes differ (owner ruling 2026-08-13: "you have to
    start from the exact litho geometries" — the class-equality requirement of
    :func:`aligned_same_class_pairs` silently dropped the restatement whenever
    the stacks led with different classes, and instead tied the litho contact
    to a class-matched band one or more steps DEEPER, letting the fill redraw
    the litho boundary).  The class-matched LCS then aligns only the bands
    BELOW the forced pair, which also removes the geometrically absurd
    deep↔shallow leftovers the whole-stack LCS produced in that situation.

    A ``None``-class (skeleton) top on either side blocks the forced pair —
    the pinned "skeleton-None top blocks restatement" rule — and the whole
    alignment falls back to the plain LCS, which never pairs ``None``.

    Parameters
    ----------
    left, right : list[tuple[str, int | None]]
        Each test's sub-band stack as ``(layer_id, nad_class)`` ordered
        top->base for ONE litho unit on that test.  Empty lists are allowed.

    Returns
    -------
    list[tuple[str, str]]
        The forced topmost pair followed by the suffix LCS pairs, in
        top->base order — or the plain LCS alignment when either top is a
        skeleton band.  Empty when either side is empty.
    """
    if not left or not right:
        return []
    (l_id, l_class), (r_id, r_class) = left[0], right[0]
    if l_class is None or r_class is None:
        return aligned_same_class_pairs(left, right)
    return [(l_id, r_id), *aligned_same_class_pairs(left[1:], right[1:])]


# Minimum share of the LARGER band's fraction extent that the overlap must
# cover before an interior pair is proposed. Gates out the sliver-to-deep-band
# ghosts (a whole-unit sliver against a thin band at the base of a big unit
# overlaps almost nothing of the big unit) while keeping genuine body pairs,
# whose overlap dominates both extents. Tunable; 0.25 chosen so a body must
# overlap at least a quarter of its partner's extent.
INTERIOR_MIN_OVERLAP_SHARE = 0.25


def shadowed_below_lens(
    stack: list[tuple[str, int | None, float, float]],
) -> set[str]:
    """Bands that repeat a class from above across an intervening lens.

    Owner rule (dogfeed 2026-08-17, verbatim): *"don't emit auto correlations
    ties below a lens if above the lens and below the lens have the same
    packing density and litho?"*  His scene: S12's silt unit reads
    ``[SILT 13, denser SILT 15, SILT 13]`` beside S13's single ``SILT 13`` —
    the top pair is already tied by the restatement, the merge step unifies
    the silt around the lens, and the machine's extra proposal onto the
    below-lens repeat is noise he has to delete (it also fans from a contact
    that is already tied).

    Within one litho unit the litho is constant, so "same litho" is given and
    the judgment is class-shape alone: a band is shadowed when some band above
    it in the same window carries the SAME class with at least one
    known-DIFFERENT class strictly between them.  A ``None`` (skeleton) class
    is no evidence either way — it neither shadows nor counts as a lens.

    Parameters
    ----------
    stack : list[tuple[str, int | None, float, float]]
        One test's sub-band stack as ``(layer_id, nad_class, fraction_top,
        fraction_base)`` ordered top→base (the ``_stack_with_fractions``
        shape; the fractions are unused here but keep the two consumers on
        one input).

    Returns
    -------
    set[str]
        Layer ids the machine must not PROPOSE ties onto.  Restatements are
        unaffected — they carry the engineer's own litho ties and resolve to
        contacts, never to interior repeats.
    """
    shadowed: set[str] = set()
    for i, (layer_id, cls, _t, _b) in enumerate(stack):
        if cls is None:
            continue
        for j in range(i):
            above_cls = stack[j][1]
            if above_cls != cls or above_cls is None:
                continue
            between = [stack[k][1] for k in range(j + 1, i)]
            if any(mid is not None and mid != cls for mid in between):
                shadowed.add(layer_id)
                break
    return shadowed


def overlap_gated_interior_pairs(
    left: list[tuple[str, int | None, float, float]],
    right: list[tuple[str, int | None, float, float]],
) -> list[tuple[str, str]]:
    """Propose interior same-class pairs by fraction overlap, monotone.

    Owner ruling 2026-08-14 ("auto correlate is fine, its just a tool to make
    the users life easier"): inside a litho-banded pair, the restatement
    carries only the units' OUTER contacts, so the big same-class interior
    bodies the monotone forced-top alignment consumed or skipped never got a
    proposal — the engineer had to find and hand-tie them (CS1 gap 3: the
    287 m² silt hole). This pass proposes them as PENDING ghosts: same NAD
    class, and their litho-window fraction extents overlap by at least
    ``INTERIOR_MIN_OVERLAP_SHARE`` of the LARGER extent — position-blind
    class matching is the bug the refinement's weighted LCS already named,
    and the share gate keeps the sliver↔deep-band ghosts dead.

    Pairs are kept monotone (no crossing ghost ribbons) by an
    overlap-weighted LCS.

    Parameters
    ----------
    left, right : list[tuple[str, int | None, float, float]]
        Each test's sub-band stack as ``(layer_id, nad_class, fraction_top,
        fraction_base)`` ordered top→base, fractions within the litho unit's
        own window (0 = unit top, 1 = unit base). ``None`` classes never
        match (skeleton rule).

    Returns
    -------
    list[tuple[str, str]]
        Monotone ``(left_layer_id, right_layer_id)`` proposal pairs, top→base.
    """

    def weight(
        a: tuple[str, int | None, float, float], b: tuple[str, int | None, float, float]
    ) -> float:
        _, a_cls, a_top, a_base = a
        _, b_cls, b_top, b_base = b
        if a_cls is None or b_cls is None or a_cls != b_cls:
            return 0.0
        overlap = min(a_base, b_base) - max(a_top, b_top)
        larger = max(a_base - a_top, b_base - b_top)
        if larger <= 0.0 or overlap / larger < INTERIOR_MIN_OVERLAP_SHARE:
            return 0.0
        return overlap

    n, m = len(left), len(right)
    if not n or not m:
        return []
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            w = weight(left[i], right[j])
            take = (w + dp[i + 1][j + 1]) if w > 0.0 else float("-inf")
            dp[i][j] = max(dp[i + 1][j], dp[i][j + 1], take)
    pairs: list[tuple[str, str]] = []
    i = j = 0
    while i < n and j < m:
        w = weight(left[i], right[j])
        if w > 0.0 and abs(dp[i][j] - (w + dp[i + 1][j + 1])) < 1e-12:
            pairs.append((left[i][0], right[j][0]))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return pairs
