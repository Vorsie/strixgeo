"""HTTP contract for the raw lab-series import, on the real (anonymised) fixtures.

Owner answers 2026-09-29, in the words they were given:

* Q4 "ask user, to double check, there should be a sample; if no, default
  create one; overlapping depths, yes same sample" — the PREVIEW proposes the
  borehole (name ends with ``<job>-<borehole>``) and the sample (interval
  overlap) and writes nothing; the import attaches to the confirmed sample, or
  creates one with the lab's interval.
* Idempotency (proposal §2.5): the same file again is a no-op with a notice;
  a changed file with the same identity is a CONSENTED refresh (409 with the
  diff, then 200 with the same test id); a file with ERROR findings never
  overwrites stored data (422).
* Q3: the lab's values come back as ``lab_reported`` rows; the owner's
  delta_h / h0 comes back as a ``derived`` channel.

Requires the integration DB (run via scripts/run-integration-tests.ps1).
"""

from __future__ import annotations

from pathlib import Path

from httpx import AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.lab_series_test_orm import LabSeriesTestOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from tests.integration.conftest import make_project

_LAB = Path(__file__).resolve().parents[2] / "fixtures" / "lab"
_OED_0568 = _LAB / "oedometer" / "200568B7-LstSMControleListing.txt"
_TX_CD = _LAB / "triaxial" / "tx_cd.txt"


async def _borehole(session: AsyncSession, project_id, name: str) -> BoreholeOrm:
    """Insert one borehole in the project."""
    bh = BoreholeOrm(
        id=uuid7(),
        name=name,
        app_project_id=project_id,
        project_id="DOV",
        test_id=name,
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=30.0,
    )
    session.add(bh)
    await session.commit()
    return bh


async def _sample(session: AsyncSession, borehole_id, top: float, base: float) -> SampleOrm:
    """Insert one sample on a borehole."""
    s = SampleOrm(
        id=uuid7(), borehole_id=borehole_id, depth_top_m=top, depth_base_m=base, description=""
    )
    session.add(s)
    await session.commit()
    return s


async def _post(client: AsyncClient, route: str, path: Path, data: dict, content=None):
    """POST a lab file (bytes from ``path`` unless ``content`` is given)."""
    body = content if content is not None else path.read_bytes()
    return await client.post(
        f"/lab-series/{route}",
        files={"file": (path.name, body, "text/plain")},
        data={k: str(v) for k, v in data.items()},
    )


