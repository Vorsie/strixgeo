"""Unit tests for the pure formation-surface contact rule.

Pins the decision the TIN rebuild delegates to, in the owner's words
(ruling 2026-09-06): "a formation contact on a test that was removed
from the project is not a model input".
"""

from __future__ import annotations

from uuid6 import uuid7

from groundmodel.domain.services.formation_surface_contacts import (
    contact_feeds_surface,
)


def test_contact_on_removed_test_is_not_a_model_input() -> None:
    """A contact anchored to a project-removed (hidden) investigation
    does not feed the surface — whether the anchor is a CPT or a
    borehole."""
    hidden_cpt = uuid7()
    hidden_bh = uuid7()
    assert not contact_feeds_surface(
        borehole_id=None,
        cpt_id=hidden_cpt,
        hidden_investigation_ids={hidden_cpt},
        excluded_borehole_ids=set(),
    )
    assert not contact_feeds_surface(
        borehole_id=hidden_bh,
        cpt_id=None,
        hidden_investigation_ids={hidden_bh},
        excluded_borehole_ids=set(),
    )


def test_contact_on_a_visible_test_feeds_the_surface() -> None:
    """A contact whose anchor is neither hidden nor excluded is a model input."""
    assert contact_feeds_surface(
        borehole_id=None,
        cpt_id=uuid7(),
        hidden_investigation_ids={uuid7()},  # someone ELSE is hidden
        excluded_borehole_ids=set(),
    )


def test_contact_on_model_excluded_borehole_is_dropped() -> None:
    """The existing model-scoped exclusion still drops borehole anchors."""
    excluded = uuid7()
    assert not contact_feeds_surface(
        borehole_id=excluded,
        cpt_id=None,
        hidden_investigation_ids=set(),
        excluded_borehole_ids={excluded},
    )


def test_synthetic_contact_without_an_anchor_always_feeds() -> None:
    """A synthetic (extrapolated) contact has no investigation anchor,
    so it can never be hidden or excluded — it always feeds the TIN."""
    assert contact_feeds_surface(
        borehole_id=None,
        cpt_id=None,
        hidden_investigation_ids={uuid7()},
        excluded_borehole_ids={uuid7()},
    )
