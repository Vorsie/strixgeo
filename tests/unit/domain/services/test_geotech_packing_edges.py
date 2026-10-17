"""Unit tests for ``aligned_same_class_pairs`` — geotech packing-edge pairing via LCS."""

from groundmodel.domain.services.geotech_packing_edges import (
    aligned_same_class_pairs,
    shadowed_below_lens,
)

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


# ---------------------------------------------------------------------------
# Forced-topmost alignment (owner ruling 2026-08-13: "start from the exact
# litho geometries") — the restatement pair exists regardless of class
# ---------------------------------------------------------------------------


def test_forced_top_pairs_cross_class_tops():
    """[23] vs [22, 23]: the tops pair DESPITE the class difference.

    The topmost sub-bands own the same contact surfaces the litho tie joins
    (the owner's clay case: S10's FF clay top vs S6's MF crust top). The old
    whole-stack LCS could only produce the class-matched 23-23 pair - tying
    the litho contact to a band one step DEEPER, which let the sand reach
    below the litho clay top in the fill.
    """
    from groundmodel.domain.services.geotech_packing_edges import aligned_pairs_with_forced_top

    left = [("L23", 23)]
    right = [("R22", 22), ("R23", 23)]
    pairs = aligned_pairs_with_forced_top(left, right)
    assert pairs[0] == ("L23", "R22"), "tops pair cross-class - the restatement"
    assert ("L23", "R23") not in pairs, (
        "the left top must not ALSO pair with the deeper class-match - one band, one partner"
    )


def test_forced_top_suppresses_the_absurd_deep_shallow_pair():
    """[14] vs [13, 14]: the old LCS tied the left top to the DEEP right 14.

    Real-data case (the owner's DB holds this as a pending proposal): S10's
    top silt sliver at 12 m elevation proposed against S6's n14 at 6 m. With
    the forced top, the tops pair (14-13, the restatement) and the suffix LCS
    below them has nothing left on the left - no absurd pair.
    """
    from groundmodel.domain.services.geotech_packing_edges import aligned_pairs_with_forced_top

    left = [("L14", 14)]
    right = [("R13", 13), ("R14", 14)]
    pairs = aligned_pairs_with_forced_top(left, right)
    assert pairs == [("L14", "R13")]


def test_forced_top_equal_class_tops_match_plain_lcs():
    """Equal-class tops: forced-top output equals the plain LCS alignment."""
    from groundmodel.domain.services.geotech_packing_edges import (
        aligned_pairs_with_forced_top,
        aligned_same_class_pairs,
    )

    left = [("LA0", 6), ("LA1", 6), ("LA2", 7), ("LA3", 8)]
    right = [("RB0", 6), ("RB1", 8), ("RB2", 5)]
    assert aligned_pairs_with_forced_top(left, right) == aligned_same_class_pairs(left, right)


def test_forced_top_skeleton_top_falls_back_to_plain_lcs():
    """A None-class (skeleton) top blocks the forced pair (pinned rule:
    'skeleton-None top blocks restatement') - the whole alignment falls back
    to the plain LCS, which never pairs None."""
    from groundmodel.domain.services.geotech_packing_edges import aligned_pairs_with_forced_top

    left = [("SKEL", None), ("L5", 5)]
    right = [("R5", 5)]
    assert aligned_pairs_with_forced_top(left, right) == [("L5", "R5")]


def test_forced_top_empty_sides_yield_nothing():
    """An empty stack on either side aligns nothing."""
    from groundmodel.domain.services.geotech_packing_edges import aligned_pairs_with_forced_top

    assert aligned_pairs_with_forced_top([], [("R5", 5)]) == []
    assert aligned_pairs_with_forced_top([("L5", 5)], []) == []


# ---------------------------------------------------------------------------
# Interior body proposals (owner ruling 2026-08-14: "auto correlate is fine,
# its just a tool to make the users life easier") — overlap-gated pairs the
# monotone forced-top alignment cannot reach
# ---------------------------------------------------------------------------


def test_interior_pairs_propose_the_big_body_the_forced_top_consumed():
    """CS1 gap 3, B4|S13: the restatement ties S13's n13 top to B4's thin n14
    crust, and the suffix LCS then cannot pair the two big n13 BODIES - the
    287 m2 hole. The interior pass proposes them: same class, large
    fraction-overlap within their litho windows."""
    from groundmodel.domain.services.geotech_packing_edges import overlap_gated_interior_pairs

    left = [("crust14", 14, 0.0, 0.107), ("body13", 13, 0.107, 0.9), ("deep13", 13, 0.9, 1.0)]
    right = [("big13", 13, 0.0, 0.78), ("n16", 16, 0.78, 1.0)]
    pairs = overlap_gated_interior_pairs(left, right)
    assert ("body13", "big13") in pairs


