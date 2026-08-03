"""HTTP contract for the engineer-editable CPT water table + the SBT profile.

Owner ruling (dogfeed 2026-08-03): the assumed water table shown on the
per-CPT plot surface is editable by clicking it. The moment the engineer can
write that number, three things have to hold end-to-end:

1. a depth parsed from the file is labelled ``recorded``;
2. a depth he typed is labelled ``engineer`` and SURVIVES a re-import of the
   same file (engineer judgement outranks a re-parse — the whole Robertson
   normalisation hangs off this number);
3. clearing it puts back whatever was there before he typed — the file's depth
   when the file had one, otherwise ``assumed``, so the strip stops claiming a
   water table nobody recorded;
4. a depth outside the physical range is refused with a message, and the stored
   value is left alone.

Requires Docker DB on localhost:5433 (run via scripts/run-integration-tests.ps1).
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import make_project

# Minimal complete GEF. ``#MEASUREMENTVAR= 14`` is DIEPTE GRONDWATER — the only
# place a water table can enter the app from a file.
_GEF_WITH_WATER = (
    "#PROJECTID= GWT-PROJ\n"
    "#TESTID= CPT-GWT-01\n"
    "#XYID= 32000, 200000.0, 100000.0\n"
    "#ZID= 32001, 5.0\n"
    "#MEASUREMENTVAR= 14, 1.80, m, grondwaterstand\n"
    "#COLUMN= 3\n"
    "#COLUMNINFO= 1, m, depth, 1\n"
    "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
    "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
    "#EOH=\n"
    "0.20; 1.0; 0.05\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n0.80; 8.0; 0.09\n"
)

# Same identity, no water-table header at all — the DOV-shaped case.
_GEF_NO_WATER = _GEF_WITH_WATER.replace("#MEASUREMENTVAR= 14, 1.80, m, grondwaterstand\n", "")


async def _import(client: AsyncClient, project_id: str, gef: str, *, confirm: bool = False):
    """POST one GEF to ``/cpt/import`` and return the raw response."""
    data = {"project_id": project_id}
    if confirm:
        data["confirm_refresh"] = "true"
    return await client.post(
        "/cpt/import",
        files={"file": ("gwt.gef", gef.encode(), "text/plain")},
        data=data,
    )


async def test_a_water_table_from_the_file_is_reported_as_recorded(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """MEASUREMENTVAR 14 lands as ``gef`` and the profile says ``recorded``."""
    project = await make_project(db_session)
    res = await _import(async_client, str(project.id), _GEF_WITH_WATER)
    assert res.status_code == 201
    cpt_id = res.json()["cpt_id"]

    detail = await async_client.get(f"/cpt/{cpt_id}?project_id={project.id}")
    assert detail.status_code == 200
    assert detail.json()["water_depth_m"] == 1.8
    assert detail.json()["water_depth_source"] == "gef"

    profile = await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={project.id}")
    assert profile.status_code == 200
    body = profile.json()
    assert body["gwt_m"] == 1.8
    assert body["gwt_source"] == "recorded"


async def test_a_cpt_without_a_water_table_reports_the_assumption_as_assumed(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Nothing recorded → the project-wide default, labelled honestly."""
    project = await make_project(db_session)
    res = await _import(async_client, str(project.id), _GEF_NO_WATER)
    assert res.status_code == 201
    cpt_id = res.json()["cpt_id"]

    profile = await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={project.id}")
    assert profile.status_code == 200
    assert profile.json()["gwt_source"] == "assumed"


