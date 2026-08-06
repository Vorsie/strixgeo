"""Unit tests for ``aligned_same_class_pairs`` — geotech packing-edge pairing via LCS."""

from groundmodel.domain.services.geotech_packing_edges import aligned_same_class_pairs

# ---------------------------------------------------------------------------
# Back-compat: identical sequences still connect 1-to-1
# ---------------------------------------------------------------------------


def test_identical_sequence_pairs_one_to_one():
    """Identical NAD-class sequences → aligned index pairs for every band."""
    left = [("LA0", 6), ("LA1", 7)]  # (layer_id, nad_class) top->base
    right = [("RB0", 6), ("RB1", 7)]
    assert aligned_same_class_pairs(left, right) == [("LA0", "RB0"), ("LA1", "RB1")]


# ---------------------------------------------------------------------------
# The real-data case: mismatched count, partial LCS alignment
# ---------------------------------------------------------------------------


def test_real_case_mismatched_packing_sequences():
    """[6,6,7,8] vs [6,8,5] → exactly 2 LCS pairs (the aligned 6 and 8).

    This is the load-bearing regression case: two sand columns in the SAME
    litho body where one test has four packing bands and the other has three
    with different classes.  The old full-sequence rule (aligned_same_sequence_pairs)
    returned [] because lengths differ; the LCS matcher connects the classes
    they share (6 and 8) and leaves the others unconnected.
    """
    left = [("LA0", 6), ("LA1", 6), ("LA2", 7), ("LA3", 8)]
    right = [("RB0", 6), ("RB1", 8), ("RB2", 5)]
    pairs = aligned_same_class_pairs(left, right)
    assert len(pairs) == 2, f"Expected 2 LCS pairs, got {len(pairs)}: {pairs}"
    # Verify the matched classes are [6, 8] in order (LCS = [6, 8]).
    # This also confirms both pairs are same-class (6↔6 and 8↔8, never 6↔8).
    left_by_id = {lid: cls for lid, cls in left}
    right_by_id = {rid: cls for rid, cls in right}
    matched_classes = [(left_by_id[la], right_by_id[rb]) for la, rb in pairs]
    assert all(lc == rc for lc, rc in matched_classes), (
        f"Paired layers must share the same NAD class: {matched_classes}"
    )
    assert [lc for lc, _ in matched_classes] == [6, 8], (
        f"LCS of [6,6,7,8] vs [6,8,5] should be [6,8], got {[lc for lc, _ in matched_classes]}"
    )


def test_partial_count_shared_lcs():
    """[6,7] vs [6,7,8] → 2 pairs: LCS is [6,7], connecting what both share."""
    left = [("LA0", 6), ("LA1", 7)]
    right = [("RB0", 6), ("RB1", 7), ("RB2", 8)]
    pairs = aligned_same_class_pairs(left, right)
    assert len(pairs) == 2
    assert pairs == [("LA0", "RB0"), ("LA1", "RB1")]


def test_partial_class_overlap_connects_lcs():
    """[6,7] vs [6,8] → 1 pair: only the 6-class bands share a class."""
    left = [("LA0", 6), ("LA1", 7)]
    right = [("RB0", 6), ("RB1", 8)]
    pairs = aligned_same_class_pairs(left, right)
    assert len(pairs) == 1
    assert pairs == [("LA0", "RB0")]


# ---------------------------------------------------------------------------
# Disjoint classes → empty
# ---------------------------------------------------------------------------


def test_disjoint_classes_no_pairs():
    """Entirely disjoint NAD-class sets → no LCS → no pairs."""
    left = [("LA0", 5), ("LA1", 6)]
    right = [("RB0", 7), ("RB1", 8)]
    assert aligned_same_class_pairs(left, right) == []


# ---------------------------------------------------------------------------
# Empty sides
# ---------------------------------------------------------------------------


def test_empty_either_side_no_pairs():
    """Either side empty → no pairs (nothing to align against)."""
    assert aligned_same_class_pairs([], [("RB0", 6)]) == []
    assert aligned_same_class_pairs([("LA0", 6)], []) == []


# ---------------------------------------------------------------------------
# None (skeleton) bands never match
# ---------------------------------------------------------------------------