async def test_preview_proposes_the_borehole_and_the_overlapping_sample_and_writes_nothing(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """20/0568 (GEO-19/122, B7A, 14,50-15,00): the borehole GEO-19/122-B7A is
    proposed, and its sample at 14,40-14,90 — overlapping — is THE sample."""
    project = await make_project(db_session)
    bh = await _borehole(db_session, project.id, "GEO-19/122-B7A")
    await _borehole(db_session, project.id, "GEO-19/122-B8A")
    sample = await _sample(db_session, bh.id, 14.4, 14.9)

    r = await _post(async_client, "preview", _OED_0568, {"project_id": project.id})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "oedometer"
    assert body["identity"]["sample_number"] == "20/0568"
    assert body["borehole_match"] == "unique"
    assert body["proposed_borehole_id"] == str(bh.id)
    assert body["sample_match"] == "overlap"
    assert body["proposed_sample_id"] == str(sample.id)
    assert body["existing_test"] is None
    assert "SETTLEMENT_STEPS_BACK" in {i["code"] for i in body["issues"]}
    count = await db_session.scalar(select(func.count()).select_from(LabSeriesTestOrm))
    assert count == 0


async def test_import_attaches_to_the_confirmed_sample_and_serves_every_reading(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Import on the matched sample → 201; GET /samples/{id}/lab-series returns
    16 stages, every reading, the derived strain and the lab-reported rows."""
    project = await make_project(db_session)
    bh = await _borehole(db_session, project.id, "GEO-19/122-B7A")
    sample = await _sample(db_session, bh.id, 14.4, 14.9)

    r = await _post(
        async_client,
        "import",
        _OED_0568,
        {"project_id": project.id, "borehole_id": bh.id, "sample_id": sample.id},
    )
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["sample_id"] == str(sample.id) and out["created_sample"] is False

    g = await async_client.get(
        f"/samples/{sample.id}/lab-series", params={"project_id": project.id}
    )
    assert g.status_code == 200, g.text
    [test] = g.json()
    assert test["id"] == out["test_id"]
    [specimen] = test["specimens"]
    assert len(specimen["stages"]) == 16
    assert sum(s["n_readings"] for s in specimen["stages"]) == 800
    stage1 = {c["channel_key"]: c for c in specimen["stages"][0]["channels"]}
    assert len(stage1["settlement_mm"]["values"]) == 50
    strain = stage1["vertical_strain"]
    assert strain["provenance"] == "derived" and strain["formula"] == "epsilon_v = delta_h / h0"
    assert strain["values"][0] == 0.0
    assert {r["provenance"] for r in test["lab_results"]} == {"lab_reported"}

    listing = await async_client.get(
        "/lab-series", params={"project_id": project.id, "borehole_id": bh.id}
    )
    assert listing.status_code == 200, listing.text
    [summary] = listing.json()
    assert summary["kind"] == "oedometer" and summary["n_readings"] == 800


async def test_no_overlapping_sample_means_the_import_creates_one(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """tx_cd (GEO-25/022, B17, 5,00-5,50) on a borehole with no sample there:
    the preview says "none", and create_sample makes one with the lab's
    interval and sample number."""
    project = await make_project(db_session)
    bh = await _borehole(db_session, project.id, "GEO-25/022-B17")
    await _sample(db_session, bh.id, 1.0, 1.5)

    p = await _post(async_client, "preview", _TX_CD, {"project_id": project.id})
    assert p.status_code == 200, p.text
    assert p.json()["sample_match"] == "none"
    assert p.json()["create_sample_default"]["depth_top_m"] == 5.0

    r = await _post(
        async_client,
        "import",
        _TX_CD,
        {"project_id": project.id, "borehole_id": bh.id, "create_sample": "true"},
    )
    assert r.status_code == 201, r.text
    created = await db_session.get(SampleOrm, r.json()["sample_id"])
    assert r.json()["created_sample"] is True
    assert (created.depth_top_m, created.depth_base_m) == (5.0, 5.5)
    assert created.sample_number == "25/0389"


async def test_reimporting_the_same_file_is_a_no_op_with_a_notice(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Same identity, same bytes → 200 ``unchanged`` and still ONE test."""
    project = await make_project(db_session)
    bh = await _borehole(db_session, project.id, "GEO-25/022-B17")
    data = {"project_id": project.id, "borehole_id": bh.id, "create_sample": "true"}
    first = await _post(async_client, "import", _TX_CD, data)
    assert first.status_code == 201, first.text

    again = await _post(async_client, "import", _TX_CD, data)
    assert again.status_code == 200, again.text
    assert again.json()["unchanged"] is True
    assert again.json()["test_id"] == first.json()["test_id"]
    count = await db_session.scalar(select(func.count()).select_from(LabSeriesTestOrm))
    assert count == 1


async def test_a_changed_file_asks_before_it_replaces_and_keeps_the_test_id(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Same identity, different bytes → 409 with the diff and nothing written;
    with confirm_refresh → 200, refreshed, SAME test id, new readings."""
    project = await make_project(db_session)
    bh = await _borehole(db_session, project.id, "GEO-25/022-B17")
    data = {"project_id": project.id, "borehole_id": bh.id, "create_sample": "true"}
    first = await _post(async_client, "import", _TX_CD, data)
    assert first.status_code == 201, first.text

    lines = _TX_CD.read_bytes().split(b"\n")
    table = next(i for i, ln in enumerate(lines) if ln.startswith(b"Meetpunt"))
    del lines[table + 5]  # one point fewer on specimen a
    changed = b"\n".join(lines)

    ask = await _post(async_client, "import", _TX_CD, data, content=changed)
    assert ask.status_code == 409, ask.text
    detail = ask.json()["detail"]
    assert detail["code"] == "lab_series_refresh_confirmation_required"
    assert detail["test_id"] == first.json()["test_id"]
    assert detail["old_n_readings"] == 1130 + 1139 + 1133
    assert detail["new_n_readings"] == 1130 + 1139 + 1133 - 1

    ok = await _post(async_client, "import", _TX_CD, {**data, "confirm_refresh": "true"}, changed)
    assert ok.status_code == 200, ok.text
    assert ok.json()["refreshed"] is True
    assert ok.json()["test_id"] == first.json()["test_id"]
    count = await db_session.scalar(select(func.count()).select_from(LabSeriesTestOrm))
    assert count == 1


async def test_a_file_with_error_findings_never_overwrites_stored_data(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """A refresh whose parse carries an ERROR (an unreadable cell) is refused
    422 even when confirmed."""
    project = await make_project(db_session)
    bh = await _borehole(db_session, project.id, "GEO-25/022-B17")
    data = {"project_id": project.id, "borehole_id": bh.id, "create_sample": "true"}
    assert (await _post(async_client, "import", _TX_CD, data)).status_code == 201

    lines = _TX_CD.read_bytes().split(b"\n")
    row = next(i for i, ln in enumerate(lines) if ln.startswith(b"Meetpunt")) + 3
    lines[row] = lines[row][:18] + b"garbage".ljust(18) + lines[row][36:]
    broken = b"\n".join(lines)
    r = await _post(async_client, "import", _TX_CD, {**data, "confirm_refresh": "true"}, broken)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "lab_series_refresh_refused"


async def test_a_sample_on_another_project_is_refused(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Scope guard: a borehole of another project answers 404, nothing written."""
    project = await make_project(db_session)
    other = await make_project(db_session, name="Other")
    foreign = await _borehole(db_session, other.id, "GEO-25/022-B17")
    r = await _post(
        async_client,
        "import",
        _TX_CD,
        {"project_id": project.id, "borehole_id": foreign.id, "create_sample": "true"},
    )
    assert r.status_code == 404, r.text


async def test_an_unknown_file_is_refused_400(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """A text that is none of the raw exports → 400."""
    project = await make_project(db_session)
    r = await _post(async_client, "preview", _TX_CD, {"project_id": project.id}, content=b"hello\n")
    assert r.status_code == 400, r.text


async def test_the_lab_series_tree_round_trips_through_the_bundle(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Backwards-compat (additive, no version bump): GET /bundle carries the
    sample's ``lab_series_tests``; a cold restore brings back the same test id
    with every reading, the re-zero marks and the derived strain."""
    project = await make_project(db_session)
    bh = await _borehole(db_session, project.id, "GEO-19/122-B7A")
    oed_0569 = _LAB / "oedometer" / "200569B7-LstSMControleListing.txt"
    r = await _post(
        async_client,
        "import",
        oed_0569,
        {"project_id": project.id, "borehole_id": bh.id, "create_sample": "true"},
    )
    assert r.status_code == 201, r.text
    sample_id = r.json()["sample_id"]
    before = await async_client.get(
        f"/samples/{sample_id}/lab-series", params={"project_id": project.id}
    )
    assert before.status_code == 200, before.text

    bundle_resp = await async_client.get(f"/projects/{project.id}/bundle")
    assert bundle_resp.status_code == 200, bundle_resp.text
    bundle = bundle_resp.json()
    [bh_payload] = bundle["boreholes"]
    [sample_payload] = bh_payload["samples"]
    assert len(sample_payload["lab_series_tests"]) == 1

    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.id == bh.id))
    await db_session.execute(delete(ProjectOrm).where(ProjectOrm.id == project.id))
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(LabSeriesTestOrm)) == 0

    restore = await async_client.post(f"/projects/{project.id}/restore", json=bundle)
    assert restore.status_code == 200, restore.text
    after = await async_client.get(
        f"/samples/{sample_id}/lab-series", params={"project_id": project.id}
    )
    assert after.status_code == 200, after.text
    assert after.json() == before.json()