def test_interior_pairs_do_not_revive_the_absurd_sliver_deep_pair():
    """The S10 case: a sliver that IS its whole unit (fractions 0..1) against
    a deep thin band at the base of a big unit (0.92..1). Their overlap is
    tiny relative to the sliver's extent - proposing it would revive the
    12 m to 6 m elevation ghost the forced top killed."""
    from groundmodel.domain.services.geotech_packing_edges import overlap_gated_interior_pairs

    left = [("sliver14", 14, 0.0, 1.0)]
    right = [("big13", 13, 0.0, 0.92), ("deep14", 14, 0.92, 1.0)]
    assert overlap_gated_interior_pairs(left, right) == []


def test_interior_pairs_never_pair_none_classes():
    """Skeleton bands never auto-tie (spec 8)."""
    from groundmodel.domain.services.geotech_packing_edges import overlap_gated_interior_pairs

    left = [("skel", None, 0.0, 1.0)]
    right = [("other", None, 0.0, 1.0)]
    assert overlap_gated_interior_pairs(left, right) == []


def test_interior_pairs_stay_monotone_when_candidates_cross():
    """Two same-class candidates that would cross keep only a monotone set -
    ghost ribbons must not X over each other."""
    from groundmodel.domain.services.geotech_packing_edges import overlap_gated_interior_pairs

    left = [("a1", 7, 0.0, 0.5), ("a2", 8, 0.5, 1.0)]
    right = [("b1", 8, 0.0, 0.5), ("b2", 7, 0.5, 1.0)]
    # a1(7) overlaps b1 zone, a2(8) overlaps b2 zone - the class-matched
    # candidates (a1,b2) and (a2,b1) cross AND have weak overlap; nothing
    # monotone with real overlap exists.
    assert overlap_gated_interior_pairs(left, right) == []


# --- below-lens shadowing (owner dogfeed 2026-08-17, image 58) ---------------
#
# S12's silt unit reads [SILT 13, denser SILT 15, SILT 13]; S13's is one
# SILT 13.  The top pair is tied by the restatement, and the machine ALSO
# proposed S13's 1.42 -> S12's 3.47 — the band below the lens.  Owner rule,
# verbatim: *"don't emit auto correlations ties below a lens if above the lens
# and below the lens have the same packing density and litho?"*  The merge
# step unifies that silt around the lens anyway, so the extra proposal is
# noise he has to delete — and it fans from a contact that is already tied.


def _frac(layer_id: str, cls: int | None, top: float, base: float):
    return (layer_id, cls, top, base)


def test_bl1_his_s12_sandwich_shadows_the_below_lens_band() -> None:
    stack = [_frac("top", 13, 0.0, 0.4), _frac("lens", 15, 0.4, 0.6), _frac("below", 13, 0.6, 1.0)]
    assert shadowed_below_lens(stack) == {"below"}


def test_bl2_a_stack_without_a_lens_shadows_nothing() -> None:
    assert shadowed_below_lens([_frac("a", 13, 0.0, 0.5), _frac("b", 15, 0.5, 1.0)]) == set()


def test_bl3_the_lens_itself_is_never_shadowed() -> None:
    """The lens band may still tie — only the same-class repeat below it."""
    stack = [_frac("top", 13, 0.0, 0.4), _frac("lens", 15, 0.4, 0.6), _frac("below", 13, 0.6, 1.0)]
    assert "lens" not in shadowed_below_lens(stack)


def test_bl4_a_different_class_below_the_lens_is_not_shadowed() -> None:
    """[13, 15, 21]: the 21 is new information, not a repeat around a lens."""
    stack = [_frac("a", 13, 0.0, 0.4), _frac("b", 15, 0.4, 0.6), _frac("c", 21, 0.6, 1.0)]
    assert shadowed_below_lens(stack) == set()


def test_bl5_two_lenses_shadow_every_repeat_below_them() -> None:
    stack = [
        _frac("a", 13, 0.0, 0.2),
        _frac("l1", 15, 0.2, 0.4),
        _frac("b", 13, 0.4, 0.6),
        _frac("l2", 16, 0.6, 0.8),
        _frac("c", 13, 0.8, 1.0),
    ]
    assert shadowed_below_lens(stack) == {"b", "c"}


def test_bl6_adjacent_same_class_bands_are_not_a_lens_shape() -> None:
    """[13, 13]: a geological cut, not a sandwich — nothing intervenes."""
    assert shadowed_below_lens([_frac("a", 13, 0.0, 0.5), _frac("b", 13, 0.5, 1.0)]) == set()


def test_bl7_skeleton_bands_neither_shadow_nor_are_shadowed() -> None:
    """A None class is no evidence of anything (spec §8)."""
    stack = [_frac("a", 13, 0.0, 0.4), _frac("gap", None, 0.4, 0.6), _frac("b", 13, 0.6, 1.0)]
    assert shadowed_below_lens(stack) == set()
