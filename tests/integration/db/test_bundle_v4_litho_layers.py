"""A4 v4 bundle round-trip — litho_layers field + v3 backwards-compat.

The A4 slice 1 lands ``format_version = 4`` with ``litho_layers``
nested under each geological-model payload (Shape A primitives:
id, formation_id, anchor, depth_top_m, depth_base_m, status, source,
confidence, ...).

Covered:
* v4 export emits the new field and populates it for litho models
* a geological (kind='geological') model emits an empty layer list
* a pending litho layer (no matching FormationContact) round-trips
  with its status preserved
* an accepted litho layer round-trips via the FC→LL trigger when
  contacts and layers both reference the same id (no pkey conflict)
* v3 bundles still parse on this build (SUPPORTED_BUNDLE_VERSIONS
  contains both 3 and 4)
* the rejected status round-trips for layers with no matching contact
"""

from __future__ import annotations

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.api.schemas.project.project_bundle import (
    BUNDLE_FORMAT_VERSION,
    SUPPORTED_BUNDLE_VERSIONS,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    BundleIntegrityError,
    build_project_bundle,
    restore_project_bundle,
)


async def _restore_bundle(
    db_session: AsyncSession,
    project_id: object,
    bundle: dict,
    *,
    replace: bool = True,
) -> None:
    """Unpack a bundle dict into restore_project_bundle's positional args.

    The restore signature predates the dict-as-payload convention used
    by the build side; existing tests duplicate this unpacking. Helper
    keeps the v4 tests terse.
    """
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
        geotechnical_units_payload=bundle.get("geotechnical_units", []),
        bodies_payload=bundle.get("bodies", []),
        formation_absences_payload=bundle.get("formation_absences", []),
        litho_contact_correlation_edges_payload=bundle.get("litho_contact_correlation_edges", []),
        body_boundary_shapes_payload=bundle.get("body_boundary_shapes", []),
        body_boundary_nodes_payload=bundle.get("body_boundary_nodes", []),
        replace=replace,
    )
    await db_session.commit()


def test_bundle_format_version_constant_is_v4() -> None:
    """Slice 1 of A4 bumps the writer version + keeps v3 parseable."""
    assert BUNDLE_FORMAT_VERSION == 4
    assert 3 in SUPPORTED_BUNDLE_VERSIONS
    assert 4 in SUPPORTED_BUNDLE_VERSIONS


@pytest_asyncio.fixture
async def project_with_litho(db_session: AsyncSession) -> dict:
    """Project + 1 litho model + 1 geo model + BH + 2 formations."""
    project = ProjectOrm(id=uuid7(), name="V4 bundle", status="active")
    db_session.add(project)
    await db_session.flush()
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="T",
        test_id="T",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="G", kind="geological"
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    clay = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="CLAY", color="#74b9ff"
    )
    db_session.add_all([bh, geo_model, litho_model, sand, clay])
    await db_session.commit()
    return {
        "project": project,
        "bh": bh,
        "litho_model": litho_model,
        "geo_model": geo_model,
        "sand": sand,
        "clay": clay,
    }


