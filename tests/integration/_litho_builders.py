"""Shared unsaved-ORM builders for litho / body integration tests.

``geo_model``, ``litho_model`` and ``contact`` were redefined verbatim across
~12 litho/body integration test files, differing only by a ``name=`` literal
(the model builders) and the ``source=`` of the contact (debt #199). This
module is the single source of truth so a future schema change edits one
copy, not twelve.
"""

from __future__ import annotations

from uuid import UUID

from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


def geo_model(project: ProjectOrm, *, name: str = "Geo") -> GeologicalModelOrm:
    """Return an unsaved geological ``GeologicalModelOrm`` for *project*.

    Parameters
    ----------
    project : ProjectOrm
        The owning project; supplies ``app_project_id``.
    name : str, optional
        Model name. Defaults to ``"Geo"``; no test asserts on it, so the
        per-file labels the copies used were cosmetic.

    Returns
    -------
    GeologicalModelOrm
        Unsaved row with a fresh uuid7 id and ``kind='geological'``.
    """
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        kind="geological",
    )


def litho_model(
    project: ProjectOrm, geo: GeologicalModelOrm, *, name: str = "Litho"
) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic ``GeologicalModelOrm``.

    Parameters
    ----------
    project : ProjectOrm
        The owning project; supplies ``app_project_id``.
    geo : GeologicalModelOrm
        The mandatory geological parent; supplies ``parent_model_id``.
    name : str, optional
        Model name. Defaults to ``"Litho"``.

    Returns
    -------
    GeologicalModelOrm
        Unsaved row with ``kind='lithostratigraphic'`` parented to *geo*.
    """
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )


def contact(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    depth: float,
    source: str = "borehole_observation",
    confidence: str = "medium",
) -> FormationContactOrm:
    """Return an unsaved ``FormationContactOrm`` anchored to *borehole*.

    Parameters
    ----------
    model : GeologicalModelOrm
        The owning model; supplies ``model_id``.
    formation : GeologicalFormationOrm
        The formation this contact belongs to; supplies ``formation_id``.
    borehole : BoreholeOrm
        The anchoring investigation; supplies ``borehole_id``.
    depth : float
        ``depth_top_m`` of the contact.
    source : str, optional
        Provenance token. Defaults to ``"borehole_observation"``; the
        cross-merge fixtures use ``"manual_pick"``.
    confidence : str, optional
        Confidence token. Defaults to ``"medium"``.

    Returns
    -------
    FormationContactOrm
        Unsaved row with a fresh uuid7 id.
    """
    return FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=depth,
        source=source,
        confidence=confidence,
    )


def geometry_fact(*, model_id: UUID, layer_x: UUID, layer_y: UUID) -> BodyGeometryFactOrm:
    """Build the geometry fact the renderer posts for a painted mass.

    Owner 2026-10-04, *"identity follows the drawing"*: only a geometry fact
    unions two layers into one body; an accepted tie alone joins nothing. A
    scene whose tie the fill WOULD paint as a band (2 ties, or a band the test
    wants as one body) therefore seeds this row beside the tie, standing in for
    the frontend's ``bodies/recompute``.

    ``body_geometry_fact`` enforces ``layer_a_id < layer_b_id`` (CHECK), so the
    endpoints are sorted here.

    Parameters
    ----------
    model_id : UUID
        The litho or geotech model the fact belongs to.
    layer_x, layer_y : UUID
        The two ``litho_layer`` endpoints (any order).

    Returns
    -------
    BodyGeometryFactOrm
        Unsaved row with a fresh uuid7 id.
    """
    a_id, b_id = sorted((layer_x, layer_y), key=str)
    return BodyGeometryFactOrm(id=uuid7(), model_id=model_id, layer_a_id=a_id, layer_b_id=b_id)
