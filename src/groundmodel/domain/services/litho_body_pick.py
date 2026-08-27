"""Shared ``BodyLayerPick`` dataclass used across the litho-3D builder pipeline.

Each pick is one body member-layer at one investigation.  The builders load
these (``LithoLayerRepository.load_body_picks``) for the geology bounding
transforms (:mod:`litho_geo_bounding`), the voxel builder's honor-borehole
columns, and the geotech subdivision.  Lives in its own module so the
repository and the geo-bounding service can both import it without a cycle.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BodyLayerPick:
    """One member-layer of a body at one investigation.

    Parameters
    ----------
    investigation_id : str
        CPT/borehole id (identity for the (x, y) anchor).
    x_m : float
        World x-coordinate (project CRS).
    y_m : float
        World y-coordinate (project CRS).
    surface_elev_m : float
        Ground/surface elevation at the investigation; depth → elevation
        conversion is ``elevation = surface_elev_m - depth_m``.
    body_id : str
        The body this pick belongs to.
    formation_id : str
        The body's lithology formation.
    top_depth_m : float
        Member layer top depth below ``surface_elev_m``.
    base_depth_m : float
        Member layer base depth below ``surface_elev_m``.
    kind : str, default ``"borehole"``
        The anchor investigation's kind — ``"cpt"`` or ``"borehole"``.  Carried
        so the voxel builder can decide which investigation is honored when two
        of them share one grid column; see ``docs/debt.md`` #241.
    litho_layer_id : str | None, default ``None``
        The accepted ``litho_layer`` id this pick IS (one member-layer = one
        row). The geotech subdivider mints bands BY splitting a pick, so this is
        the covering litho band the band's ``parent_litho_layer_id`` gets
        stamped with — the parent the materialiser already holds, no midpoint
        re-derivation needed. ``None`` for callers/fixtures that never persist
        it (e.g. the geo-bounding transforms, which key on body not layer).
    """

    investigation_id: str
    x_m: float
    y_m: float
    surface_elev_m: float
    body_id: str
    formation_id: str
    top_depth_m: float
    base_depth_m: float
    kind: str = "borehole"
    litho_layer_id: str | None = None