async def test_v4_bundle_emits_litho_layers_under_each_model(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """Each model payload carries ``litho_layers``; geo model empty;
    litho model emits empty ``contacts`` (slice 4c)."""
    p = project_with_litho
    # Insert a contact → trigger materialises the layer.
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        borehole_id=p["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()

    bundle = await build_project_bundle(db_session, p["project"])

    assert bundle["format_version"] == 4
    models_by_kind = {m["kind"]: m for m in bundle["geological_models"]}
    assert "litho_layers" in models_by_kind["lithostratigraphic"]
    assert "litho_layers" in models_by_kind["geological"]
    assert len(models_by_kind["lithostratigraphic"]["litho_layers"]) == 1
    assert len(models_by_kind["geological"]["litho_layers"]) == 0
    layer = models_by_kind["lithostratigraphic"]["litho_layers"][0]
    # UUID preserved across the trigger's mirror.
    assert layer["id"] == str(contact.id)
    assert layer["depth_top_m"] == 2.0
    # A4 slice 4c: litho models emit empty contacts; geological keep theirs.
    assert models_by_kind["lithostratigraphic"]["contacts"] == []


async def test_v4_round_trip_recreates_fc_mirror_from_layers_alone(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """A4 slice 4c — bundle round-trip works WITHOUT contacts on litho.

    Build → wipe → restore: the bundle's litho_layers list is the only
    source; the LL→FC trigger fires on each accepted-layer INSERT
    during restore and rebuilds the formation_contact mirror, including
    parent_geo_contact_id, source mapping, and confidence.
    """
    p = project_with_litho
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        borehole_id=p["bh"].id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()
    contact_id = contact.id

    bundle = await build_project_bundle(db_session, p["project"])
    # Sanity: litho model emits empty contacts (slice 4c invariant).
    litho_models = [m for m in bundle["geological_models"] if m["kind"] == "lithostratigraphic"]
    assert litho_models[0]["contacts"] == []
    assert len(litho_models[0]["litho_layers"]) == 1

    # Wipe + restore. The trigger rebuilds the FC mirror from the layer.
    await _restore_bundle(db_session, p["project"].id, bundle)

    fc_back = await db_session.get(FormationContactOrm, contact_id)
    assert fc_back is not None, "LL→FC trigger should have re-materialised the contact mirror"
    assert fc_back.depth_top_m == 3.0
    assert fc_back.source == "manual_pick"


async def test_v4_round_trip_via_replace_restore(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """An accepted layer materialised by the trigger round-trips:
    build → wipe → restore → trigger fires again on the restored
    contact → litho_layer ends up with the same id + depth."""
    p = project_with_litho
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        borehole_id=p["bh"].id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()

    bundle = await build_project_bundle(db_session, p["project"])

    # Wipe + restore.
    await _restore_bundle(db_session, p["project"].id, bundle)
    layer = await db_session.get(LithoLayerOrm, contact.id)
    assert layer is not None
    assert layer.depth_top_m == 3.0
    assert layer.status == "accepted"


async def test_pending_layer_with_no_matching_fc_round_trips(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """A pending layer (no FormationContact) survives bundle replace-restore.

    The trigger never touches pending/rejected rows, so the bundle restore
    MUST insert them explicitly. This pins that the explicit-insert
    branch wires correctly + the status carries through.
    """
    p = project_with_litho
    pending_id = uuid7()
    layer = LithoLayerOrm(
        id=pending_id,
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        borehole_id=p["bh"].id,
        depth_top_m=1.0,
        depth_base_m=2.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    db_session.add(layer)
    await db_session.commit()

    bundle = await build_project_bundle(db_session, p["project"])

    # Verify the bundle carries the pending layer.
    litho_models = [m for m in bundle["geological_models"] if m["kind"] == "lithostratigraphic"]
    bundled_layers = litho_models[0]["litho_layers"]
    assert len(bundled_layers) == 1
    assert bundled_layers[0]["status"] == "pending"

    # Restore from scratch.
    await _restore_bundle(db_session, p["project"].id, bundle)
    restored = await db_session.get(LithoLayerOrm, pending_id)
    assert restored is not None
    assert restored.status == "pending"
    assert restored.source == "segmenter"
    assert restored.depth_top_m == 1.0
    assert restored.depth_base_m == 2.0


async def test_rejected_layer_with_no_matching_fc_round_trips(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """Same as pending, for the rejected status."""
    p = project_with_litho
    rejected_id = uuid7()
    layer = LithoLayerOrm(
        id=rejected_id,
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        borehole_id=p["bh"].id,
        depth_top_m=5.0,
        depth_base_m=6.0,
        status="rejected",
        source="segmenter",
        confidence="low",
    )
    db_session.add(layer)
    await db_session.commit()

    bundle = await build_project_bundle(db_session, p["project"])
    await _restore_bundle(db_session, p["project"].id, bundle)

    restored = await db_session.get(LithoLayerOrm, rejected_id)
    assert restored is not None
    assert restored.status == "rejected"


async def test_v3_bundle_still_restores(db_session: AsyncSession, project_with_litho: dict) -> None:
    """v3 backwards-compat: a bundle without ``litho_layers`` field still
    restores cleanly. The trigger materialises the layer from the
    contact (status='accepted' is the only path).
    """
    p = project_with_litho
    contact_id = uuid7()
    # Build a v3-shaped bundle by hand (no litho_layers field).
    v3_bundle = {
        "format_version": 3,
        "project": {
            "id": str(p["project"].id),
            "name": p["project"].name,
            "status": "active",
        },
        "cpts": [],
        "boreholes": [
            {
                "id": str(p["bh"].id),
                "name": p["bh"].name,
                "project_id": p["bh"].project_id,
                "test_id": p["bh"].test_id,
                "location_x": p["bh"].location_x,
                "location_y": p["bh"].location_y,
                "epsg": p["bh"].epsg,
                "total_depth_m": p["bh"].total_depth_m,
                "drill_segments": [],
                "field_log_intervals": [],
                "observations": [],
                "samples": [],
            }
        ],
        "geological_formations": [
            {
                "id": str(p["sand"].id),
                "name": p["sand"].name,
                "color": p["sand"].color,
            },
        ],
        "geological_models": [
            # Geo parent must appear before the litho model (INSERT order).
            {
                "id": str(p["geo_model"].id),
                "name": p["geo_model"].name,
                "kind": "geological",
                "is_active": False,
                "excluded_borehole_ids": [],
                "contacts": [],
                "surfaces": [],
            },
            {
                "id": str(p["litho_model"].id),
                "name": p["litho_model"].name,
                "kind": "lithostratigraphic",
                "is_active": False,
                "excluded_borehole_ids": [],
                # v3 bundles did not always carry parent_geological_model_id,
                # but the new CHECK constraint requires it — include it here
                # so the restore satisfies the DB invariant.
                "parent_geological_model_id": str(p["geo_model"].id),
                "contacts": [
                    {
                        "id": str(contact_id),
                        "formation_id": str(p["sand"].id),
                        "borehole_id": str(p["bh"].id),
                        "cpt_id": None,
                        "depth_top_m": 4.0,
                        "source": "manual_pick",
                        "confidence": "medium",
                    }
                ],
                "surfaces": [],
                # No litho_layers field — the v3 case.
            },
        ],
    }
    await _restore_bundle(db_session, p["project"].id, v3_bundle)
    # Trigger materialised the layer.
    layer = await db_session.get(LithoLayerOrm, contact_id)
    assert layer is not None
    assert layer.status == "accepted"
    assert layer.depth_top_m == 4.0


async def test_v4_skipped_explicit_insert_does_not_double_up(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """An accepted layer (matching FC exists) is restored ONCE.

    Pins the de-dupe rule for LEGACY v4 bundles that DID emit
    contacts on litho models (saved by an earlier build, pre-slice-4c).
    If a layer.id appears in the bundle's contacts payload, restore
    skips the explicit LL INSERT — the trigger creates it from the
    contact. Double-insert would conflict on litho_layer_pkey.

    Current-build v4 bundles emit empty contacts on litho models
    (slice 4c), so this de-dupe path doesn't normally fire. Hand-craft
    a legacy-shaped bundle to exercise it directly.
    """
    p = project_with_litho
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        borehole_id=p["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()
    bundle = await build_project_bundle(db_session, p["project"])

    # Current behaviour: contacts empty for litho, layer present.
    litho_models = [m for m in bundle["geological_models"] if m["kind"] == "lithostratigraphic"]
    assert litho_models[0]["contacts"] == []
    assert len(litho_models[0]["litho_layers"]) == 1
    layer_id = litho_models[0]["litho_layers"][0]["id"]

    # Hand-craft the legacy shape: inject the matching contact back
    # into the bundle to simulate an older-build save where both
    # fields were populated.
    litho_models[0]["contacts"] = [
        {
            "id": layer_id,
            "formation_id": str(p["sand"].id),
            "borehole_id": str(p["bh"].id),
            "cpt_id": None,
            "depth_top_m": 2.0,
            "source": "manual_pick",
            "confidence": "medium",
        }
    ]

    # Restore must not double-insert.
    await _restore_bundle(db_session, p["project"].id, bundle)
    rows = list(
        (await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.id == contact.id)))
        .scalars()
        .all()
    )
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# Bundle integrity guards (2026-05-31 dogfeed fix)
# ---------------------------------------------------------------------------
#
# Backs the chain that wiped 833 accepted layers on the dogfedded
# project: bundle was self-inconsistent (833 layers referenced 19
# formations not in the file), restore in replace mode wiped the DB to
# match the file, every layer dropped as an orphan. Two guards:
#
# * Bundle EXPORT refuses to write when layers/contacts reference a
#   formation that does not exist anywhere in the DB. Saves fail at
#   the source instead of producing a broken file. (When the missing
#   formation EXISTS in the DB but is out-of-scope for the project-
#   scope query, the exporter auto-recovers it.)
# * Bundle RESTORE in ``replace=True`` mode refuses to wipe the DB
#   when the inbound bundle would orphan any contact/layer. The non-
#   replace open-from-file path stays tolerant.


async def test_export_auto_recovers_out_of_scope_formation(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """Bundle export auto-includes a referenced formation missing from project scope.

    Scenario: a litho layer references a formation whose app_project_id
    does not match this project (resolver-instance drift, the historical
    leak source). The project-scoped formation query misses it, but the
    DB still has the row. The exporter should globally re-fetch it and
    include it so the bundle is self-consistent — with a WARNING logged
    that schema drift was detected.
    """
    from groundmodel.infrastructure.db.repositories.project_bundle import (
        build_project_bundle,
    )

    p = project_with_litho
    # Stash a formation under a DIFFERENT project so the project-scope
    # query for ``p["project"]`` misses it.
    other_project = ProjectOrm(id=uuid7(), name="other", status="active")
    out_of_scope_formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=other_project.id,
        name="OUT-OF-SCOPE",
        color="#000000",
    )
    db_session.add_all([other_project, out_of_scope_formation])
    await db_session.flush()

    # Reach past the FK by creating a pending layer (no FC mirror needed)
    # whose formation_id points at the out-of-scope formation. The FK on
    # litho_layer.formation_id is global (just ``geological_formation.id``)
    # so the insert succeeds.
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=p["litho_model"].id,
        formation_id=out_of_scope_formation.id,
        borehole_id=p["bh"].id,
        depth_top_m=4.0,
        depth_base_m=5.0,
        status="pending",
        source="segmenter",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()

    bundle = await build_project_bundle(db_session, p["project"])
    emitted_fids = {f["id"] for f in bundle["geological_formations"]}
    assert str(out_of_scope_formation.id) in emitted_fids, (
        "Exporter must auto-recover formations referenced by layers/contacts "
        "even when they fall outside the project scope"
    )


async def test_export_refuses_when_referenced_formation_does_not_exist(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """Bundle export raises BundleIntegrityError when a formation is truly missing.

    Scenario: a layer references a formation that has been deleted from
    the DB entirely. The exporter cannot recover it. Writing the bundle
    would produce the 2026-05-31 dogfeed shape — refuse instead.
    """
    from sqlalchemy import delete

    from groundmodel.infrastructure.db.repositories.project_bundle import (
        build_project_bundle,
    )

    p = project_with_litho
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=p["litho_model"].id,
        formation_id=p["clay"].id,
        borehole_id=p["bh"].id,
        depth_top_m=5.0,
        depth_base_m=6.0,
        status="pending",
        source="segmenter",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()

    # Drop the formation while bypassing the FK CASCADE so the layer
    # survives as a dangling reference. ``session_replication_role =
    # replica`` disables user-triggered cascades + checks for this
    # session only; the snapshot the production bug produces is the
    # equivalent end state.
    from sqlalchemy import text

    await db_session.execute(text("SET session_replication_role = replica"))
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.id == p["clay"].id)
    )
    await db_session.execute(text("SET session_replication_role = origin"))
    await db_session.commit()

    import pytest

    with pytest.raises(BundleIntegrityError, match="do not exist in the DB"):
        await build_project_bundle(db_session, p["project"])


async def test_replace_restore_refuses_when_bundle_would_orphan_layers(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """``replace=True`` restore refuses when the bundle is self-inconsistent.

    Constructs a synthetic bundle whose litho model carries layers
    referencing a formation_id that is NOT in the bundle's
    geological_formations array. The replace-restore guard must raise
    instead of wiping the DB and silently dropping every layer as an
    orphan (the 2026-05-31 chain).
    """
    import pytest

    p = project_with_litho
    ghost_formation_id = str(uuid7())  # not in the bundle, not in the DB
    fake_layer = {
        "id": str(uuid7()),
        "model_id": str(p["litho_model"].id),
        "formation_id": ghost_formation_id,
        "borehole_id": str(p["bh"].id),
        "cpt_id": None,
        "depth_top_m": 1.0,
        "depth_base_m": 2.0,
        "status": "pending",
        "source": "segmenter",
        "confidence": "medium",
        "observation_id": None,
        "observation_layer_id": None,
        "parent_geo_contact_id": None,
        "notes": None,
    }
    bundle = {
        "format_version": 4,
        "project": {"id": str(p["project"].id), "name": "test", "status": "active"},
        "cpts": [],
        "boreholes": [],
        # Note: the ghost_formation_id is intentionally absent.
        "geological_formations": [
            {
                "id": str(p["sand"].id),
                "app_project_id": str(p["project"].id),
                "name": "SAND",
                "color": "#fdcb6e",
                "display_order": 0,
            }
        ],
        "geological_models": [
            {
                "id": str(p["litho_model"].id),
                "app_project_id": str(p["project"].id),
                "name": "L",
                "kind": "lithostratigraphic",
                "contacts": [],
                "litho_layers": [fake_layer],
            }
        ],
    }

    with pytest.raises(BundleIntegrityError, match="self-inconsistent"):
        await _restore_bundle(db_session, p["project"].id, bundle, replace=True)


async def test_non_replace_restore_stays_tolerant_on_broken_bundle(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """The open-from-file path keeps its lenient orphan-skipping behaviour.

    Only the destructive ``replace=True`` path enforces the integrity
    guard — old bundles produced by pre-fix builds must still open via
    the non-replace path so users with broken files can recover what
    survives (the same tolerance comment in the contact / lens / absence
    paths already encodes).
    """
    p = project_with_litho
    ghost_formation_id = str(uuid7())
    fake_layer = {
        "id": str(uuid7()),
        "model_id": str(p["litho_model"].id),
        "formation_id": ghost_formation_id,
        "borehole_id": str(p["bh"].id),
        "cpt_id": None,
        "depth_top_m": 1.0,
        "depth_base_m": 2.0,
        "status": "pending",
        "source": "segmenter",
        "confidence": "medium",
        "observation_id": None,
        "observation_layer_id": None,
        "parent_geo_contact_id": None,
        "notes": None,
    }
    bundle = {
        "format_version": 4,
        "project": {"id": str(p["project"].id), "name": "test", "status": "active"},
        "cpts": [],
        "boreholes": [],
        "geological_formations": [],
        "geological_models": [
            {
                "id": str(p["litho_model"].id),
                "app_project_id": str(p["project"].id),
                "name": "L",
                "kind": "lithostratigraphic",
                "contacts": [],
                "litho_layers": [fake_layer],
            }
        ],
    }
    # Must NOT raise — the non-replace path skips the orphan layer.
    await _restore_bundle(db_session, p["project"].id, bundle, replace=False)
    # The orphan layer must be absent (skipped); no FK violation.
    rows = list(
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.id == fake_layer["id"])
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


# ---------------------------------------------------------------------------
# Body bundle round-trip + integrity guards (slice 4.1)
# ---------------------------------------------------------------------------


async def test_body_round_trips_in_bundle(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """A BodyOrm row survives build → restore via the ``bodies`` key.

    Checks:
    * build emits a ``bodies`` key (not the old ``litho_lenses``)
    * the body payload includes source_investigation_id + all extent columns
    * restore re-creates the row with all columns intact
    """
    p = project_with_litho
    body = BodyOrm(
        id=uuid7(),
        app_project_id=p["project"].id,
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        body_ordinal=0,
        source_investigation_id=p["bh"].id,
        name="Test body",
        extent_left_kind=None,
        extent_right_kind="open",
    )
    db_session.add(body)
    await db_session.commit()

    bundle = await build_project_bundle(db_session, p["project"])

    # New key name — old key must be absent.
    assert "bodies" in bundle, "build must emit 'bodies' key"
    assert "litho_lenses" not in bundle, "old 'litho_lenses' key must be gone"
    assert len(bundle["bodies"]) == 1
    row = bundle["bodies"][0]
    assert str(row["id"]) == str(body.id)
    assert str(row["source_investigation_id"]) == str(p["bh"].id)
    assert row["extent_right_kind"] == "open"
    assert "content_key" not in row, "content_key must not appear in the payload"

    # Wipe and restore — the body must come back.
    await db_session.execute(
        __import__("sqlalchemy", fromlist=["delete"])
        .delete(BodyOrm)
        .where(BodyOrm.app_project_id == p["project"].id)
    )
    await db_session.commit()

    await _restore_bundle(db_session, p["project"].id, bundle, replace=False)

    restored = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == body.id))
    ).scalar_one_or_none()
    assert restored is not None, "body must be restored"
    assert str(restored.source_investigation_id) == str(p["bh"].id)
    assert restored.extent_right_kind == "open"


async def test_body_with_to_target_extent_round_trips(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """A body with extent_left_kind='to_target' survives build → restore.

    The target_contact_id must resolve; the body must come back intact.
    """
    p = project_with_litho
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        borehole_id=p["bh"].id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.flush()

    body = BodyOrm(
        id=uuid7(),
        app_project_id=p["project"].id,
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        body_ordinal=0,
        source_investigation_id=p["bh"].id,
        extent_left_kind="to_target",
        extent_left_target_contact_id=contact.id,
    )
    db_session.add(body)
    await db_session.commit()

    bundle = await build_project_bundle(db_session, p["project"])
    body_row = bundle["bodies"][0]
    assert body_row["extent_left_kind"] == "to_target"
    assert str(body_row["extent_left_target_contact_id"]) == str(contact.id)

    # replace=True wipes and re-inserts everything — the contact comes back
    # from the model payload (nested under contacts[]) and is present in the
    # valid_contact_ids_for_bodies set before the body loop runs.
    db_session.expunge_all()
    await _restore_bundle(db_session, p["project"].id, bundle, replace=True)

    restored = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == body.id))
    ).scalar_one_or_none()
    assert restored is not None
    assert restored.extent_left_kind == "to_target"
    assert str(restored.extent_left_target_contact_id) == str(contact.id)


async def test_body_extent_to_target_dangling_contact_stripped(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """extent_left_kind='to_target' with a ghost target_contact_id is stripped,
    but the body row itself is kept (extent stripped, not body dropped).
    """
    p = project_with_litho
    ghost_contact_id = str(uuid7())  # not in the bundle, not in the DB

    bundle = {
        "format_version": 4,
        "project": {"id": str(p["project"].id), "name": "test", "status": "active"},
        "cpts": [],
        "boreholes": [
            {
                "id": str(p["bh"].id),
                "app_project_id": str(p["project"].id),
                "name": "BH-1",
                "project_id": "T",
                "test_id": "T",
                "location_x": 0.0,
                "location_y": 0.0,
                "epsg": 31370,
                "total_depth_m": 10.0,
            }
        ],
        "geological_formations": [
            {
                "id": str(p["sand"].id),
                "app_project_id": str(p["project"].id),
                "name": "SAND",
                "color": "#fdcb6e",
                "display_order": 0,
            }
        ],
        "geological_models": [
            {
                "id": str(p["litho_model"].id),
                "app_project_id": str(p["project"].id),
                "name": "L",
                "kind": "lithostratigraphic",
                "contacts": [],
                "litho_layers": [],
            }
        ],
        "bodies": [
            {
                "id": str(uuid7()),
                "model_id": str(p["litho_model"].id),
                "formation_id": str(p["sand"].id),
                "body_ordinal": 0,
                "source_investigation_id": str(p["bh"].id),
                "name": None,
                "primary_section_id": None,
                "extent_left_kind": "to_target",
                "extent_left_target_contact_id": ghost_contact_id,
                "extent_left_neighbour_inv_id": None,
                "extent_right_kind": None,
                "extent_right_target_contact_id": None,
                "extent_right_neighbour_inv_id": None,
            }
        ],
    }

    await _restore_bundle(db_session, p["project"].id, bundle, replace=False)

    restored_bodies = list(
        (await db_session.execute(select(BodyOrm).where(BodyOrm.app_project_id == p["project"].id)))
        .scalars()
        .all()
    )
    # The body must survive even though its extent was invalid.
    assert len(restored_bodies) == 1, "body must be restored despite stripped extent"
    b = restored_bodies[0]
    # The unresolvable extent is stripped to NULL.
    assert b.extent_left_kind is None, "dangling to_target extent must be stripped"
    assert b.extent_left_target_contact_id is None


async def test_litho_layer_body_id_round_trips_via_resolver_restamp(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """``litho_layer.body_id`` round-trips through the resolver re-stamp.

    The .gmproj bundle does NOT restore ``body_id`` directly — restoring
    it would FK-violate, because bodies are inserted in a later restore
    phase than the litho layers.  Instead the restore-endpoint runs
    ``ResolveLithoInstances`` after the full restore, which re-stamps
    ``litho_layer.body_id`` by matching each restored body on
    ``(formation_id, body_ordinal)``.  This test mirrors that flow:

    1. Seed an ACCEPTED litho layer (via a FormationContact so the
       FC→LL trigger materialises it as accepted), then run the resolver
       so a body exists and the layer is stamped.
    2. Give the body a NAME and a USER-CLAIMED extent (``open``).
    3. Export → wipe → restore → re-run the resolver (the endpoint's
       post-restore reconcile pass).
    4. Assert: the accepted layer's ``body_id`` is non-null and points
       at a body that exists in the restored model; the named body
       survived (name preserved); the user-claimed extent survived.
    """
    from groundmodel.application.resolve_litho_instances_use_case import (
        ResolveLithoInstances,
    )

    p = project_with_litho
    # 1. Accepted layer via the FC→LL trigger.
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=p["litho_model"].id,
        formation_id=p["sand"].id,
        borehole_id=p["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()
    layer_id = contact.id

    # Run the resolver so one body row exists + the layer is stamped.
    await ResolveLithoInstances(db_session).execute(model_id=p["litho_model"].id, commit=True)

    body_before = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == p["litho_model"].id))
    ).scalar_one()
    # 2. Name the body + claim an extent (user-owned provenance).
    body_before.name = "Sand lens A"
    body_before.extent_left_kind = "open"
    await db_session.commit()

    layer_before = await db_session.get(LithoLayerOrm, layer_id)
    assert layer_before is not None
    assert layer_before.body_id == body_before.id, "precondition: layer stamped before export"

    # 3. Export → wipe → restore.
    bundle = await build_project_bundle(db_session, p["project"])
    db_session.expunge_all()
    await _restore_bundle(db_session, p["project"].id, bundle, replace=True)

    # Immediately after restore, body_id is intentionally NULL on the
    # accepted layer — it is NOT restored from the payload (FK-before-bodies).
    layer_post_restore = await db_session.get(LithoLayerOrm, layer_id)
    assert layer_post_restore is not None
    assert layer_post_restore.body_id is None, (
        "body_id must be null straight after restore — the resolver re-stamps it"
    )

    # 4. Run the resolver (the restore endpoint's post-restore reconcile).
    await ResolveLithoInstances(db_session).execute(model_id=p["litho_model"].id, commit=True)

    # The resolver re-stamps body_id via a Core UPDATE that bypasses the
    # ORM identity map; expunge so the assertions read ground truth from
    # the DB rather than the stale layer object loaded above.
    db_session.expunge_all()
    layer_after = await db_session.get(LithoLayerOrm, layer_id)
    assert layer_after is not None
    assert layer_after.body_id is not None, "resolver must re-stamp body_id after restore"

    body_after = await db_session.get(BodyOrm, layer_after.body_id)
    assert body_after is not None, "the stamped body_id must point at a real body row"
    assert body_after.model_id == p["litho_model"].id
    # Named body + user-claimed extent survived the round-trip.
    assert body_after.name == "Sand lens A", "named body must survive the round-trip"
    assert body_after.extent_left_kind == "open", "user-claimed extent kind must survive"


async def test_body_with_dangling_source_investigation_is_dropped(
    db_session: AsyncSession, project_with_litho: dict
) -> None:
    """A body whose source_investigation_id does not resolve is dropped entirely."""
    p = project_with_litho
    ghost_inv_id = str(uuid7())  # not in the bundle, not in the DB

    bundle = {
        "format_version": 4,
        "project": {"id": str(p["project"].id), "name": "test", "status": "active"},
        "cpts": [],
        "boreholes": [],
        "geological_formations": [
            {
                "id": str(p["sand"].id),
                "app_project_id": str(p["project"].id),
                "name": "SAND",
                "color": "#fdcb6e",
                "display_order": 0,
            }
        ],
        "geological_models": [
            {
                "id": str(p["litho_model"].id),
                "app_project_id": str(p["project"].id),
                "name": "L",
                "kind": "lithostratigraphic",
                "contacts": [],
                "litho_layers": [],
            }
        ],
        "bodies": [
            {
                "id": str(uuid7()),
                "model_id": str(p["litho_model"].id),
                "formation_id": str(p["sand"].id),
                "body_ordinal": 0,
                "source_investigation_id": ghost_inv_id,
                "name": None,
                "primary_section_id": None,
                "extent_left_kind": None,
                "extent_left_target_contact_id": None,
                "extent_left_neighbour_inv_id": None,
                "extent_right_kind": None,
                "extent_right_target_contact_id": None,
                "extent_right_neighbour_inv_id": None,
            }
        ],
    }

    await _restore_bundle(db_session, p["project"].id, bundle, replace=False)

    restored_bodies = list(
        (await db_session.execute(select(BodyOrm).where(BodyOrm.app_project_id == p["project"].id)))
        .scalars()
        .all()
    )
    # The body must be dropped because its source investigation is unknown.
    assert restored_bodies == [], "body with dangling source_investigation_id must be dropped"
