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


def test_empty_either_side_no_pairs():
    assert aligned_same_sequence_pairs([], [("RB0", 6)]) == []
    assert aligned_same_sequence_pairs([("LA0", 6)], []) == []
