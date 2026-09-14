"""Mark a project's built models stale after a bed-override change.

A drawn bed override changes the ground surface inside its polygon (owner ruling
2026-09-06). Three things already read that bed at render / build time:

* the 2-D section fill is clipped along the ground+bed line at once (no rebuild);
* the 3-D fence walls are clipped by the bed at once (no rebuild — the render
  recomputes them from the live overrides);
* but the BUILT 3-D models cache their geometry — the geological model's TIN
  surfaces (clipped to ground at rebuild) and the litho / geotech voxel solids
  (capped at the bed at build) — so a bed drawn / edited / deleted AFTER a Build
  leaves those caches describing the pre-bed ground.

So a bed change flips the cache-staleness flags the on-click Build already uses:
every geological model's surfaces (they clip to the ground+bed line) and every
litho / geotech model's solids (the voxel caps at the bed). The engineer then
sees the amber "rebuild" state and rebuilds to cut the models at the bed — the
same flags a contact edit or a hide already set. Nothing is rebuilt here; a bed
change is cheap and a rebuild is the engineer's deliberate click.

This is the answer to the owner's question (2026-09-13): the fence is cut at
once, but the strat/geo/litho MODELS need a recompute — and now they say so.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.constants.model_kind import (
    MODEL_KIND_GEOLOGICAL,
    NON_STRATIGRAPHIC_KINDS,
)


async def mark_models_stale_for_bed_change(
    session: AsyncSession,
    project_id: UUID,
) -> tuple[int, int]:
    """Stale every built model in a project so a bed change is cut in on rebuild.

    Marks each geological model's TIN surfaces stale and each litho / geotech
    model's voxel solids stale. Idempotent and safe on an unbuilt project (a
    model with no built cache simply flips zero rows).

    Parameters
    ----------
    session : AsyncSession
        Active session; the caller commits.
    project_id : UUID
        The project whose models to invalidate.

    Returns
    -------
    tuple[int, int]
        ``(surfaces_staled, solids_staled)`` — row counts, for logging. Zeros
        when nothing has been built yet (a legal no-op).
    """
    geology = GeologyRepository(session)
    litho = LithoLayerRepository(session)
    models = await geology.list_models(project_id)

    surfaces_staled = 0
    solids_staled = 0
    for model in models:
        if model.kind == MODEL_KIND_GEOLOGICAL:
            # Geological TIN surfaces clip to the ground+bed line at rebuild.
            surfaces_staled += await geology.mark_all_surfaces_stale(model.id)
        elif model.kind in NON_STRATIGRAPHIC_KINDS:
            # Litho / geotech voxel solids cap at the bed level at build.
            solids_staled += await litho.mark_litho_solids_stale(model.id)
    return surfaces_staled, solids_staled
