"""Unit tests for the ``_checksum_picks`` body-geometry digest (audit #8 backfill).

The checksum is the cache-invalidation key for the 3-D litho solid builder: a
body rebuilds only when its picks' digest changes. These guard tests pin the
three properties the cache relies on — determinism, order-independence, and
geometry-sensitivity — so a future packing change can't silently break cache
invalidation.
"""

from __future__ import annotations

from groundmodel.application.recompute_litho_solids import _checksum_picks
from groundmodel.domain.services.litho_body_pick import BodyLayerPick


def _pick(inv: str, *, x=1.0, y=2.0, surf=10.0, top=1.0, base=3.0) -> BodyLayerPick:
    """Build a BodyLayerPick with sensible defaults for the geometry fields."""
    return BodyLayerPick(
        investigation_id=inv,
        x_m=x,
        y_m=y,
        surface_elev_m=surf,
        body_id="body-1",
        formation_id="f-1",
        top_depth_m=top,
        base_depth_m=base,
    )


def test_identical_pick_sets_have_equal_checksum() -> None:
    """Same picks → same digest (deterministic)."""
    a = [_pick("A"), _pick("B")]
    b = [_pick("A"), _pick("B")]
    assert _checksum_picks(a) == _checksum_picks(b)


def test_checksum_is_order_independent() -> None:
    """Reordering the picks does not change the digest (sorted internally)."""
    forward = [_pick("A"), _pick("B"), _pick("C")]
    shuffled = [_pick("C"), _pick("A"), _pick("B")]
    assert _checksum_picks(forward) == _checksum_picks(shuffled)


def test_geometry_change_changes_checksum() -> None:
    """A different base depth (any geometry field) busts the digest."""
    base = [_pick("A", base=3.0)]
    moved = [_pick("A", base=3.5)]
    assert _checksum_picks(base) != _checksum_picks(moved)


def test_added_pick_changes_checksum() -> None:
    """Adding a member layer changes the digest."""
    one = [_pick("A")]
    two = [_pick("A"), _pick("B")]
    assert _checksum_picks(one) != _checksum_picks(two)


def test_checksum_is_16_bytes() -> None:
    """The digest is the fixed 16-byte BLAKE2b size the column stores."""
    assert len(_checksum_picks([_pick("A")])) == 16
