"""Translate merged body components into layer-pair geometry facts.

The recompute pipeline (owner ruling 2026-08-12) works in two id spaces:

* The union evidence arrives in BODY-id space — per-section merge groups from
  the frontend's ``mergeTouchingBodies`` and the cross-section alias map from
  ``plan_body_aliases`` (shared columns + fence crossings).
* The persisted facts live in LAYER-id space, because layer ids are stable:
  the resolver restamps ``body_id`` on every run, so a fact keyed on body ids
  would be orphaned by the very recompute that wrote it. The frontend supplies
  ``body_members`` from the SAME snapshot that produced its regions, keeping
  the payload internally consistent whatever the database does meanwhile.

Facts are ALL pairs of each final component, never a star anchored on one
body: with a star, one dead anchor layer shatters the whole component; with
all pairs, a lost body only detaches itself. Wrong-after-a-split facts live at
most until the next recompute, which replaces a model's facts wholesale.

Pure domain module — no I/O, no framework imports.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

__all__ = ["FactTranslationResult", "plan_geometry_facts"]


@dataclass(frozen=True)
class FactTranslationResult:
    """The planned facts plus what could not be translated.

    Attributes
    ----------
    facts : tuple[tuple[str, str], ...]
        Layer-id pairs, each canonically ordered (a < b), deduplicated,
        sorted for determinism.
    unresolved_body_ids : tuple[str, ...]
        Body ids named by the evidence but absent from ``body_members`` (or
        with no member layers) — their adjacency is dropped and the caller
        must say so, because a silent drop reads as "not connected".
    """

    facts: tuple[tuple[str, str], ...]
    unresolved_body_ids: tuple[str, ...]


def plan_geometry_facts(
    *,
    section_body_groups: Sequence[Sequence[Sequence[str]]],
    cross_section_aliases: Mapping[str, str],
    body_members: Mapping[str, Sequence[str]],
) -> FactTranslationResult:
    """Union the evidence, then emit all-pairs layer facts per component.

    Parameters
    ----------
    section_body_groups : Sequence[Sequence[Sequence[str]]]
        Per section, the frontend's merge groups: each group lists the
        ORIGINAL (pre-merge) body ids found connected on that section.
    cross_section_aliases : Mapping[str, str]
        ``plan_body_aliases`` output — ``body_id -> representative``; identity
        entries allowed and ignored.
    body_members : Mapping[str, Sequence[str]]
        Body id → member layer ids, from the frontend's own layer snapshot.

    Returns
    -------
    FactTranslationResult
        Canonical layer-pair facts + the body ids that could not anchor one.
    """
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    for groups in section_body_groups:
        for group in groups:
            for other in group[1:]:
                union(group[0], other)
    for src, rep in cross_section_aliases.items():
        union(src, rep)

    components: dict[str, list[str]] = {}
    for body_id in parent:
        components.setdefault(find(body_id), []).append(body_id)

    # Representative layer per body: the lexicographic-min member, so the same
    # payload always plans the same facts (determinism is what makes the
    # full-replace idempotent).
    unresolved: set[str] = set()

    def rep_layer(body_id: str) -> str | None:
        members = body_members.get(body_id)
        if not members:
            unresolved.add(body_id)
            return None
        return min(members)

    facts: set[tuple[str, str]] = set()
    for members_of_component in components.values():
        if len(members_of_component) < 2:
            continue
        reps = sorted(r for r in (rep_layer(b) for b in members_of_component) if r is not None)
        for i, layer_a in enumerate(reps):
            for layer_b in reps[i + 1 :]:
                if layer_a != layer_b:
                    facts.add((layer_a, layer_b))

    return FactTranslationResult(
        facts=tuple(sorted(facts)),
        unresolved_body_ids=tuple(sorted(unresolved)),
    )
