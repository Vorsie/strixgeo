"""Unit tests for same_class_pairs — the geotech same-class auto-edge helper."""

from groundmodel.domain.services.geotech_packing_edges import same_class_pairs


def test_same_class_pairs_connects_matching_classes_across_an_interbed():
    # S6 sand unit: [matig(6), dicht(7)].  S13 same unit: [matig(6), matig(6), dicht(7)].
    # Old full-sequence rule emitted 0 (counts differ). New rule ties every
    # same-class pair: matig->both matig, dicht->dicht.
    left = [("l_m", 6), ("l_d", 7)]
    right = [("r_m1", 6), ("r_m2", 6), ("r_d", 7)]
    pairs = set(same_class_pairs(left, right))
    assert pairs == {("l_m", "r_m1"), ("l_m", "r_m2"), ("l_d", "r_d")}


def test_same_class_pairs_skips_null_class():
    left = [("l_a", None), ("l_b", 6)]
    right = [("r_a", None), ("r_b", 6)]
    assert set(same_class_pairs(left, right)) == {("l_b", "r_b")}


def test_same_class_pairs_never_crosses_class():
    left = [("l", 5)]
    right = [("r", 7)]
    assert same_class_pairs(left, right) == []


def test_same_class_pairs_skips_right_side_null_class():
    # A right-side None never matches a real class (None == 6 is False).
    assert same_class_pairs([("l", 6)], [("r", None)]) == []


def test_same_class_pairs_empty_when_either_side_empty():
    assert same_class_pairs([], [("r", 6)]) == []
    assert same_class_pairs([("l", 6)], []) == []
