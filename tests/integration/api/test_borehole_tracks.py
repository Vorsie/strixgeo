"""Add or change any borehole track by hand (owner 2026-09-29).

The owner's words: "can i manually add tracks?" -> "i want to add columns on the
borehole itself" -> "i want to be able to add or change any track". The session
main's rules these tests pin:

* a track created by hand carries ``source = "manual"``; an imported track that
  is edited keeps its DOV origin (``dov_permkey``) and gets
  ``edited_manually_at``;
* a whole track can be deleted;
* intervals: top < base, no overlap within one track (block), gaps and depths
  below the total depth warn but save, 422 carries the dotted key path;
* the sections draw ONE track per kind: the manual one wins, else the newest
  edited, else today's rule;
* the provenance rides the ``.strix`` bundle, and an older bundle without it
  restores as untouched DOV data.

Re-import: a DOV bbox re-import never touches a held borehole's tracks (an
edited track keeps its edits, a deleted one stays deleted) - pinned in
``test_borehole_track_dov_reimport.py``.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    build_project_bundle,
    restore_project_bundle,
)
from groundmodel.shared.config import settings


@pytest_asyncio.fixture
async def dov_borehole(db_session: AsyncSession) -> dict:
    """A project with one DOV-imported borehole: a coded track and a colour field log."""
    project = ProjectOrm(id=uuid7(), name="Tracks", status="active")
    db_session.add(project)
    other = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(other)
    await db_session.flush()

    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-T",
        app_project_id=project.id,
        project_id="DOV",
        test_id="kb1d1w-B1",
        location_x=150_000.0,
        location_y=200_000.0,
        epsg=31370,
        total_depth_m=5.0,
        n_field_log_intervals=2,
    )
    coded = ObservationOrm(
        id=uuid7(),
        observation_type="coded_lithology",
        dov_permkey="1990-000123",
        observation_date=date(1990, 5, 1),
    )
    layer = ObservationLayerOrm(
        id=uuid7(), top_m=0.0, base_m=2.0, layer_index=0, main_soil_codes=["FZ"]
    )
    layer.admixtures = [AdmixtureOrm(id=uuid7(), soil_code="KL", amount="W", locally=False)]
    coded.layers = [
        layer,
        ObservationLayerOrm(
            id=uuid7(), top_m=2.0, base_m=5.0, layer_index=1, main_soil_codes=["KL"]
        ),
    ]
    borehole.observations = [coded]
    borehole.field_log_intervals = [
        FieldLogIntervalOrm(id=uuid7(), top_m=0.0, base_m=1.5, kind="color", value="groenbruin"),
        FieldLogIntervalOrm(id=uuid7(), top_m=1.5, base_m=5.0, kind="color", value="grijs"),
    ]
    db_session.add(borehole)
    await db_session.commit()
    return {
        "project": project,
        "other": other,
        "borehole": borehole,
        "coded_id": coded.id,
    }


def _url(scene: dict, suffix: str = "", project=None) -> str:
    """Build a track route URL for the scene's borehole."""
    pid = (project or scene["project"]).id
    return f"/borehole/{scene['borehole'].id}/tracks{suffix}?project_id={pid}"


