"""Scene helpers shared by the geotech integration tests.

Three test modules now build the same little world — a CPT or two, a borehole
between them, one accepted ZAND layer per column and correlations joining them —
so the builders live here rather than being copied a third time (CLAUDE.md:
extract on the second copy; the counterweight expired when the third caller
arrived).

Everything here talks to the API the way the desktop does, so a scene built with
these helpers is a scene the product can actually produce — except
``paint_band``, which stands in for the renderer's ``bodies/recompute`` (the
section fill is client-side TypeScript, so a Python scene seeds its result).
"""

from __future__ import annotations

from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from tests.integration._litho_builders import geometry_fact


def two_layer_qc(
    n_top: int, n_bot: int, qc_top: float, qc_bot: float
) -> tuple[list[float], list[float]]:
    """Return ``(depths_m, qc_mpa)`` with a distinct top and bottom packing zone.

    Parameters
    ----------
    n_top : int
        Number of samples in the upper zone.
    n_bot : int
        Number of samples in the lower zone.
    qc_top : float
        Cone resistance for the top zone (MPa).
    qc_bot : float
        Cone resistance for the bottom zone (MPa).

    Returns
    -------
    tuple[list[float], list[float]]
        Concatenated ``(depths_m, qc_mpa)`` lists on a 2 cm sampling interval.
    """
    n = n_top + n_bot
    depths = [round(i * 0.02, 3) for i in range(n)]
    qc = [qc_top] * n_top + [qc_bot] * n_bot
    return depths, qc


async def accept_cpt_litho(
    client: AsyncClient,
    project_id: str,
    litho_model_id: str,
    *,
    cpt_id: str,
    top: float,
    base: float,
    soil: str = "ZAND",
) -> str:
    """Accept one litho suggestion on a CPT and return the created contact id.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    cpt_id : str
        CPT id.
    top : float
        Top depth (m).
    base : float
        Base depth (m).
    soil : str, optional
        Main soil code; defaults to ``"ZAND"``.

    Returns
    -------
    str
        The created formation-contact id.
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
        json={
            "cpt_id": cpt_id,
            "suggestions": [
                {
                    "depth_top_m": top,
                    "depth_base_m": base,
                    "suggested_lithology": soil,
                    "confidence": "high",
                    "source": "robertson_2015",
                    "suggested_admixtures": [],
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    contacts = resp.json()["created_contact_ids"]
    assert len(contacts) >= 1
    return str(contacts[0])


async def accept_borehole_litho(
    client: AsyncClient,
    project_id: str,
    litho_model_id: str,
    *,
    borehole_id: str,
    top: float,
    base: float,
    soil: str = "ZAND",
) -> str:
    """Accept one litho suggestion on a borehole and return the created contact id.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    borehole_id : str
        Borehole id.
    top : float
        Top depth (m).
    base : float
        Base depth (m).
    soil : str, optional
        Main soil code; defaults to ``"ZAND"``.

    Returns
    -------
    str
        The created formation-contact id.
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
        json={
            "borehole_id": borehole_id,
            "suggestions": [
                {
                    "depth_top_m": top,
                    "depth_base_m": base,
                    "suggested_lithology": soil,
                    "confidence": "high",
                    "source": "borehole_observation",
                    "suggested_admixtures": [],
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    contacts = resp.json()["created_contact_ids"]
    assert len(contacts) >= 1
    return str(contacts[0])


async def correlate(
    client: AsyncClient,
    project_id: str,
    litho_model_id: str,
    *,
    contact_a: str,
    contact_b: str,
    section_id: str,
) -> None:
    """POST a litho correlation edge between two accepted contacts.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    contact_a : str
        First contact id.
    contact_b : str
        Second contact id.
    section_id : str
        Section the edge is authored on.
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/contact-correlations",
        json={
            "layer_a_id": contact_a,
            "layer_b_id": contact_b,
            "request_section_id": section_id,
        },
    )
    assert resp.status_code in (200, 201), resp.text


async def paint_band(
    session: AsyncSession,
    model_id: str | UUID,
    *pairs: tuple[str | UUID, str | UUID],
) -> None:
    """Record that the section fill painted each layer pair as ONE mass, then resolve.

    Owner 2026-10-04, *"identity follows the drawing"*: a tie alone joins no
    bodies; the renderer posts a geometry fact for every mass the fill paints and
    only those facts union. In the app a tie between two same-unit bands that the
    fill draws as a band (the ordinary case: 2 ties, or 1 tie whose two onlaps
    meet) yields that fact at the next ``bodies/recompute``. A Python scene cannot
    run the client-side fill, so it seeds the fact here and re-runs the resolver,
    exactly as the recompute endpoint would.

    Parameters
    ----------
    session : AsyncSession
        The test session; committed by the resolver run.
    model_id : str | UUID
        The litho or geotech model the layers belong to.
    *pairs : tuple[str | UUID, str | UUID]
        The layer-id pairs the fill painted as one mass.
    """
    mid = UUID(str(model_id))
    await _add_facts_and_resolve(session, mid, [(UUID(str(a)), UUID(str(b))) for a, b in pairs])


async def paint_accepted_ties(session: AsyncSession, model_id: str | UUID) -> int:
    """Record that the fill painted EVERY accepted tie of a model, then resolve.

    The ordinary case in the app: a same-unit tie the fill draws as a band (2 ties,
    or 1 tie whose two onlaps meet at the halfway point) yields a geometry fact at
    the next ``bodies/recompute``. A scene written before 2026-10-04 (when a tie
    still unioned by itself) calls this where it relied on that, so its bodies are
    the ones the drawing makes. Cross-unit ties get a fact too; the resolver's
    one-unit filter drops it, as it drops the renderer's.

    Parameters
    ----------
    session : AsyncSession
        The test session; committed by the resolver run.
    model_id : str | UUID
        The litho or geotech model.

    Returns
    -------
    int
        The number of facts added (pairs already painted are skipped).
    """
    mid = UUID(str(model_id))
    ties = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == mid,
                LithoContactCorrelationEdgeOrm.user_approved.is_(True),
            )
        )
    ).all()
    return await _add_facts_and_resolve(session, mid, [(a, b) for a, b in ties])


async def _add_facts_and_resolve(
    session: AsyncSession, model_id: UUID, pairs: list[tuple[UUID, UUID]]
) -> int:
    """Insert the not-yet-recorded facts for ``pairs``, commit, resolve the model."""
    existing = {
        (a, b)
        for a, b in (
            await session.execute(
                select(BodyGeometryFactOrm.layer_a_id, BodyGeometryFactOrm.layer_b_id).where(
                    BodyGeometryFactOrm.model_id == model_id
                )
            )
        ).all()
    }
    added = 0
    for x, y in pairs:
        fact = geometry_fact(model_id=model_id, layer_x=x, layer_y=y)
        key = (fact.layer_a_id, fact.layer_b_id)
        if key in existing:
            continue
        existing.add(key)
        session.add(fact)
        added += 1
    await session.commit()
    await ResolveLithoInstances(session).execute(model_id=model_id, commit=True)
    return added
