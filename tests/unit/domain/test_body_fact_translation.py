"""Unit tests for the pure geometry-fact translation (body ids → layer pairs).

The recompute endpoint receives per-section merge groups (frontend stage 1)
and the cross-section alias map (backend stage 2, ``plan_body_aliases``); the
translation unions both into final components and emits layer-pair facts the
resolver can union. Wire currency is LAYER ids supplied by the frontend's own
snapshot (``body_members``) — never the database's current stamps — so a
recompute can never be orphaned by the restamp of a previous recompute.
"""

from __future__ import annotations

from groundmodel.domain.services.body_fact_translation import plan_geometry_facts


def test_groups_and_aliases_union_into_one_component() -> None:
    """A per-section group and a cross-section alias chain into ONE component.

    Section group says A~B; the alias map says C→B (cross-section). All three
    bodies are one component, and facts are ALL pairs of the component — not a
    star — so losing one body's layers only breaks what physically broke.
    """
    result = plan_geometry_facts(
        section_body_groups=[[["body-a", "body-b"]]],
        cross_section_aliases={"body-c": "body-b", "body-b": "body-b"},
        body_members={
            "body-a": ["layer-1", "layer-9"],
            "body-b": ["layer-3"],
            "body-c": ["layer-2"],
        },
    )

    # Representative layer per body = lexicographic min member; all pairs,
    # canonically ordered, sorted.
    assert result.facts == (
        ("layer-1", "layer-2"),
        ("layer-1", "layer-3"),
        ("layer-2", "layer-3"),
    )
    assert result.unresolved_body_ids == ()


def test_unknown_body_id_yields_no_fact_and_is_reported() -> None:
    """A body id with no member layers cannot anchor a fact — dropped, loudly."""
    result = plan_geometry_facts(
        section_body_groups=[[["body-a", "body-x"]]],
        cross_section_aliases={},
        body_members={"body-a": ["layer-1"]},
    )

    assert result.facts == ()
    assert result.unresolved_body_ids == ("body-x",)


def test_singleton_components_produce_no_facts() -> None:
    """A body alone in its component states nothing — no self-facts, no noise."""
    result = plan_geometry_facts(
        section_body_groups=[[["body-a"]], []],
        cross_section_aliases={"body-b": "body-b"},
        body_members={"body-a": ["layer-1"], "body-b": ["layer-2"]},
    )

    assert result.facts == ()
    assert result.unresolved_body_ids == ()


def test_duplicate_evidence_dedupes_to_one_fact() -> None:
    """The same adjacency observed on two sections is one fact, not two."""
    result = plan_geometry_facts(
        section_body_groups=[[["body-a", "body-b"]], [["body-b", "body-a"]]],
        cross_section_aliases={"body-a": "body-a", "body-b": "body-a"},
        body_members={"body-a": ["layer-2"], "body-b": ["layer-1"]},
    )

    assert result.facts == (("layer-1", "layer-2"),)