def test_none_class_never_pairs():
    """A None nad_class never matches — not even another None.

    Both sides carry one real class (6) and one skeleton (None).
    Only the real-class bands connect; skeleton bands are excluded from
    auto-connection per spec §8.
    """
    left = [("LA0", None), ("LA1", 6)]
    right = [("RB0", None), ("RB1", 6)]
    pairs = aligned_same_class_pairs(left, right)
    # Only the 6↔6 pair; the None↔None pair must NOT appear.
    assert pairs == [("LA1", "RB1")], (
        f"Expected [(LA1, RB1)] only — None must not pair with None, got {pairs}"
    )


def test_none_only_sides_no_pairs():
    """Two stacks of only None classes → no pairs at all."""
    left = [("LA0", None), ("LA1", None)]
    right = [("RB0", None), ("RB1", None)]
    assert aligned_same_class_pairs(left, right) == []


# ---------------------------------------------------------------------------
# Order preservation — no crossing (monotonic LCS property)
# ---------------------------------------------------------------------------


def test_ambiguous_alignment_prefers_the_topmost_pairing():
    """When equally-long alignments exist, the TOP pairing wins.

    Owner refinement 2026-08-06: the pairing of the two TOPMOST sub-bands is
    the litho tie restated (same contact surfaces the engineer tied), so when
    the LCS has a choice it must keep the tops together. [loose, dense] vs
    [loose, loose] has two optimal length-1 alignments — top↔top and
    top↔bottom; pairing the left top with the right BOTTOM (the old
    bottom-up traceback's pick) skips the restatement and geologically ties a
    surface band to a deep band for no reason.
    """
    left = [("L-top", 5), ("L-deep", 9)]
    right = [("R-top", 5), ("R-deep", 5)]
    assert aligned_same_class_pairs(left, right) == [("L-top", "R-top")]
    # Mirrored: the ambiguity on the LEFT side resolves to the top too.
    left2 = [("L-top", 5), ("L-deep", 5)]
    right2 = [("R-top", 5), ("R-deep", 9)]
    assert aligned_same_class_pairs(left2, right2) == [("L-top", "R-top")]


def test_order_preserved_no_crossing():
    """[6,7] vs [7,6] → 1 pair only; the LCS is monotonic, no crossing allowed.

    A pair (LA0→6, RB1→6) and (LA1→7, RB0→7) would cross — the LCS
    algorithm guarantees order preservation so only one of the two classes
    is chosen.
    """
    left = [("LA0", 6), ("LA1", 7)]
    right = [("RB0", 7), ("RB1", 6)]
    pairs = aligned_same_class_pairs(left, right)
    assert len(pairs) == 1, (
        f"Reversed sequences share only one order-preserving class, got {len(pairs)}: {pairs}"
    )
    # Verify no index inversion on either side.
    left_index = {lid: i for i, (lid, _) in enumerate(left)}
    right_index = {rid: i for i, (rid, _) in enumerate(right)}
    for k in range(1, len(pairs)):
        la_prev, rb_prev = pairs[k - 1]
        la_curr, rb_curr = pairs[k]
        assert left_index[la_curr] > left_index[la_prev], "Left side must be strictly increasing"
        assert right_index[rb_curr] > right_index[rb_prev], "Right side must be strictly increasing"


# ---------------------------------------------------------------------------
# Body isolation is still the caller's responsibility
# ---------------------------------------------------------------------------


def test_body_isolation_is_callers_responsibility():
    """aligned_same_class_pairs pairs by LCS class regardless of body membership.

    Two ZAND columns from DIFFERENT litho bodies (Body-X and Body-Y) with a
    shared NAD-class in their LCS would produce pairs here.

    This is intentional: the function is called PER BODY GROUP by
    ``_derive_geotech_edges_from_litho`` (which pre-filters to within-body
    columns), so the body isolation lives in the CALLER, not in this pure
    helper.

    The HTTP-layer guard (``CrossLithoBodyCorrelationError``) is the
    load-bearing defence that stops a MANUAL geotech correlate from crossing
    body boundaries after the automatic per-body grouping has already run.
    """
    # Two SAND columns, same NAD sequence, belonging to different litho bodies.
    body_x_left = [("LX0", 6), ("LX1", 7)]
    body_y_right = [("LY0", 6), ("LY1", 7)]

    pairs = aligned_same_class_pairs(body_x_left, body_y_right)
    assert pairs == [("LX0", "LY0"), ("LX1", "LY1")], (
        "Function pairs by LCS only; body isolation is the caller's responsibility"
    )
