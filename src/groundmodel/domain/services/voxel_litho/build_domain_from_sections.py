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


def build_domain_from_sections(
    sections: list[SectionPartitionInput],
    investigation_positions: tuple[tuple[str, float, float], ...] = (),
) -> ModelDomain:
    """Build a :class:`ModelDomain` from the column feet + the drilled positions.

    Synthesises one :class:`~groundmodel.domain.services.model_domain.DomainTest`
    per hull input: the footprint is the alpha hull of all of them; the vertical
    extent is the global max region top (surface) and min region base across all
    sections (the columns carry no elevation, so the envelope comes from the
    region polygons).

    Two DIFFERENT kinds of map position feed the hull, and both are needed:

    * every section column's ``(world_x, world_y)`` — the investigation's
      PROJECTED FOOT on the section fence, which is where the 2-D partition
      geometry lives, and
    * every supplied ``investigation_positions`` entry — the investigation's
      TRUE map position, which is where
      :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`
      honors that investigation's own drilled log.

    On real data the two are metres to tens of metres apart (a borehole feeds a
    section at its projected foot, not where it stands), so a footprint framed
    from the feet ALONE leaves boreholes outside the model they helped build —
    the labeller's ``domain.contains`` gate then skips their grid column
    entirely and the model has no material at all where the ground was drilled.
    Supplying the drilled positions closes that hole; the added ground is filled
    by the labeller's ordinary beyond-rule extrapolation from the nearest
    section, plus the honored log at the investigation's own column.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The project's cross-sections with their validated 2-D partitions.  Must
        carry ≥3 unique investigation columns spread non-collinearly, or
        ``build_model_domain`` raises (an unbuildable domain — the caller
        handles it gracefully).
    investigation_positions : tuple of (str, float, float), optional
        ``(investigation_id, true_x_m, true_y_m)`` for every investigation whose
        own log the build honors.  Defaults to ``()`` — the feet-only footprint,
        byte-identical to the behaviour before this parameter existed.

    Returns
    -------
    ModelDomain
        The lateral footprint (``contains`` / ``polygon``) framing the labeller.

    Raises
    ------
    ValueError
        Propagated from ``alpha_hull_polygon`` when there are fewer than 3
        unique positions or they are collinear (no hull).
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
    # The drilled positions are a SECOND hull input for the same investigations,
    # so they carry a suffixed ``test_id``: ``build_model_domain`` keys its
    # per-test bookkeeping by ``test_id``, and reusing the bare investigation id
    # would make the true position overwrite (or be overwritten by) the
    # projected foot — collapsing the two distinct map points the hull must
    # cover into one.
    for inv_id, x_m, y_m in investigation_positions:
        seen.setdefault(f"{inv_id}#drilled", (x_m, y_m))
    tests = [
        DomainTest(test_id=tid, x_m=xy[0], y_m=xy[1], surface_elev_m=surf, base_elev_m=base)
        for tid, xy in seen.items()
    ]
    return build_model_domain(tests)
