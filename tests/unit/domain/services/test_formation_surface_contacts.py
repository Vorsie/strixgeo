"""Unit tests for the pure formation-surface contact rule.

Pins the decisions the TIN rebuild delegates to, in the owner's words:
ruling 2026-09-06, "a formation contact on a test that was removed from
the project is not a model input"; ruling 2026-09-23, "you don't need to
drop subdivision on tests, only don't use tests not on sections for the
model" — the picks stay on the test, the test just stops feeding the
model while no cross-section draws it.
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
        section_member_ids={hidden_cpt},
    )
    assert not contact_feeds_surface(
        borehole_id=hidden_bh,
        cpt_id=None,
        hidden_investigation_ids={hidden_bh},
        excluded_borehole_ids=set(),
        section_member_ids={hidden_bh},
    )


def test_contact_on_a_visible_test_feeds_the_surface() -> None:
    """A contact whose anchor is on a section and neither hidden nor
    excluded is a model input."""
    cpt = uuid7()
    assert contact_feeds_surface(
        borehole_id=None,
        cpt_id=cpt,
        hidden_investigation_ids={uuid7()},  # someone ELSE is hidden
        excluded_borehole_ids=set(),
        section_member_ids={cpt},
    )


def test_contact_on_model_excluded_borehole_is_dropped() -> None:
    """The existing model-scoped exclusion still drops borehole anchors."""
    excluded = uuid7()
    assert not contact_feeds_surface(
        borehole_id=excluded,
        cpt_id=None,
        hidden_investigation_ids=set(),
        excluded_borehole_ids={excluded},
        section_member_ids={excluded},
    )


def test_contact_on_a_test_no_section_draws_is_not_a_model_input() -> None:
    """Owner ruling 2026-09-23: a test on no cross-section does not feed the
    model — CPT or borehole alike — however visible and un-excluded it is.
    The pick itself is untouched; only its contribution stops."""
    off_cpt = uuid7()
    off_bh = uuid7()
    on_section = {uuid7(), uuid7()}  # other tests are on sections
    assert not contact_feeds_surface(
        borehole_id=None,
        cpt_id=off_cpt,
        hidden_investigation_ids=set(),
        excluded_borehole_ids=set(),
        section_member_ids=on_section,
    )
    assert not contact_feeds_surface(
        borehole_id=off_bh,
        cpt_id=None,
        hidden_investigation_ids=set(),
        excluded_borehole_ids=set(),
        section_member_ids=on_section,
    )


def test_no_sections_at_all_means_no_test_feeds_the_model() -> None:
    """With no cross-section in the project nothing is on a section, so an
    anchored contact feeds nothing (the geotech membership rule's "entirely
    legitimate state": nothing drawn yet, model correctly empty)."""
    assert not contact_feeds_surface(
        borehole_id=uuid7(),
        cpt_id=None,
        hidden_investigation_ids=set(),
        excluded_borehole_ids=set(),
        section_member_ids=set(),
    )


def test_synthetic_contact_without_an_anchor_always_feeds() -> None:
    """A synthetic (extrapolated) contact has no investigation anchor,
    so it can never be hidden, excluded or off-section — it always
    feeds the TIN, even in a project without sections."""
    assert contact_feeds_surface(
        borehole_id=None,
        cpt_id=None,
        hidden_investigation_ids={uuid7()},
        excluded_borehole_ids={uuid7()},
        section_member_ids=set(),
    )