async def _detail(client: AsyncClient, scene: dict) -> dict:
    """GET the borehole detail the desktop reads."""
    resp = await client.get(
        f"/borehole/{scene['borehole'].id}?project_id={scene['project'].id}&include="
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_a_track_added_by_hand_is_stored_as_manual(
    async_client: AsyncClient, dov_borehole: dict
) -> None:
    """Add a formal-stratigraphy track: stored, source manual, depth-ordered, on the grain."""
    resp = await async_client.post(
        _url(dov_borehole),
        json={
            "kind": "formal_stratigraphy",
            "intervals": [
                {"top_m": 1.23449, "base_m": 5.0, "description": "Bm"},
                {"top_m": 0.0, "base_m": 1.23449, "description": "Q"},
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["source"] == "manual"
    assert body["family"] == "observation"
    assert body["edited_manually_at"] is not None
    assert body["dov_permkey"] is None
    assert [(i["top_m"], i["base_m"], i["description"]) for i in body["intervals"]] == [
        (0.0, 1.234, "Q"),
        (1.234, 5.0, "Bm"),
    ]

    detail = await _detail(async_client, dov_borehole)
    added = [o for o in detail["observations"] if o["observation_type"] == "formal_stratigraphy"]
    assert len(added) == 1
    assert added[0]["source"] == "manual"
    assert [layer["description"] for layer in added[0]["layers"]] == ["Q", "Bm"]


async def test_editing_an_imported_track_keeps_its_dov_origin_and_marks_it_edited(
    async_client: AsyncClient, dov_borehole: dict, db_session: AsyncSession
) -> None:
    """The owner corrects DOV's coded lithology: still dov, still its permkey, now edited."""
    resp = await async_client.put(
        _url(dov_borehole, f"/{dov_borehole['coded_id']}"),
        json={
            "intervals": [
                {
                    "top_m": 0.0,
                    "base_m": 2.5,
                    "main_soil_codes": ["FZ"],
                    "admixtures": [{"soil_code": "GL", "amount": "M", "locally": True}],
                },
                {"top_m": 2.5, "base_m": 5.0, "main_soil_codes": ["KL"]},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "dov"
    assert body["dov_permkey"] == "1990-000123"
    assert body["edited_manually_at"] is not None

    db_session.expunge_all()
    obs = (
        await db_session.execute(
            select(ObservationOrm)
            .where(ObservationOrm.id == dov_borehole["coded_id"])
            .options(
                selectinload(ObservationOrm.layers).selectinload(ObservationLayerOrm.admixtures)
            )
        )
    ).scalar_one()
    assert obs.source == "dov"
    assert obs.edited_manually_at is not None
    assert [(la.top_m, la.base_m, la.layer_index) for la in obs.layers] == [
        (0.0, 2.5, 0),
        (2.5, 5.0, 1),
    ]
    assert [(a.soil_code, a.amount, a.locally) for a in obs.layers[0].admixtures] == [
        ("GL", "M", True)
    ]


async def test_editing_an_imported_field_log_track_keeps_it_dov_and_edited(
    async_client: AsyncClient, dov_borehole: dict, db_session: AsyncSession
) -> None:
    """The colour field log is one track per kind; its id is ``field_log:color``."""
    resp = await async_client.put(
        _url(dov_borehole, "/field_log:color"),
        json={
            "intervals": [
                {"top_m": 0.0, "base_m": 1.0, "value": "bruin"},
                {"top_m": 1.0, "base_m": 5.0, "value": "grijs"},
                {"top_m": 5.0, "base_m": 5.5, "value": "groengrijs"},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["track_id"] == "field_log:color"
    assert body["source"] == "dov"
    assert body["edited_manually_at"] is not None
    # Deeper than the drilled 5.0 m: saved, with a warning.
    assert [w["code"] for w in body["warnings"]] == ["below_total_depth"]

    db_session.expunge_all()
    bh = await db_session.get(BoreholeOrm, dov_borehole["borehole"].id)
    assert bh is not None
    assert bh.n_field_log_intervals == 3
    rows = (
        (
            await db_session.execute(
                select(FieldLogIntervalOrm)
                .where(FieldLogIntervalOrm.borehole_id == bh.id)
                .order_by(FieldLogIntervalOrm.top_m)
            )
        )
        .scalars()
        .all()
    )
    assert [(r.value, r.source) for r in rows] == [
        ("bruin", "dov"),
        ("grijs", "dov"),
        ("groengrijs", "dov"),
    ]


async def test_a_manual_field_log_track_of_a_new_kind_and_a_duplicate_kind(
    async_client: AsyncClient, dov_borehole: dict
) -> None:
    """A consistency track is new -> 201; a second colour track -> 409, edit the first."""
    ok = await async_client.post(
        _url(dov_borehole),
        json={"kind": "consistency", "intervals": [{"top_m": 2.0, "base_m": 3.0, "value": "vast"}]},
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["track_id"] == "field_log:consistency"
    assert ok.json()["source"] == "manual"

    dup = await async_client.post(
        _url(dov_borehole),
        json={"kind": "color", "intervals": [{"top_m": 0.0, "base_m": 1.0, "value": "wit"}]},
    )
    assert dup.status_code == 409, dup.text
    assert dup.json()["detail"]["code"] == "borehole_track_exists"
    assert dup.json()["detail"]["track_id"] == "field_log:color"


async def test_overlapping_intervals_are_refused_with_the_dotted_key_path(
    async_client: AsyncClient, dov_borehole: dict, db_session: AsyncSession
) -> None:
    """No overlap within one track: 422, nothing written, the offending cell named."""
    resp = await async_client.put(
        _url(dov_borehole, f"/{dov_borehole['coded_id']}"),
        json={
            "intervals": [
                {"top_m": 0.0, "base_m": 2.5, "main_soil_codes": ["FZ"]},
                {"top_m": 2.0, "base_m": 5.0, "main_soil_codes": ["KL"]},
            ]
        },
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "borehole_track_invalid"
    assert [(e["loc"], e["code"]) for e in detail["errors"]] == [
        ("intervals.1.top_m", "intervals_overlap")
    ]

    db_session.expunge_all()
    obs = await db_session.get(ObservationOrm, dov_borehole["coded_id"])
    assert obs is not None
    assert obs.edited_manually_at is None, "a refused save must not mark the track edited"


async def test_top_below_base_and_a_gap(async_client: AsyncClient, dov_borehole: dict) -> None:
    """Top must be above base (422); a gap alone saves with a warning."""
    bad = await async_client.post(
        _url(dov_borehole),
        json={
            "kind": "lithological_description",
            "intervals": [{"top_m": 2.0, "base_m": 1.0, "description": "klei"}],
        },
    )
    assert bad.status_code == 422
    assert bad.json()["detail"]["errors"][0]["loc"] == "intervals.0.base_m"

    gap = await async_client.post(
        _url(dov_borehole),
        json={
            "kind": "lithological_description",
            "intervals": [
                {"top_m": 0.0, "base_m": 1.0, "description": "zand"},
                {"top_m": 1.5, "base_m": 2.0, "description": "klei"},
            ],
        },
    )
    assert gap.status_code == 201, gap.text
    assert [w["code"] for w in gap.json()["warnings"]] == ["gap_between_intervals"]


async def test_deleting_a_track_removes_it_with_its_intervals(
    async_client: AsyncClient, dov_borehole: dict, db_session: AsyncSession
) -> None:
    """Delete the coded track and the colour field log; the borehole stays."""
    resp = await async_client.delete(_url(dov_borehole, f"/{dov_borehole['coded_id']}"))
    assert resp.status_code == 204, resp.text
    resp = await async_client.delete(_url(dov_borehole, "/field_log:color"))
    assert resp.status_code == 204, resp.text

    detail = await _detail(async_client, dov_borehole)
    assert detail["observations"] == []
    assert detail["field_log_intervals"] == []
    assert detail["n_field_log_intervals"] == 0

    db_session.expunge_all()
    orphan_layers = (
        (
            await db_session.execute(
                select(ObservationLayerOrm).where(
                    ObservationLayerOrm.observation_id == dov_borehole["coded_id"]
                )
            )
        )
        .scalars()
        .all()
    )
    assert orphan_layers == []


async def test_track_routes_are_project_scoped_and_404_on_unknown_ids(
    async_client: AsyncClient, dov_borehole: dict
) -> None:
    """Another project's id, an unknown track, a malformed id: all 404, nothing written."""
    foreign = await async_client.delete(
        _url(dov_borehole, f"/{dov_borehole['coded_id']}", project=dov_borehole["other"])
    )
    assert foreign.status_code == 404
    unknown = await async_client.delete(_url(dov_borehole, f"/{uuid7()}"))
    assert unknown.status_code == 404
    malformed = await async_client.put(
        _url(dov_borehole, "/not-a-track"),
        json={"intervals": [{"top_m": 0.0, "base_m": 1.0, "value": "x"}]},
    )
    assert malformed.status_code == 404
    no_field_log = await async_client.delete(_url(dov_borehole, "/field_log:moisture"))
    assert no_field_log.status_code == 404


async def test_the_manual_track_is_the_one_the_sections_draw(
    async_client: AsyncClient, dov_borehole: dict
) -> None:
    """Manual wins: the detail lists the hand-typed coded track first of its kind.

    The section columns and the borelog take the FIRST observation of a kind,
    so the order of the detail response is the rule on the wire.
    """
    before = await _detail(async_client, dov_borehole)
    coded_before = [
        o["id"] for o in before["observations"] if o["observation_type"] == "coded_lithology"
    ]
    assert coded_before == [str(dov_borehole["coded_id"])]

    resp = await async_client.post(
        _url(dov_borehole),
        json={
            "kind": "coded_lithology",
            "intervals": [{"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["MZ"]}],
        },
    )
    assert resp.status_code == 201, resp.text
    manual_id = resp.json()["track_id"]

    after = await _detail(async_client, dov_borehole)
    coded_after = [
        o["id"] for o in after["observations"] if o["observation_type"] == "coded_lithology"
    ]
    assert coded_after == [manual_id, str(dov_borehole["coded_id"])]

    # The batch endpoint the section view uses follows the same rule.
    batch = await async_client.post(
        "/borehole/detail-batch",
        json={
            "ids": [str(dov_borehole["borehole"].id)],
            "app_project_id": str(dov_borehole["project"].id),
            "include": [],
        },
    )
    assert batch.status_code == 200, batch.text
    first_coded = next(
        o for o in batch.json()[0]["observations"] if o["observation_type"] == "coded_lithology"
    )
    assert first_coded["id"] == manual_id


async def test_track_provenance_rides_the_bundle_and_an_old_bundle_restores_as_dov(
    async_client: AsyncClient, dov_borehole: dict, db_session: AsyncSession
) -> None:
    """Save -> restore keeps manual / edited; a pre-provenance bundle restores as untouched DOV."""
    await async_client.put(
        _url(dov_borehole, f"/{dov_borehole['coded_id']}"),
        json={"intervals": [{"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["FZ"]}]},
    )
    created = await async_client.post(
        _url(dov_borehole),
        json={"kind": "moisture", "intervals": [{"top_m": 0.0, "base_m": 2.0, "value": "vochtig"}]},
    )
    assert created.status_code == 201, created.text

    db_session.expunge_all()
    project = await db_session.get(ProjectOrm, dov_borehole["project"].id)
    assert project is not None
    bundle = await build_project_bundle(db_session, project)
    bh_bundle = bundle["boreholes"][0]
    obs_bundle = bh_bundle["observations"][0]
    assert obs_bundle["source"] == "dov"
    assert obs_bundle["edited_manually_at"] is not None
    moisture = [r for r in bh_bundle["field_log_intervals"] if r["kind"] == "moisture"]
    assert [r["source"] for r in moisture] == ["manual"]

    async def _wipe_and_restore(boreholes: list[dict]) -> BoreholeOrm:
        await db_session.execute(
            delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project.id)
        )
        await db_session.execute(delete(ProjectOrm).where(ProjectOrm.id == project.id))
        await db_session.commit()
        db_session.expunge_all()
        await restore_project_bundle(
            db_session, project.id, bundle["project"], bundle["cpts"], boreholes
        )
        await db_session.commit()
        db_session.expunge_all()
        return (
            await db_session.execute(
                select(BoreholeOrm)
                .where(BoreholeOrm.app_project_id == project.id)
                .options(
                    selectinload(BoreholeOrm.observations),
                    selectinload(BoreholeOrm.field_log_intervals),
                )
            )
        ).scalar_one()

    restored = await _wipe_and_restore(bundle["boreholes"])
    assert restored.observations[0].source == "dov"
    assert restored.observations[0].edited_manually_at is not None
    assert {r.kind: r.source for r in restored.field_log_intervals} == {
        "color": "dov",
        "moisture": "manual",
    }

    # An older bundle (written before 2026-09-29) carries neither key.
    for obs in bh_bundle["observations"]:
        obs.pop("source", None)
        obs.pop("edited_manually_at", None)
    for row in bh_bundle["field_log_intervals"]:
        row.pop("source", None)
        row.pop("edited_manually_at", None)
    restored_old = await _wipe_and_restore(bundle["boreholes"])
    assert restored_old.observations[0].source == "dov"
    assert restored_old.observations[0].edited_manually_at is None
    assert {r.source for r in restored_old.field_log_intervals} == {"dov"}


# --- Reset to DOV (owner 2026-09-30: "a per borehole button to reset to dov
# defaults") and the 3-admixture cap ("i want max 3 admixtures in coded
# lithology"). ---------------------------------------------------------------

_DOV_NS = "http://kern.schemas.dov.vlaanderen.be"

# What DOV published for the fixture's coded track (permkey 1990-000123).
_CODED_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_DOV_NS}"><interpretaties><gecodeerdelithologie>
  <boring>kb1d1w-B1</boring><datum>1990-05-01</datum>
  <laag><van>0.00</van><tot>2.00</tot><hoofdnaam><grondsoort>FZ</grondsoort></hoofdnaam>
    <bijmenging><plaatselijk>false</plaatselijk><hoeveelheid>W</hoeveelheid>
      <grondsoort>KL</grondsoort></bijmenging></laag>
  <laag><van>2.00</van><tot>5.00</tot><hoofdnaam><grondsoort>KL</grondsoort></hoofdnaam></laag>
</gecodeerdelithologie></interpretaties></ns4:dov-schema>""".encode()

# What DOV published for the fixture's boring (boornummer kb1d1w-B1).
_BORING_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_DOV_NS}" xmlns:gml="http://www.opengis.net/gml/3.2"><boring>
  <identificatie>kb1d1w-B1</identificatie>
  <dataidentifier><permkey>1990-000001</permkey></dataidentifier>
  <ligging><gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
    <gml:pos>150000.0 200000.0 10.0</gml:pos></gml:Point></ligging>
  <diepte_tot>5.00</diepte_tot>
  <details>
    <kleur><van>0.00</van><tot>1.50</tot><kleur>groenbruin</kleur></kleur>
    <kleur><van>1.50</van><tot>5.00</tot><kleur>grijs</kleur></kleur>
  </details>
</boring></ns4:dov-schema>""".encode()


def _seed_dov_cache(root: Path) -> None:
    """Write the fixture borehole's DOV XML where the bbox import caches it."""
    (root / "boring").mkdir(parents=True, exist_ok=True)
    (root / "interpretatie").mkdir(parents=True, exist_ok=True)
    (root / "boring" / "1990-000001.xml").write_bytes(_BORING_XML)
    (root / "interpretatie" / "1990-000123.xml").write_bytes(_CODED_XML)


async def test_reset_to_dov_undoes_the_hand_edits_and_keeps_the_manual_track(
    async_client: AsyncClient,
    dov_borehole: dict,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Edit DOV's coded track + colour log, add a manual track, Reset to DOV.

    The DOV tracks come back as DOV published them (same coded track id, the
    edit mark cleared); the manual track is kept.
    """
    monkeypatch.setattr(settings, "dov_cache_dir", tmp_path)
    _seed_dov_cache(tmp_path)
    coded_id = str(dov_borehole["coded_id"])
    edit = await async_client.put(
        _url(dov_borehole, f"/{coded_id}"),
        json={"intervals": [{"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["GL"]}]},
    )
    assert edit.status_code == 200, edit.text
    edit = await async_client.put(
        _url(dov_borehole, "/field_log:color"),
        json={"intervals": [{"top_m": 0.0, "base_m": 5.0, "value": "zwart"}]},
    )
    assert edit.status_code == 200, edit.text
    manual = await async_client.post(
        _url(dov_borehole),
        json={
            "kind": "lithological_description",
            "intervals": [{"top_m": 0.0, "base_m": 5.0, "description": "zand"}],
        },
    )
    assert manual.status_code == 201, manual.text

    resp = await async_client.post(_url(dov_borehole, "/reset-dov"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["discarded_edits"] == 2
    assert body["kept_manual"] == 1
    assert {t["track_id"] for t in body["tracks"]} == {coded_id, "field_log:color"}

    detail = await _detail(async_client, dov_borehole)
    by_kind = {o["observation_type"]: o for o in detail["observations"]}
    coded = by_kind["coded_lithology"]
    assert coded["id"] == coded_id
    assert coded["edited_manually_at"] is None
    assert [la["main_soil_codes"] for la in coded["layers"]] == [["FZ"], ["KL"]]
    assert by_kind["lithological_description"]["source"] == "manual"
    colours = sorted(
        (r["top_m"], r["value"], r["edited_manually_at"])
        for r in detail["field_log_intervals"]
        if r["kind"] == "color"
    )
    assert colours == [(0.0, "groenbruin", None), (1.5, "grijs", None)]


async def test_reset_to_dov_one_track_leaves_the_other_edits(
    async_client: AsyncClient,
    dov_borehole: dict,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Reset of the colour log alone: the edited coded track keeps its edit."""
    monkeypatch.setattr(settings, "dov_cache_dir", tmp_path)
    _seed_dov_cache(tmp_path)
    coded_id = str(dov_borehole["coded_id"])
    for suffix, interval in (
        (f"/{coded_id}", {"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["GL"]}),
        ("/field_log:color", {"top_m": 0.0, "base_m": 5.0, "value": "zwart"}),
    ):
        edit = await async_client.put(_url(dov_borehole, suffix), json={"intervals": [interval]})
        assert edit.status_code == 200, edit.text

    resp = await async_client.post(
        f"/borehole/{dov_borehole['borehole'].id}/tracks/reset-dov"
        f"?project_id={dov_borehole['project'].id}&track_id=field_log:color"
    )
    assert resp.status_code == 200, resp.text
    assert [t["track_id"] for t in resp.json()["tracks"]] == ["field_log:color"]

    detail = await _detail(async_client, dov_borehole)
    coded = next(o for o in detail["observations"] if o["id"] == coded_id)
    assert coded["edited_manually_at"] is not None
    assert [la["main_soil_codes"] for la in coded["layers"]] == [["GL"]]


async def test_reset_to_dov_without_cached_xml_is_a_409_and_changes_nothing(
    async_client: AsyncClient,
    dov_borehole: dict,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An XML-file import / a wiped cache: borehole_reset_no_dov_source, the edit stays."""
    monkeypatch.setattr(settings, "dov_cache_dir", tmp_path)  # an empty cache
    coded_id = str(dov_borehole["coded_id"])
    edit = await async_client.put(
        _url(dov_borehole, f"/{coded_id}"),
        json={"intervals": [{"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["GL"]}]},
    )
    assert edit.status_code == 200, edit.text

    resp = await async_client.post(_url(dov_borehole, "/reset-dov"))
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["code"] == "borehole_reset_no_dov_source"

    detail = await _detail(async_client, dov_borehole)
    coded = next(o for o in detail["observations"] if o["id"] == coded_id)
    assert [la["main_soil_codes"] for la in coded["layers"]] == [["GL"]]


async def test_a_fourth_admixture_on_a_coded_row_is_refused(
    async_client: AsyncClient, dov_borehole: dict
) -> None:
    """Max 3 admixtures in coded lithology: 422 too_many_admixtures at intervals.0.admixtures."""
    admixtures = [
        {"soil_code": code, "amount": "W", "locally": False} for code in ("KL", "LE", "GL", "HU")
    ]
    resp = await async_client.put(
        _url(dov_borehole, f"/{dov_borehole['coded_id']}"),
        json={
            "intervals": [
                {"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["FZ"], "admixtures": admixtures}
            ]
        },
    )
    assert resp.status_code == 422, resp.text
    errors = resp.json()["detail"]["errors"]
    assert [(e["loc"], e["code"]) for e in errors] == [
        ("intervals.0.admixtures", "too_many_admixtures")
    ]


# --- Undo of the first edit (owner dogfeed 2026-10-01): "an undo that restores
# a track to exactly its DOV content clears the edited mark, an undo that leaves
# a difference keeps it". The PUT answers ``edited_manually_at: null`` itself;
# the renderer only shows it. ---------------------------------------------------

# The fixture's coded track exactly as DOV published it (what Ctrl+Z sends back).
_DOV_CODED_INTERVALS = [
    {
        "top_m": 0.0,
        "base_m": 2.0,
        "main_soil_codes": ["FZ"],
        "admixtures": [{"soil_code": "KL", "amount": "W", "locally": False}],
    },
    {"top_m": 2.0, "base_m": 5.0, "main_soil_codes": ["KL"]},
]
_DOV_COLOUR_INTERVALS = [
    {"top_m": 0.0, "base_m": 1.5, "value": "groenbruin"},
    {"top_m": 1.5, "base_m": 5.0, "value": "grijs"},
]


async def test_undo_back_to_the_dov_content_answers_not_edited(
    async_client: AsyncClient,
    dov_borehole: dict,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Edit the coded track and the colour log, then PUT DOV's content back: stamp cleared."""
    monkeypatch.setattr(settings, "dov_cache_dir", tmp_path)
    _seed_dov_cache(tmp_path)
    coded_id = str(dov_borehole["coded_id"])
    for suffix, interval in (
        (f"/{coded_id}", {"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["GL"]}),
        ("/field_log:color", {"top_m": 0.0, "base_m": 5.0, "value": "zwart"}),
    ):
        edit = await async_client.put(_url(dov_borehole, suffix), json={"intervals": [interval]})
        assert edit.status_code == 200, edit.text
        assert edit.json()["edited_manually_at"] is not None

    for suffix, intervals in (
        (f"/{coded_id}", _DOV_CODED_INTERVALS),
        ("/field_log:color", _DOV_COLOUR_INTERVALS),
    ):
        undo = await async_client.put(_url(dov_borehole, suffix), json={"intervals": intervals})
        assert undo.status_code == 200, undo.text
        assert undo.json()["edited_manually_at"] is None, suffix
        assert undo.json()["source"] == "dov"

    detail = await _detail(async_client, dov_borehole)
    coded = next(o for o in detail["observations"] if o["id"] == coded_id)
    assert coded["edited_manually_at"] is None
    assert coded["dov_permkey"] == "1990-000123"
    assert {r["edited_manually_at"] for r in detail["field_log_intervals"]} == {None}


async def test_an_undo_that_leaves_a_difference_keeps_the_stamp(
    async_client: AsyncClient,
    dov_borehole: dict,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two edits, undo the second: back to the FIRST edit, not to DOV - still edited."""
    monkeypatch.setattr(settings, "dov_cache_dir", tmp_path)
    _seed_dov_cache(tmp_path)
    url = _url(dov_borehole, f"/{dov_borehole['coded_id']}")
    first = [{"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["GL"]}]
    second = [{"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["KL"]}]
    for intervals in (first, second, first):
        resp = await async_client.put(url, json={"intervals": intervals})
        assert resp.status_code == 200, resp.text
        assert resp.json()["edited_manually_at"] is not None


async def test_without_cached_dov_xml_an_undo_keeps_the_stamp(
    async_client: AsyncClient,
    dov_borehole: dict,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty cache: the original is unknown, so the track stays marked as edited."""
    monkeypatch.setattr(settings, "dov_cache_dir", tmp_path)  # an empty cache
    url = _url(dov_borehole, f"/{dov_borehole['coded_id']}")
    edit = await async_client.put(
        url, json={"intervals": [{"top_m": 0.0, "base_m": 5.0, "main_soil_codes": ["GL"]}]}
    )
    assert edit.status_code == 200, edit.text
    undo = await async_client.put(url, json={"intervals": _DOV_CODED_INTERVALS})
    assert undo.status_code == 200, undo.text
    assert undo.json()["edited_manually_at"] is not None
