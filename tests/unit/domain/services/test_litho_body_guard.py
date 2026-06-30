"""Unit tests for ``same_litho_body`` — litho-body correlation guard."""

from groundmodel.domain.services.litho_body_guard import same_litho_body

_A = "contact-a"
_B = "contact-b"
_BODY_X = "body-x"
_BODY_Y = "body-y"


def test_same_body_returns_true():
    """Both contacts in the same NON-None body → True."""
    mapping = {_A: _BODY_X, _B: _BODY_X}
    assert same_litho_body(mapping, _A, _B) is True


def test_different_bodies_returns_false():
    """Contacts in different bodies → False (cross-body guard triggers)."""
    mapping = {_A: _BODY_X, _B: _BODY_Y}
    assert same_litho_body(mapping, _A, _B) is False


def test_missing_contact_a_returns_false():
    """contact_a absent from the mapping → False (conservative block)."""
    mapping = {_B: _BODY_X}
    assert same_litho_body(mapping, _A, _B) is False


def test_missing_contact_b_returns_false():
    """contact_b absent from the mapping → False (conservative block)."""
    mapping = {_A: _BODY_X}
    assert same_litho_body(mapping, _A, _B) is False


def test_none_body_for_a_returns_false():
    """contact_a mapped to None (unresolved litho body) → False."""
    mapping = {_A: None, _B: _BODY_X}
    assert same_litho_body(mapping, _A, _B) is False


def test_none_body_for_b_returns_false():
    """contact_b mapped to None (unresolved litho body) → False."""
    mapping = {_A: _BODY_X, _B: None}
    assert same_litho_body(mapping, _A, _B) is False


def test_both_none_returns_false():
    """Both contacts map to None → False (neither is a resolved body)."""
    mapping = {_A: None, _B: None}
    assert same_litho_body(mapping, _A, _B) is False


def test_empty_mapping_returns_false():
    """Empty lookup → False for any pair (both absent)."""
    assert same_litho_body({}, _A, _B) is False
