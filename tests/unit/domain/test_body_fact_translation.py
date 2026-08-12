"""Unit tests for the pure geometry-fact translation (layer-space evidence).

Evidence arrives entirely in LAYER-id space — per-section groups from the
frontend, cross-section groups from ``plan_layer_groups``. The first design
used body ids and oscillated in production: once a merge succeeded, the next
payload's body evidence collapsed and the merge erased itself. These tests pin
the label-independent shape.
"""

from __future__ import annotations

from groundmodel.domain.services.body_fact_translation import plan_geometry_facts


def test_section_and_cross_section_groups_union_into_one_component() -> None:
    """A section group and a cross-section group chain into ONE component."""
    result = plan_geometry_facts(
        section_layer_groups=[[["layer-1", "layer-3"]]],
        cross_section_layer_groups=[{"layer-3", "layer-2"}],
    )

    assert result.facts == (
        ("layer-1", "layer-2"),
        ("layer-1", "layer-3"),
        ("layer-2", "layer-3"),
    )


def test_singleton_groups_produce_no_facts() -> None:
    """A layer alone in its component states nothing."""
    result = plan_geometry_facts(
        section_layer_groups=[[["layer-1"]], []],
        cross_section_layer_groups=[{"layer-2"}],
    )

    assert result.facts == ()


def test_duplicate_evidence_dedupes_to_one_fact() -> None:
    """The same adjacency observed on two sections is one fact, not two."""
    result = plan_geometry_facts(
        section_layer_groups=[[["layer-2", "layer-1"]], [["layer-1", "layer-2"]]],
        cross_section_layer_groups=[{"layer-1", "layer-2"}],
    )

    assert result.facts == (("layer-1", "layer-2"),)


def test_same_geometry_plans_the_same_facts_whatever_the_labels_did() -> None:
    """Idempotence by construction — the oscillator pin at the pure level.

    The body-id design broke here: after a merge the payload's groups
    collapsed. Layer groups describe geometry only, so re-planning the same
    groups after ANY number of restamps yields byte-identical facts.
    """
    groups = [[["layer-a", "layer-b"], ["layer-c"]]]
    first = plan_geometry_facts(section_layer_groups=groups)
    second = plan_geometry_facts(section_layer_groups=groups)

    assert first == second
    assert first.facts == (("layer-a", "layer-b"),)
