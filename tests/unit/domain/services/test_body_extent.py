"""Unit tests for BodyExtent + DetectedBody dataclasses."""

from uuid import UUID

import pytest
from groundmodel.domain.services.body_extent import BodyExtent, DetectedBody

from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
)


def _uid(n: int) -> UUID:
    return UUID(int=n)


def test_body_extent_immutable() -> None:
    """BodyExtent is frozen — defensive against accidental mutation."""
    extent = BodyExtent(
        kind=EXTENT_KIND_TO_TARGET,
        target_contact_id=_uid(1),
        neighbour_investigation_id=_uid(10),
    )
    with pytest.raises(Exception):  # FrozenInstanceError
        extent.kind = EXTENT_KIND_PINCH_OUT_HALFWAY  # type: ignore[misc]


def test_body_extent_to_target_carries_contact() -> None:
    """to_target requires a target contact; neighbour_investigation_id is also set."""
    extent = BodyExtent(
        kind=EXTENT_KIND_TO_TARGET,
        target_contact_id=_uid(1),
        neighbour_investigation_id=_uid(10),
    )
    assert extent.target_contact_id == _uid(1)
    assert extent.neighbour_investigation_id == _uid(10)


def test_detected_body_carries_two_extents() -> None:
    """DetectedBody represents a body the detector found, with per-side extents."""
    left = BodyExtent(EXTENT_KIND_TO_TARGET, _uid(1), _uid(10))
    right = BodyExtent(EXTENT_KIND_TO_TARGET, _uid(2), _uid(20))
    body = DetectedBody(
        formation_id=_uid(100),
        source_investigation_id=_uid(500),
        contact_above_id=_uid(3),
        contact_below_id=_uid(4),
        extent_left=left,
        extent_right=right,
    )
    assert body.extent_left is left
    assert body.extent_right is right
