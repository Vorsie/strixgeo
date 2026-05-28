"""Unit tests for the stable lens content key (#163f Slice 2 carry-forward)."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.lens_identity import lens_content_key


def _u(n: int) -> UUID:
    return UUID(int=n)


def test_key_is_order_independent() -> None:
    """The three defining contact ids hash to the same key in any order — the
    lens identity is the SET of contacts, so re-detection (which may emit them
    in a different order) recovers the same shape."""
    a = lens_content_key(_u(1), _u(2), _u(3))
    b = lens_content_key(_u(3), _u(1), _u(2))
    assert a == b


def test_distinct_contact_sets_differ() -> None:
    """A different defining-contact set yields a different key."""
    assert lens_content_key(_u(1), _u(2), _u(3)) != lens_content_key(_u(1), _u(2), _u(4))


def test_key_is_stable_string() -> None:
    """The key is a non-empty deterministic string (safe for a TEXT column)."""
    k = lens_content_key(_u(1), _u(2), _u(3))
    assert isinstance(k, str)
    assert k != ""
    assert k == lens_content_key(_u(1), _u(2), _u(3))
