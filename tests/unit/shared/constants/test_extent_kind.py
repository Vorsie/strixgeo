"""Unit tests for the extent_kind enum + helpers."""

from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
    EXTENT_KIND_VALUES,
    is_user_claimed_extent_kind,
)


def test_all_known_values_are_in_set() -> None:
    """Every named constant must appear in EXTENT_KIND_VALUES."""
    assert EXTENT_KIND_TO_TARGET in EXTENT_KIND_VALUES
    assert EXTENT_KIND_PINCH_OUT_HALFWAY in EXTENT_KIND_VALUES
    assert EXTENT_KIND_EXTRAPOLATED in EXTENT_KIND_VALUES
    assert EXTENT_KIND_OPEN in EXTENT_KIND_VALUES


def test_set_has_exactly_four_values() -> None:
    """Drift guard: adding a kind without updating tests/types should fail loudly."""
    assert len(EXTENT_KIND_VALUES) == 4


def test_is_user_claimed_extent_kind() -> None:
    """to_target is detector-set; the other three are user-claimed."""
    assert not is_user_claimed_extent_kind(EXTENT_KIND_TO_TARGET)
    assert is_user_claimed_extent_kind(EXTENT_KIND_PINCH_OUT_HALFWAY)
    assert is_user_claimed_extent_kind(EXTENT_KIND_EXTRAPOLATED)
    assert is_user_claimed_extent_kind(EXTENT_KIND_OPEN)
    assert not is_user_claimed_extent_kind(None)
