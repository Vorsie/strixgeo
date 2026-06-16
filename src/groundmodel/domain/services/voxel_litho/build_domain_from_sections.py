"""Build a :class:`ModelDomain` from voxel build-request section partitions.

The voxel labeller (:func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`)
needs a :class:`~groundmodel.domain.services.model_domain.ModelDomain` purely
for its lateral footprint (``domain.polygon`` + ``domain.contains``) — it does
NOT use ``top_at`` / ``deep_base_at`` (the section partitions carry the
elevation envelope directly).  The build-request payload IS the source of truth,
so the domain is synthesised entirely from the sections' column world positions
and region elevations — no database picks are loaded.

This helper is shared by the application use case
(:class:`~groundmodel.application.build_voxel_litho_model.BuildVoxelLithoModel`)
and the read-only eval scripts (``scripts/eval_voxel_label.py`` /
``scripts/eval_voxel_solids.py``); it was promoted from a private
``eval_voxel_label._build_domain`` once it grew a second caller.

Pure domain module — numpy only, no I/O, no logging, no framework imports.
"""

from __future__ import annotations

from groundmodel.domain.services.model_domain import (
    DomainTest,
    ModelDomain,
    build_model_domain,
)
from groundmodel.domain.services.voxel_litho.voxel_types import SectionPartitionInput

__all__ = ["build_domain_from_sections"]


def build_domain_from_sections(sections: list[SectionPartitionInput]) -> ModelDomain:
    """Build a :class:`ModelDomain` from every column's world position.

    Synthesises one :class:`~groundmodel.domain.services.model_domain.DomainTest`
    per unique investigation: the footprint is the alpha hull of all column
    ``(world_x, world_y)`` positions; the vertical extent is the global max
    region top (surface) and min region base across all sections (the columns
    carry no elevation, so the envelope comes from the region polygons).  This
    is the simplest path that frames a grid covering the section data — the
    contract that matters is that the domain footprint gates labelling and the
    grid covers the sections.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The project's cross-sections with their validated 2-D partitions.  Must
        carry ≥3 unique investigation columns spread non-collinearly, or
        ``build_model_domain`` raises (an unbuildable domain — the caller
        handles it gracefully).

    Returns
    -------
    ModelDomain
        The lateral footprint (``contains`` / ``polygon``) framing the labeller.

    Raises
    ------
    ValueError
        Propagated from ``alpha_hull_polygon`` when there are fewer than 3
        unique column positions or they are collinear (no hull).
    """
    # Global elevation envelope from the region polygons (columns carry no
    # elevation — the partition is the only carrier in the voxel payload).
    all_elevs = [p[1] for s in sections for r in s.regions for p in r.polygon]
    surf = max(all_elevs) if all_elevs else 0.0
    base = min(all_elevs) if all_elevs else 0.0

    # One DomainTest per unique investigation, at its column's world position.
    seen: dict[str, tuple[float, float]] = {}
    for s in sections:
        for c in s.columns:
            seen.setdefault(c.investigation_id, (c.world_x, c.world_y))
    tests = [
        DomainTest(test_id=tid, x_m=xy[0], y_m=xy[1], surface_elev_m=surf, base_elev_m=base)
        for tid, xy in seen.items()
    ]
    return build_model_domain(tests)
