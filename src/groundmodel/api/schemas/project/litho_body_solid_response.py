"""Pydantic schema: :class:`LithoBodySolidResponse`."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class LithoBodySolidResponse(BaseModel):
    """API representation of a cached watertight 3-D solid per (model, body).

    Analogous to :class:`FormationSurfaceResponse` for the geological TIN
    cache; this schema carries the lithostratigraphic body solid.

    The ``display_color`` field comes from :class:`BodyOrm`, not
    :class:`LithoBodySolidOrm`.  It is joined in by the endpoint and passed
    explicitly — no lazy-load during Pydantic serialisation.

    Attributes
    ----------
    id : UUID
        ``LithoBodySolidOrm`` primary key.
    model_id : UUID
        The lithostratigraphic model this solid belongs to.
    body_id : UUID
        The ``BodyOrm`` row this solid caches.
    formation_id : UUID
        The geological formation (= lithology) the body belongs to.
    body_ordinal : int
        The body's ordinal within its mass unit (one sequence per litho unit, 0-based,
        assigned by ``ResolveLithoInstances``).  Combined with the lithology
        name gives a stable human handle such as "SILT #3".
    method : str
        Triangulation method.  v1 always writes ``"tin"``.
    vertices : list[list[float]]
        3-D vertex positions as ``[[x_m, y_m, z_m], ...]`` in the
        project CRS with the vertical datum's elevation.  Empty list
        for a flagged slab.
    triangles : list[list[int]]
        Triangle index triples ``[[i, j, k], ...]`` into ``vertices``,
        outward-facing normal by right-hand rule.  Empty list for a
        flagged slab.
    is_stale : bool
        ``True`` when a contact mutation has invalidated the cached
        solid since the last ``POST .../litho-solids/build-voxel``.  The
        3-D viewer renders stale solids at reduced opacity.
    is_flagged : bool
        ``True`` when the builder detected a structural anomaly (fewer
        than 3 non-collinear picks, open boundary, non-manifold edge)
        and emitted a best-effort slab.  Displayed as an amber warning
        badge without blocking save/export.
    display_color : str | None
        Per-body display colour override for the 3-D viewer, e.g.
        ``"#aabbcc"``.  ``None`` means "fall back to the formation
        (lithology) colour".  Stored on :class:`BodyOrm`; joined in
        by the endpoint.
    created_at : datetime
        Row creation timestamp.
    updated_at : datetime
        Row last-modified timestamp.
    """

    # The endpoint builds instances manually — it merges display_color from
    # BodyOrm into each solid row rather than serialising the ORM object
    # directly (mirroring the _geo_labels_by_body pattern in the bodies
    # router), so from_attributes is never exercised on the hot path. It is
    # still enabled so a future caller/test can serialise an ORM row directly
    # (display_color would then default to None) without a schema change.
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    body_id: UUID
    formation_id: UUID
    body_ordinal: int
    method: str
    vertices: list[list[float]]
    triangles: list[list[int]]
    is_stale: bool = False
    is_flagged: bool = False
    display_color: str | None = None
    created_at: datetime
    updated_at: datetime
