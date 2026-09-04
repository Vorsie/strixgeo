"""The admixture NAD-family answer survives a ``.strix`` round-trip.

Owner ruling 2026-09-04: a litho unit's ``nad_admixture_choice`` (pure vs
with-admixture) is a stored engineering decision, so it must ride into the
bundle and come back verbatim on restore — the "all engineering decisions
persist in the .gmproj bundle" contract. The column is serialised by
``_column_to_json`` and restored by ``_apply_json_to_kwargs`` (both
column-driven), so this pins the free ride rather than a bespoke path.

NOTE (session main): DB-backed integration test — run ONLY via
``.\\scripts\\run-integration-tests.ps1`` (never a bare ``pytest
tests/integration``).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    build_project_bundle,
    restore_project_bundle,
)


async def _restore_bundle(
    db_session: AsyncSession, project_id: object, bundle: dict, *, replace: bool = True
) -> None:
    """Unpack a bundle dict into ``restore_project_bundle``'s positional args."""
    await restore_project_bundle(
        db_session,
        project_id,
        bundle["project"],
        bundle.get("cpts", []),
        bundle.get("boreholes", []),
        bundle.get("geological_formations", []),
        bundle.get("geological_models", []),
        bundle.get("cross_sections", []),
        bundle.get("investigation_reviews", []),
        bodies_payload=bundle.get("bodies", []),
        formation_absences_payload=bundle.get("formation_absences", []),
        litho_contact_correlation_edges_payload=bundle.get("litho_contact_correlation_edges", []),
        body_boundary_shapes_payload=bundle.get("body_boundary_shapes", []),
        body_boundary_nodes_payload=bundle.get("body_boundary_nodes", []),
        replace=replace,
    )
    await db_session.commit()


async def test_nad_admixture_choice_survives_bundle_round_trip(db_session: AsyncSession) -> None:
    """A litho unit answered 'with_admixture' comes back 'with_admixture' after
    build → wipe → restore; an un-answered sibling comes back NULL."""
    project = ProjectOrm(id=uuid7(), name="admixture bundle", status="active")
    db_session.add(project)
    await db_session.flush()
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="G", kind="geological"
    )
    answered = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Antropogeen — silty Zand",
        color="#deb887",
        litho_main_soil_code="ZAND",
        litho_admixtures=[{"soil_code": "KL", "amount": "M", "locally": False}],
        nad_admixture_choice="with_admixture",
    )
    unanswered = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Antropogeen — clean Zand",
        color="#fdcb6e",
        litho_main_soil_code="ZAND",
        litho_admixtures=[],
        nad_admixture_choice=None,
    )
    db_session.add_all([geo_model, answered, unanswered])
    await db_session.commit()

    bundle = await build_project_bundle(db_session, project)
    # The column rides into the serialised formation payload.
    payload = {f["id"]: f for f in bundle["geological_formations"]}
    assert payload[str(answered.id)]["nad_admixture_choice"] == "with_admixture"
    assert payload[str(unanswered.id)]["nad_admixture_choice"] is None

    # Wipe + restore from the bundle alone.
    await _restore_bundle(db_session, project.id, bundle, replace=True)

    rows = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.app_project_id == project.id
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {r.id: r for r in rows}
    assert by_id[answered.id].nad_admixture_choice == "with_admixture"
    assert by_id[unanswered.id].nad_admixture_choice is None
