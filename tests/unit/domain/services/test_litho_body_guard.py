"""Behaviour tests for the geotech packing-correlation litho-body guard.

Owner ruling (2026-08-04 evening dogfeed): a contact is a SURFACE with a band
above and a band below — it touches up to TWO litho bodies.  The guard must
compare both of the left contact's bodies against both of the right's, and
"if one matches it matches": the tie is a legitimate surface tie of the shared
body's boundary.  The half-matched case even carries geometry — the unmatched
band tapers out to a point at the tied contact (recorded for the 2/1/0 fill).

The pre-ruling guard resolved only the band BELOW each contact, which refused
the owner's clay-base↔clay-base tie because one side's below-band was silt.
"""

from groundmodel.domain.services.litho_body_guard import shares_litho_body


def test_same_single_body_matches():
    """Both contacts inside one body — the trivial allow."""
    assert shares_litho_body({"a": {"clay-1"}, "b": {"clay-1"}}, "a", "b") is True


def test_disjoint_bodies_block():
    """No shared body on either side — two separate sand bodies must not merge."""
    assert shares_litho_body({"a": {"sand-1"}, "b": {"sand-2"}}, "a", "b") is False


def test_one_of_two_adjacent_bodies_matching_allows():
    """The owner's clay-base tie: left touches {clay}, right touches {clay, silt}."""
    assert shares_litho_body({"a": {"clay-1"}, "b": {"clay-1", "silt-1"}}, "a", "b") is True


def test_both_sides_two_bodies_any_overlap_allows():
    """Both contacts are body boundaries; the shared body may be on either side."""
    assert (
        shares_litho_body({"a": {"clay-1", "sand-1"}, "b": {"sand-1", "silt-1"}}, "a", "b") is True
    )


def test_unresolvable_contact_blocks():
    """An empty set means no adjacent band resolved — conservative refusal."""
    assert shares_litho_body({"a": set(), "b": {"clay-1"}}, "a", "b") is False
    assert shares_litho_body({"a": {"clay-1"}, "b": set()}, "a", "b") is False


def test_missing_contact_blocks():
    """A contact absent from the map never permits an edge."""
    assert shares_litho_body({"a": {"clay-1"}}, "a", "b") is False
    assert shares_litho_body({}, "a", "b") is False
