"""Translate geometric layer-connectivity groups into layer-pair facts.

The recompute's union evidence arrives entirely in LAYER-id space (owner
ruling 2026-08-12, hardened the same evening): per-section groups from the
frontend's fill adjacency, and cross-section groups from
``plan_layer_groups`` (shared columns + fence crossings). Layer ids never
change, so the same geometry always plans the same facts and the recompute is
idempotent by construction.

The first wire design used BODY ids and oscillated in production within
minutes: once a recompute merged two bodies, the refetched regions all carried
the merged id, the next payload's body evidence collapsed to singletons, the
wholesale replace erased the facts that held the merge, and the bodies split
again — facts flapping 74 → 3 → 69 on the dev model. Evidence must never be
expressed in the labels the recompute itself rewrites.

Facts are ALL pairs of each final component, never a star anchored on one
layer: with a star, one dead anchor shatters the whole component; with all
pairs, a lost layer only detaches itself.

Pure domain module — no I/O, no framework imports.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

__all__ = ["FactTranslationResult", "plan_geometry_facts"]


@dataclass(frozen=True)
class FactTranslationResult:
    """The planned facts.

    Attributes
    ----------
    facts : tuple[tuple[str, str], ...]
        Layer-id pairs, each canonically ordered (a < b), deduplicated,
        sorted for determinism.
    """

    facts: tuple[tuple[str, str], ...]


def plan_geometry_facts(
    *,
    section_layer_groups: Sequence[Sequence[Sequence[str]]],
    cross_section_layer_groups: Iterable[Iterable[str]] = (),
) -> FactTranslationResult:
    """Union the layer groups, then emit all-pairs facts per component.

    Parameters
    ----------
    section_layer_groups : Sequence[Sequence[Sequence[str]]]
        Per section, the frontend's connectivity groups: each group lists the
        LAYER ids whose fill regions form one touching component on that
        section (fallback regions excluded at the source).
    cross_section_layer_groups : Iterable[Iterable[str]]
        Groups from :func:`plan_layer_groups` — layers whose regions meet at
        shared columns or fence crossings.

    Returns
    -------
    FactTranslationResult
        Canonical layer-pair facts.
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

    for groups in section_layer_groups:
        for group in groups:
            for other in group[1:]:
                union(group[0], other)
    for cross_group in cross_section_layer_groups:
        members = list(cross_group)
        for other in members[1:]:
            union(members[0], other)

    components: dict[str, list[str]] = {}
    for layer_id in parent:
        components.setdefault(find(layer_id), []).append(layer_id)

    facts: set[tuple[str, str]] = set()
    for members in components.values():
        if len(members) < 2:
            continue
        ordered = sorted(members)
        for i, layer_a in enumerate(ordered):
            for layer_b in ordered[i + 1 :]:
                facts.add((layer_a, layer_b))

    return FactTranslationResult(facts=tuple(sorted(facts)))
