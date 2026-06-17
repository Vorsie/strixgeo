"""Unit tests for ``canonical_contact_order`` — bottom-tie side pairing.

The helper canonicalises a correlation-edge endpoint pair to ``a_id < b_id``.
With the bottom-tie ``contact_side`` discriminator (spec 2026-06-17), each
endpoint carries a ``'top'`` / ``'base'`` side that MUST travel with its
contact id when the pair is swapped — otherwise a swapped base↔base edge would
silently mix the sides.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.application.correlate_litho_contacts import canonical_contact_order

# Two fixed UUIDs with a known ordering: SMALL < BIG.
SMALL_UUID = UUID("00000000-0000-0000-0000-000000000001")
BIG_UUID = UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")


def test_canonical_order_keeps_side_with_its_contact() -> None:
    """b_id < a_id forces a swap; the sides must swap with their contacts."""
    a_id, a_side, b_id, b_side = canonical_contact_order(BIG_UUID, "base", SMALL_UUID, "top")
    assert (a_id, a_side) == (SMALL_UUID, "top")
    assert (b_id, b_side) == (BIG_UUID, "base")


def test_canonical_order_default_top_preserved() -> None:
    """Already-canonical input with default 'top' sides passes through unchanged."""
    a_id, a_side, b_id, b_side = canonical_contact_order(SMALL_UUID, "top", BIG_UUID, "top")
    assert a_side == "top" and b_side == "top"
    assert (a_id, b_id) == (SMALL_UUID, BIG_UUID)


def test_canonical_order_base_base_bottom_tie_preserved() -> None:
    """A base↔base bottom-tie keeps both 'base' sides through a swap."""
    a_id, a_side, b_id, b_side = canonical_contact_order(BIG_UUID, "base", SMALL_UUID, "base")
    assert (a_id, a_side) == (SMALL_UUID, "base")
    assert (b_id, b_side) == (BIG_UUID, "base")


def test_canonical_order_mixed_sides_preserved() -> None:
    """A swap with asymmetric sides (top/base): each side follows its contact."""
    a_id, a_side, b_id, b_side = canonical_contact_order(BIG_UUID, "top", SMALL_UUID, "base")
    assert (a_id, a_side) == (SMALL_UUID, "base")
    assert (b_id, b_side) == (BIG_UUID, "top")
