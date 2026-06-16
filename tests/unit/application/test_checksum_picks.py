"""Unit tests for the model-level ``_model_checksum`` digest (implicit strat field).

The checksum is the cache-invalidation key for the 3-D litho solid builder.
Since the implicit-stratigraphic rework it is MODEL-level, not per-body: the
strat field is global, so any pick change moves the whole field and a per-body
skip would be unsound.  These guard tests pin the properties the cache relies on
for its pick portion — determinism, order-independence over picks,
geometry-sensitivity, the 16-byte width — plus that a grid-spacing knob change
busts the digest.
"""

from __future__ import annotations

from groundmodel.application.recompute_litho_solids import _model_checksum
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

# Fixed grid-spacing knob — held constant so each test isolates the pick portion
# of the digest unless it deliberately varies the knob.
_GRID_SPACING_M = 1.0


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


def _digest(picks: list[BodyLayerPick]) -> bytes:
    """Compute the model digest with the fixed grid-spacing knob."""
    return _model_checksum(picks, _GRID_SPACING_M)


def test_identical_pick_sets_have_equal_checksum() -> None:
    """Same picks → same digest (deterministic)."""
    a = [_pick("A"), _pick("B")]
    b = [_pick("A"), _pick("B")]
    assert _digest(a) == _digest(b)


def test_checksum_is_order_independent() -> None:
    """Reordering the picks does not change the digest (sorted internally)."""
    forward = [_pick("A"), _pick("B"), _pick("C")]
    shuffled = [_pick("C"), _pick("A"), _pick("B")]
    assert _digest(forward) == _digest(shuffled)


def test_geometry_change_changes_checksum() -> None:
    """A different base depth (any geometry field) busts the digest."""
    base = [_pick("A", base=3.0)]
    moved = [_pick("A", base=3.5)]
    assert _digest(base) != _digest(moved)


def test_added_pick_changes_checksum() -> None:
    """Adding a member layer changes the digest."""
    one = [_pick("A")]
    two = [_pick("A"), _pick("B")]
    assert _digest(one) != _digest(two)


def test_domain_knob_change_changes_checksum() -> None:
    """A different grid-spacing knob busts the digest (the field is global)."""
    picks = [_pick("A")]
    a = _model_checksum(picks, 1.0)
    b = _model_checksum(picks, 2.0)
    assert a != b


def test_checksum_is_16_bytes() -> None:
    """The digest is the fixed 16-byte BLAKE2b size the column stores."""
    assert len(_digest([_pick("A")])) == 16