async def test_the_engineers_water_table_survives_a_confirmed_reimport(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """A re-parse must not silently move the water table he set."""
    project = await make_project(db_session)
    cpt_id = (await _import(async_client, str(project.id), _GEF_WITH_WATER)).json()["cpt_id"]

    patched = await async_client.patch(
        f"/cpt/{cpt_id}/water-table?project_id={project.id}",
        json={"water_depth_m": 3.25},
    )
    assert patched.status_code == 200
    assert patched.json()["water_depth_m"] == 3.25
    assert patched.json()["water_depth_source"] == "engineer"

    # Re-import the SAME file, confirmed — the file still says 1.80 m.
    refreshed = await _import(async_client, str(project.id), _GEF_WITH_WATER, confirm=True)
    assert refreshed.status_code == 200
    assert refreshed.json()["refreshed"] is True

    after = await async_client.get(f"/cpt/{cpt_id}?project_id={project.id}")
    assert after.json()["water_depth_m"] == 3.25, "the re-parse clobbered the engineer's value"
    assert after.json()["water_depth_source"] == "engineer"

    profile = await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={project.id}")
    assert profile.json()["gwt_m"] == 3.25
    assert profile.json()["gwt_source"] == "engineer"


async def test_a_file_derived_water_table_IS_refreshed_by_a_reimport(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """The counterpart rule: a value nobody typed is the file's to correct."""
    project = await make_project(db_session)
    cpt_id = (await _import(async_client, str(project.id), _GEF_WITH_WATER)).json()["cpt_id"]

    corrected = _GEF_WITH_WATER.replace("#MEASUREMENTVAR= 14, 1.80,", "#MEASUREMENTVAR= 14, 2.60,")
    refreshed = await _import(async_client, str(project.id), corrected, confirm=True)
    assert refreshed.status_code == 200

    after = await async_client.get(f"/cpt/{cpt_id}?project_id={project.id}")
    assert after.json()["water_depth_m"] == 2.6
    assert after.json()["water_depth_source"] == "gef"


async def test_clearing_the_engineers_value_restores_the_files_water_table(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """The clear affordance's promise: the file's 1.80 m comes back, not the assumption."""
    project = await make_project(db_session)
    cpt_id = (await _import(async_client, str(project.id), _GEF_WITH_WATER)).json()["cpt_id"]

    await async_client.patch(
        f"/cpt/{cpt_id}/water-table?project_id={project.id}", json={"water_depth_m": 2.0}
    )
    cleared = await async_client.patch(
        f"/cpt/{cpt_id}/water-table?project_id={project.id}", json={"water_depth_m": None}
    )
    assert cleared.status_code == 200
    assert cleared.json()["water_depth_m"] == 1.8, "the file's water table was not restored"
    assert cleared.json()["water_depth_source"] == "gef"

    profile = await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={project.id}")
    assert profile.json()["gwt_m"] == 1.8
    assert profile.json()["gwt_source"] == "recorded"


async def test_clearing_a_value_the_file_never_had_returns_the_cpt_to_assumed(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """No snapshot to restore (the DOV-shaped case) → back to "nothing recorded"."""
    project = await make_project(db_session)
    cpt_id = (await _import(async_client, str(project.id), _GEF_NO_WATER)).json()["cpt_id"]

    await async_client.patch(
        f"/cpt/{cpt_id}/water-table?project_id={project.id}", json={"water_depth_m": 2.0}
    )
    cleared = await async_client.patch(
        f"/cpt/{cpt_id}/water-table?project_id={project.id}", json={"water_depth_m": None}
    )
    assert cleared.status_code == 200
    assert cleared.json()["water_depth_m"] is None
    assert cleared.json()["water_depth_source"] is None

    profile = await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={project.id}")
    assert profile.json()["gwt_source"] == "assumed"


async def test_a_second_edit_still_rolls_back_to_the_file_not_to_the_first_edit(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Two corrections in a row must not turn the first typo into "the original"."""
    project = await make_project(db_session)
    cpt_id = (await _import(async_client, str(project.id), _GEF_WITH_WATER)).json()["cpt_id"]

    for depth in (2.0, 4.5):
        await async_client.patch(
            f"/cpt/{cpt_id}/water-table?project_id={project.id}", json={"water_depth_m": depth}
        )
    cleared = await async_client.patch(
        f"/cpt/{cpt_id}/water-table?project_id={project.id}", json={"water_depth_m": None}
    )

    assert cleared.json()["water_depth_m"] == 1.8
    assert cleared.json()["water_depth_source"] == "gef"


async def test_an_out_of_range_depth_is_refused_and_changes_nothing(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """A negative or absurd depth 422s — and the engineer's stored value survives it."""
    project = await make_project(db_session)
    cpt_id = (await _import(async_client, str(project.id), _GEF_WITH_WATER)).json()["cpt_id"]
    await async_client.patch(
        f"/cpt/{cpt_id}/water-table?project_id={project.id}", json={"water_depth_m": 3.0}
    )

    for bad in (-1.0, 501.0):
        refused = await async_client.patch(
            f"/cpt/{cpt_id}/water-table?project_id={project.id}", json={"water_depth_m": bad}
        )
        assert refused.status_code == 422, f"{bad} m was accepted"
        # The body has to SAY something — the inspector toasts the message, so
        # a 422 with no usable detail is a silent failure at the UI boundary.
        assert refused.json()["detail"], f"422 for {bad} m carried no detail"

    after = await async_client.get(f"/cpt/{cpt_id}?project_id={project.id}")
    assert after.json()["water_depth_m"] == 3.0
    assert after.json()["water_depth_source"] == "engineer"


async def test_the_profile_returns_both_classifications_on_one_depth_axis(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Every array is parallel to ``depths_m`` — the UI shares one depth scale."""
    project = await make_project(db_session)
    cpt_id = (await _import(async_client, str(project.id), _GEF_WITH_WATER)).json()["cpt_id"]

    body = (await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={project.id}")).json()

    n = len(body["depths_m"])
    assert n == 4
    for key in ("ic", "zone_normalised", "i_sbt", "zone_non_normalised"):
        assert len(body[key]) == n, f"{key} is not parallel to depths_m"
    # Both classifiers produced SOMETHING — an all-None strip means the driver
    # silently dropped the series rather than classifying it.
    assert any(z is not None for z in body["zone_normalised"])
    assert any(z is not None for z in body["zone_non_normalised"])


async def test_a_cpt_from_another_project_is_not_reachable(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Both new routes carry the by-id project scope guard."""
    owner = await make_project(db_session, name="owner")
    stranger = await make_project(db_session, name="stranger")
    cpt_id = (await _import(async_client, str(owner.id), _GEF_WITH_WATER)).json()["cpt_id"]

    assert (
        await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={stranger.id}")
    ).status_code == 404
    assert (
        await async_client.patch(
            f"/cpt/{cpt_id}/water-table?project_id={stranger.id}",
            json={"water_depth_m": 1.0},
        )
    ).status_code == 404
