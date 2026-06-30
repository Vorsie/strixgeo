"""Unit tests for ``aligned_same_sequence_pairs`` — geotech packing-edge pairing."""

from groundmodel.domain.services.geotech_packing_edges import aligned_same_sequence_pairs


def test_identical_sequence_pairs_one_to_one():
    """Identical NAD-class sequences -> aligned index pairs for every band."""
    left = [("LA0", 6), ("LA1", 7)]  # (layer_id, nad_class) top->base
    right = [("RB0", 6), ("RB1", 7)]
    assert aligned_same_sequence_pairs(left, right) == [("LA0", "RB0"), ("LA1", "RB1")]


def test_mismatched_count_no_pairs():
    """Different band counts -> no pairs (manual fills it)."""
    left = [("LA0", 6), ("LA1", 7)]
    right = [("RB0", 6), ("RB1", 7), ("RB2", 8)]
    assert aligned_same_sequence_pairs(left, right) == []


def test_same_count_different_class_no_pairs():
    """Same count but a class differs -> not an identical sequence -> no pairs."""
    left = [("LA0", 6), ("LA1", 7)]
    right = [("RB0", 6), ("RB1", 8)]
    assert aligned_same_sequence_pairs(left, right) == []


def test_same_count_different_order_no_pairs():
    """Same multiset but a different order -> not an identical sequence -> no pairs."""
    left = [("LA0", 6), ("LA1", 7)]
    right = [("RB0", 7), ("RB1", 6)]
    assert aligned_same_sequence_pairs(left, right) == []


def test_empty_either_side_no_pairs():
    """Either side empty -> no pairs (nothing to align against)."""
    assert aligned_same_sequence_pairs([], [("RB0", 6)]) == []
    assert aligned_same_sequence_pairs([("LA0", 6)], []) == []


def test_none_class_sequences_still_pair():
    """None classes compare equal here; the spec §8 null-skip lives in the caller."""
    left = [("LA0", 6), ("LA1", None)]
    right = [("RB0", 6), ("RB1", None)]
    assert aligned_same_sequence_pairs(left, right) == [("LA0", "RB0"), ("LA1", "RB1")]


def test_body_isolation_is_callers_responsibility():
    """aligned_same_sequence_pairs pairs identical sequences regardless of body membership.

    The function knows nothing about litho bodies — it only compares NAD-class
    sequences.  Two ZAND columns from DIFFERENT litho bodies (Body-X and Body-Y)
    with the same sequence [6, 7] would produce pairs here.

    This is intentional: the function is called PER BODY GROUP by
    ``_derive_geotech_edges_from_litho`` (which pre-filters to within-body
    columns), so the body isolation lives in the CALLER, not in this pure helper.

    The HTTP-layer guard (``CrossLithoBodyCorrelationError``) is the load-bearing
    defence that stops a MANUAL geotech correlate from crossing body boundaries
    after the automatic per-body grouping has already run.  This test documents
    that the guard is NECESSARY: without the HTTP guard, a user could manually
    tie bands from Body-X to Body-Y even though the auto-edge logic never would.
    """
    # Two SAND columns, same NAD sequence, belonging to different litho bodies
    # (pretend "LX0"/"LX1" are from Body-X and "LY0"/"LY1" are from Body-Y).
    body_x_left = [("LX0", 6), ("LX1", 7)]
    body_y_right = [("LY0", 6), ("LY1", 7)]

    # The function pairs them — it cannot distinguish by body membership.
    pairs = aligned_same_sequence_pairs(body_x_left, body_y_right)
    assert pairs == [("LX0", "LY0"), ("LX1", "LY1")], (
        "Function pairs by sequence only; body isolation is the caller's responsibility"
    )
