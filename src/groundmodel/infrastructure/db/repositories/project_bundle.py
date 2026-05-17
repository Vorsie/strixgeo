"""Project bundle serialiser — full round-trip between ORM tree and JSON.

Backs the .gmproj v2 file format: a project's complete state (header
metadata + every CPT with its series + every borehole with its full
tree) serialises to one JSON-friendly dict, restores from one back to
the DB. Used by:

* ``GET /projects/{id}/bundle`` — the desktop client calls this on
  File → Save and embeds the result in the .gmproj file.
* ``POST /projects/{id}/restore`` — the desktop client calls this on
  open when the DB doesn't have the row the file points at, passing
  the embedded bundle so CPTs and boreholes come back along with the
  project shell.

The round-trip is idempotent: re-restoring a bundle whose rows already
exist (by id) returns them as-is rather than failing or duplicating.

Design choices:

* **Column-attr enumeration** (``__mapper__.column_attrs``) instead of
  per-table schemas. Adding a new column to any ORM model rides along
  automatically. The trade-off is weaker static typing; we make up for
  it with the type-conversion hooks (``_TO_JSON`` / ``_FROM_JSON``)
  which are central, audited, and tested.
* **Geometry is dropped, not serialised.** Both CPT and Borehole carry
  a PostGIS ``location`` column that's purely derived from the raw
  ``location_x`` / ``location_y`` / ``epsg`` triple. We rebuild it on
  restore via WKTElement so we never round-trip the WKB blob through
  JSON.
* **Server-managed columns are dropped** (``created_at``,
  ``updated_at``, ``archived_at``). The first two are
  ``server_default=now()``; ``archived_at`` is excluded by intent —
  restoring brings a project back as active even if it was archived
  before the DB was wiped (the user opened the file, they want it
  available).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from geoalchemy2 import WKTElement
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.domain.value_objects.model_kind import (
    MODEL_KIND_GEOLOGICAL,
    MODEL_KINDS,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.geotechnical_unit_orm import GeotechnicalUnitOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import (
    InvestigationReviewOrm,
)
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Columns dropped on serialise + restore. Timestamps are server-defaults;
# geometry is rebuilt from x/y/epsg. ``archived_at`` is by-design active
# on restore — see module docstring.
_SKIP_COLUMNS = frozenset({"created_at", "updated_at", "archived_at", "location"})

logger = LoggerFactory.get_logger(__name__)


# ---------------------------------------------------------------------------
# Value-level JSON encoding / decoding
# ---------------------------------------------------------------------------


def _to_json(value: Any) -> Any:
    """Convert a DB-side value to a JSON-friendly form.

    UUIDs / dates / datetimes become ISO strings; bytes columns become
    lowercase hex strings (LargeBinary columns like
    ``formation_surface.source_contact_checksum`` are random-byte
    digests that don't round-trip through JSON as raw strings —
    pydantic raises ``invalid utf-8 sequence`` the moment a non-ASCII
    byte appears). Arrays convert element-wise. Floats / ints /
    strings / None / lists-of-those pass through unchanged.
    """
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bytes | bytearray | memoryview):
        return bytes(value).hex()
    if isinstance(value, list):
        return [_to_json(v) for v in value]
    return value


def _from_json(value: Any, python_type: type[Any] | None) -> Any:
    """Reverse of ``_to_json`` — parse JSON back to the DB-side Python type.

    The ``python_type`` hint comes from the column's ``type.python_type``
    (e.g. ``UUID`` for ``PG_UUID``, ``date`` for ``Date``, ``bytes`` for
    ``LargeBinary``). When the value is ``None`` or the type doesn't
    need parsing (str / int / float / list of those) we return it
    unchanged.
    """
    if value is None:
        return None
    if python_type is UUID and isinstance(value, str):
        return UUID(value)
    if python_type is datetime and isinstance(value, str):
        return datetime.fromisoformat(value)
    if python_type is date and isinstance(value, str):
        return date.fromisoformat(value)
    if python_type is bytes and isinstance(value, str):
        return bytes.fromhex(value)
    return value


def _column_to_json(orm: Any, exclude: frozenset[str]) -> dict[str, Any]:
    """Snapshot every mapped column on ``orm`` as a JSON-friendly dict.

    Mirrors ``project_repository._column_dict`` but applies ``_to_json``
    per value so the result is safe to dump straight to JSON.
    """
    return {
        col.key: _to_json(getattr(orm, col.key))
        for col in orm.__class__.__mapper__.column_attrs
        if col.key not in exclude
    }


def _apply_json_to_kwargs(cls: type[Any], data: dict[str, Any]) -> dict[str, Any]:
    """Parse a JSON dict into ORM-constructor kwargs.

    For each column known to ``cls`` that appears in ``data``, look up
    the column's Python type and run ``_from_json``. Unknown keys are
    silently dropped — older bundle versions that included a now-removed
    column shouldn't blow up the restore.
    """
    known: dict[str, type[Any] | None] = {}
    for col in cls.__mapper__.column_attrs:
        try:
            python_type = col.columns[0].type.python_type
        except (AttributeError, NotImplementedError):
            python_type = None
        known[col.key] = python_type

    return {
        key: _from_json(data[key], known[key])
        for key in data
        if key in known and key not in _SKIP_COLUMNS
    }


# ---------------------------------------------------------------------------
# Per-table serialise helpers — small, focused, mirror the clone helpers in
# project_repository.py.
# ---------------------------------------------------------------------------


def _cpt_to_dict(cpt: CptOrm) -> dict[str, Any]:
    payload = _column_to_json(cpt, _SKIP_COLUMNS | {"app_project_id"})
    if cpt.series is not None:
        payload["series"] = _column_to_json(cpt.series, _SKIP_COLUMNS | {"cpt_id"})
    else:
        payload["series"] = None
    return payload


def _borehole_to_dict(bh: BoreholeOrm) -> dict[str, Any]:
    payload = _column_to_json(bh, _SKIP_COLUMNS | {"app_project_id"})
    payload["drill_segments"] = [
        _column_to_json(seg, _SKIP_COLUMNS | {"borehole_id"}) for seg in bh.drill_segments
    ]
    payload["field_log_intervals"] = [
        _column_to_json(fl, _SKIP_COLUMNS | {"borehole_id"}) for fl in bh.field_log_intervals
    ]
    payload["observations"] = [_observation_to_dict(obs) for obs in bh.observations]
    payload["samples"] = [_sample_to_dict(s) for s in bh.samples]
    return payload


def _observation_to_dict(obs: ObservationOrm) -> dict[str, Any]:
    payload = _column_to_json(obs, _SKIP_COLUMNS | {"borehole_id"})
    payload["layers"] = [_layer_to_dict(layer) for layer in obs.layers]
    return payload


def _layer_to_dict(layer: ObservationLayerOrm) -> dict[str, Any]:
    payload = _column_to_json(layer, _SKIP_COLUMNS | {"observation_id"})
    payload["admixtures"] = [
        _column_to_json(admix, _SKIP_COLUMNS | {"observation_layer_id"})
        for admix in layer.admixtures
    ]
    return payload


def _sample_to_dict(sample: SampleOrm) -> dict[str, Any]:
    payload = _column_to_json(sample, _SKIP_COLUMNS | {"borehole_id"})
    # Every lab-test family shares the same leaf shape — flat columns,
    # FK back to sample.id. ``rotation`` here lists each family alongside
    # its bundle-key name.
    payload["grain_sizes"] = [
        _column_to_json(g, _SKIP_COLUMNS | {"sample_id"}) for g in sample.grain_sizes
    ]
    payload["atterberg_limits_tests"] = [
        _column_to_json(a, _SKIP_COLUMNS | {"sample_id"}) for a in sample.atterberg_limits_tests
    ]
    payload["caco3_content_tests"] = [
        _column_to_json(c, _SKIP_COLUMNS | {"sample_id"}) for c in sample.caco3_content_tests
    ]
    payload["organic_content_tests"] = [
        _column_to_json(o, _SKIP_COLUMNS | {"sample_id"}) for o in sample.organic_content_tests
    ]
    payload["water_content_tests"] = [
        _column_to_json(w, _SKIP_COLUMNS | {"sample_id"}) for w in sample.water_content_tests
    ]
    payload["scalar_lab_tests"] = [
        _column_to_json(s, _SKIP_COLUMNS | {"sample_id"}) for s in sample.scalar_lab_tests
    ]
    return payload


# ---------------------------------------------------------------------------
# Bundle-build entrypoint — used by the GET /projects/{id}/bundle endpoint.
# ---------------------------------------------------------------------------


async def build_project_bundle(session: AsyncSession, project: ProjectOrm) -> dict[str, Any]:
    """Return a fully serialised snapshot of a project + every child.

    The project row is passed in (already loaded by the caller).
    Children are eager-loaded here in one batch each — same pattern as
    ``ProjectRepository.duplicate``.

    The output is a plain ``dict`` (no Pydantic) — FastAPI serialises it
    to JSON via the default encoder. Floats / ints / strings / lists /
    nested dicts all pass through; UUIDs and dates were already
    flattened to strings inside the per-table helpers.
    """
    cpts_stmt = (
        select(CptOrm)
        .where(CptOrm.app_project_id == project.id)
        .options(selectinload(CptOrm.series))
    )
    boreholes_stmt = (
        select(BoreholeOrm)
        .where(BoreholeOrm.app_project_id == project.id)
        .options(
            selectinload(BoreholeOrm.drill_segments),
            selectinload(BoreholeOrm.field_log_intervals),
            selectinload(BoreholeOrm.observations)
            .selectinload(ObservationOrm.layers)
            .selectinload(ObservationLayerOrm.admixtures),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.grain_sizes),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.atterberg_limits_tests),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.caco3_content_tests),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.organic_content_tests),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.water_content_tests),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.scalar_lab_tests),
        )
    )
    # Geological-model tree. The bundle carries the user's interpretation
    # work (formations + models + every contact) so re-opening the file
    # on a wiped DB — or on a different device — brings the model back
    # alongside the raw investigations.
    formations_stmt = select(GeologicalFormationOrm).where(
        GeologicalFormationOrm.app_project_id == project.id
    )
    # Geotechnical units are siblings of formations in the bundle layout
    # rather than nested under them — the parent formation_id rides on
    # each row, so the restore path is one flat array walk per kind. A
    # nested shape would have to defer the unit insert until its parent
    # formation existed in the session; flat is simpler.
    units_stmt = select(GeotechnicalUnitOrm).where(GeotechnicalUnitOrm.app_project_id == project.id)
    models_stmt = (
        select(GeologicalModelOrm)
        .where(GeologicalModelOrm.app_project_id == project.id)
        .options(
            selectinload(GeologicalModelOrm.contacts),
            selectinload(GeologicalModelOrm.surfaces),
        )
    )
    sections_stmt = select(CrossSectionOrm).where(CrossSectionOrm.app_project_id == project.id)
    reviews_stmt = select(InvestigationReviewOrm).where(
        InvestigationReviewOrm.app_project_id == project.id
    )

    cpts = (await session.execute(cpts_stmt)).scalars().all()
    boreholes = (await session.execute(boreholes_stmt)).scalars().all()
    formations = (await session.execute(formations_stmt)).scalars().all()
    units = (await session.execute(units_stmt)).scalars().all()
    models = (await session.execute(models_stmt)).scalars().all()
    sections = (await session.execute(sections_stmt)).scalars().all()
    reviews = (await session.execute(reviews_stmt)).scalars().all()

    # v3 bundle. Every per-project decision rides along — the .gmproj
    # is the user's anchor, the DB is just a cache.
    bundle = {
        "format_version": 3,
        "project": _column_to_json(project, _SKIP_COLUMNS),
        "cpts": [_cpt_to_dict(c) for c in cpts],
        "boreholes": [_borehole_to_dict(b) for b in boreholes],
        "geological_formations": [_column_to_json(f, _SKIP_COLUMNS) for f in formations],
        "geotechnical_units": [_column_to_json(u, _SKIP_COLUMNS) for u in units],
        "geological_models": [_geological_model_to_dict(m) for m in models],
        "cross_sections": [_column_to_json(s, _SKIP_COLUMNS) for s in sections],
        "investigation_reviews": [_column_to_json(r, _SKIP_COLUMNS) for r in reviews],
    }
    logger.info(
        f"bundled project {project.id}: {len(cpts)} CPTs + {len(boreholes)} boreholes "
        f"+ {len(formations)} formations + {len(units)} geotech units "
        f"+ {len(models)} models + {len(sections)} sections "
        f"+ {len(reviews)} reviews"
    )
    return bundle


def _geological_model_to_dict(model: GeologicalModelOrm) -> dict[str, Any]:
    """Serialise a geological model with its formation contacts +
    cached TIN surfaces nested.

    Mirrors the rest of the bundle's nesting convention — child rows
    live under their parent (CPT.series, borehole.observations[]) — so
    restore is a single-level walk per top-level array.

    The cached surfaces ride along so opening a .strix on a fresh DB
    doesn't pay the recompute cost up front. The next contact mutation
    refreshes the cache anyway, but for a freshly-opened project the
    section view's slice query lands on already-computed geometry.
    """
    payload = _column_to_json(model, _SKIP_COLUMNS)
    payload["contacts"] = [_column_to_json(c, _SKIP_COLUMNS | {"model_id"}) for c in model.contacts]
    payload["surfaces"] = [_column_to_json(s, _SKIP_COLUMNS | {"model_id"}) for s in model.surfaces]
    return payload


# ---------------------------------------------------------------------------
# Restore-from-bundle entrypoint — used by POST /projects/{id}/restore.
# ---------------------------------------------------------------------------


def _make_location(
    location_x: float | None, location_y: float | None, epsg: int | None
) -> WKTElement | None:
    """Rebuild the PostGIS geometry from raw x/y/epsg.

    Returns ``None`` when any of the three is missing — matches the
    behaviour of the import pipeline (CPT / borehole rows can lack a
    usable EPSG and still be stored).
    """
    if location_x is None or location_y is None or epsg is None:
        return None
    return WKTElement(f"SRID={epsg};POINT({location_x} {location_y})")


def _build_cpt(data: dict[str, Any], app_project_id: UUID) -> CptOrm:
    series_payload = data.get("series")
    cpt_kwargs = _apply_json_to_kwargs(CptOrm, data)
    cpt = CptOrm(app_project_id=app_project_id, **cpt_kwargs)
    # WKTElement is accepted at column-set time by GeoAlchemy2 and rewritten
    # to a WKBElement during INSERT — mypy sees only the column's declared
    # WKBElement type so the assignment is cast through ``Any`` here.
    cpt.location = _make_location(cpt.location_x, cpt.location_y, cpt.epsg)  # type: ignore[assignment]
    if series_payload is not None:
        cpt.series = CptSeriesOrm(**_apply_json_to_kwargs(CptSeriesOrm, series_payload))
    return cpt


def _build_borehole(data: dict[str, Any], app_project_id: UUID) -> BoreholeOrm:
    drill_segments = data.get("drill_segments") or []
    field_log_intervals = data.get("field_log_intervals") or []
    observations = data.get("observations") or []
    samples = data.get("samples") or []

    bh_kwargs = _apply_json_to_kwargs(BoreholeOrm, data)
    bh = BoreholeOrm(app_project_id=app_project_id, **bh_kwargs)
    bh.location = _make_location(bh.location_x, bh.location_y, bh.epsg)  # type: ignore[assignment]

    # Local import to dodge circular references — each leaf class lives
    # alongside its own ORM module, and importing them at module top
    # would balloon the import graph for callers that never restore.
    from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
    from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
    from groundmodel.infrastructure.db.models.caco3_content_orm import CaCO3ContentOrm
    from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
    from groundmodel.infrastructure.db.models.field_log_interval_orm import (
        FieldLogIntervalOrm,
    )
    from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
    from groundmodel.infrastructure.db.models.organic_content_orm import OrganicContentOrm
    from groundmodel.infrastructure.db.models.scalar_lab_test_orm import ScalarLabTestOrm
    from groundmodel.infrastructure.db.models.water_content_orm import WaterContentOrm

    bh.drill_segments = [
        DrillSegmentOrm(**_apply_json_to_kwargs(DrillSegmentOrm, d)) for d in drill_segments
    ]
    bh.field_log_intervals = [
        FieldLogIntervalOrm(**_apply_json_to_kwargs(FieldLogIntervalOrm, d))
        for d in field_log_intervals
    ]
    bh.observations = [_build_observation(obs_data, AdmixtureOrm) for obs_data in observations]
    bh.samples = [
        _build_sample(
            sample_data,
            GrainSizeOrm,
            AtterbergLimitsOrm,
            CaCO3ContentOrm,
            OrganicContentOrm,
            WaterContentOrm,
            ScalarLabTestOrm,
        )
        for sample_data in samples
    ]
    return bh


def _build_observation(data: dict[str, Any], admixture_cls: type[Any]) -> ObservationOrm:
    layers_payload = data.get("layers") or []
    obs = ObservationOrm(**_apply_json_to_kwargs(ObservationOrm, data))
    obs.layers = [_build_layer(layer_data, admixture_cls) for layer_data in layers_payload]
    return obs


def _build_layer(data: dict[str, Any], admixture_cls: type[Any]) -> ObservationLayerOrm:
    admixtures_payload = data.get("admixtures") or []
    layer = ObservationLayerOrm(**_apply_json_to_kwargs(ObservationLayerOrm, data))
    layer.admixtures = [
        admixture_cls(**_apply_json_to_kwargs(admixture_cls, a)) for a in admixtures_payload
    ]
    return layer


def _build_sample(
    data: dict[str, Any],
    grain_size_cls: type[Any],
    atterberg_cls: type[Any],
    caco3_cls: type[Any],
    organic_cls: type[Any],
    water_cls: type[Any],
    scalar_cls: type[Any],
) -> SampleOrm:
    sample = SampleOrm(**_apply_json_to_kwargs(SampleOrm, data))
    sample.grain_sizes = [
        grain_size_cls(**_apply_json_to_kwargs(grain_size_cls, d))
        for d in data.get("grain_sizes") or []
    ]
    sample.atterberg_limits_tests = [
        atterberg_cls(**_apply_json_to_kwargs(atterberg_cls, d))
        for d in data.get("atterberg_limits_tests") or []
    ]
    sample.caco3_content_tests = [
        caco3_cls(**_apply_json_to_kwargs(caco3_cls, d))
        for d in data.get("caco3_content_tests") or []
    ]
    sample.organic_content_tests = [
        organic_cls(**_apply_json_to_kwargs(organic_cls, d))
        for d in data.get("organic_content_tests") or []
    ]
    sample.water_content_tests = [
        water_cls(**_apply_json_to_kwargs(water_cls, d))
        for d in data.get("water_content_tests") or []
    ]
    sample.scalar_lab_tests = [
        scalar_cls(**_apply_json_to_kwargs(scalar_cls, d))
        for d in data.get("scalar_lab_tests") or []
    ]
    return sample


async def restore_project_bundle(
    session: AsyncSession,
    project_id: UUID,
    project_payload: dict[str, Any],
    cpts_payload: list[dict[str, Any]],
    boreholes_payload: list[dict[str, Any]],
    geological_formations_payload: list[dict[str, Any]] | None = None,
    geological_models_payload: list[dict[str, Any]] | None = None,
    cross_sections_payload: list[dict[str, Any]] | None = None,
    investigation_reviews_payload: list[dict[str, Any]] | None = None,
    geotechnical_units_payload: list[dict[str, Any]] | None = None,
) -> ProjectOrm:
    """Idempotently materialise a project + every child collection from a bundle.

    Behaviour:

    * Project row missing → INSERT with the supplied id + metadata.
    * Project row present → return it as-is (don't mutate metadata; the
      DB version is authoritative when it exists).
    * Each CPT / borehole / formation / model / cross-section in the
      payload is inserted if its id is not already in the DB. Existing
      ids are skipped (no mutation). Idempotent across re-restores.
    * Formation contacts ride along with their parent model (nested
      under ``contacts`` in the payload).

    Backwards compatibility: every extra-tree kwarg defaults to ``None``
    so callers from older clients keep working — they just produce no
    rows for the missing sections.

    The ``project_id`` from the URL takes precedence over any id in the
    payload — that's what makes the endpoint URL-driven and prevents a
    crafted body from sneaking the wrong id past the router.
    """
    geological_formations_payload = geological_formations_payload or []
    geological_models_payload = geological_models_payload or []
    cross_sections_payload = cross_sections_payload or []
    investigation_reviews_payload = investigation_reviews_payload or []
    geotechnical_units_payload = geotechnical_units_payload or []
    # ---- Project shell ---------------------------------------------------
    result = await session.execute(select(ProjectOrm).where(ProjectOrm.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        kwargs = _apply_json_to_kwargs(ProjectOrm, project_payload)
        kwargs["id"] = project_id
        kwargs.pop("archived_at", None)  # restore brings the project back active
        project = ProjectOrm(**kwargs)
        session.add(project)
        await session.flush()
        logger.info(f"restored project shell {project_id}")
    else:
        logger.info(f"project {project_id} already exists — leaving metadata untouched")

    # ---- CPTs ------------------------------------------------------------
    existing_cpt_ids = set(
        (await session.execute(select(CptOrm.id).where(CptOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    new_cpts = 0
    total_cpts = len(cpts_payload)
    logger.info(f"restoring {total_cpts} cpt(s) for project {project_id}")
    skipped_cpts = 0
    for i, cpt_payload in enumerate(cpts_payload, start=1):
        cpt_id_raw = cpt_payload.get("id")
        if cpt_id_raw is None:
            # Bulk-loop DoD: log what was NOT restored + why, not just
            # the happy path — a silent `continue` hides malformed rows.
            logger.debug(f"[{i}/{total_cpts}] cpt skipped — payload has no id")
            skipped_cpts += 1
            continue
        cpt_id = UUID(cpt_id_raw) if isinstance(cpt_id_raw, str) else cpt_id_raw
        if cpt_id in existing_cpt_ids:
            logger.debug(f"[{i}/{total_cpts}] cpt {cpt_id} already present — skipped")
            skipped_cpts += 1
            continue
        session.add(_build_cpt(cpt_payload, project_id))
        new_cpts += 1
        logger.debug(f"[{i}/{total_cpts}] cpt {cpt_id} queued for insert")
    logger.info(
        f"cpt restore: {new_cpts} new, {skipped_cpts} skipped "
        f"(of {total_cpts}) for project {project_id}"
    )

    # ---- Boreholes -------------------------------------------------------
    existing_bh_ids = set(
        (
            await session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_boreholes = 0
    total_bh = len(boreholes_payload)
    logger.info(f"restoring {total_bh} borehole(s) for project {project_id}")
    skipped_bh = 0
    for i, bh_payload in enumerate(boreholes_payload, start=1):
        bh_id_raw = bh_payload.get("id")
        if bh_id_raw is None:
            logger.debug(f"[{i}/{total_bh}] borehole skipped — payload has no id")
            skipped_bh += 1
            continue
        bh_id = UUID(bh_id_raw) if isinstance(bh_id_raw, str) else bh_id_raw
        if bh_id in existing_bh_ids:
            logger.debug(f"[{i}/{total_bh}] borehole {bh_id} already present — skipped")
            skipped_bh += 1
            continue
        session.add(_build_borehole(bh_payload, project_id))
        new_boreholes += 1
        logger.debug(f"[{i}/{total_bh}] borehole {bh_id} queued for insert")
    logger.info(
        f"borehole restore: {new_boreholes} new, {skipped_bh} skipped "
        f"(of {total_bh}) for project {project_id}"
    )

    # ---- Geological formations -------------------------------------------
    # Formations are project-scoped (not nested under a model), so each
    # row carries its own id and is deduped against what the DB already
    # has for this project.
    existing_formation_ids = set(
        (
            await session.execute(
                select(GeologicalFormationOrm.id).where(
                    GeologicalFormationOrm.app_project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    new_formations = 0
    for f_payload in geological_formations_payload:
        f_id_raw = f_payload.get("id")
        if f_id_raw is None:
            continue
        f_id = UUID(f_id_raw) if isinstance(f_id_raw, str) else f_id_raw
        if f_id in existing_formation_ids:
            continue
        kwargs = _apply_json_to_kwargs(GeologicalFormationOrm, f_payload)
        kwargs["app_project_id"] = project_id
        session.add(GeologicalFormationOrm(**kwargs))
        new_formations += 1

    # ---- Geotechnical units ---------------------------------------------
    # Flat array — each row carries its own ``geological_formation_id`` so
    # the restore order is "formations first, then units", same as any
    # FK-respecting load. The session.flush below the loop materialises
    # the formation rows so the unit's FK lookup succeeds even on a
    # cold-restore (the formation was inserted three statements ago and
    # hasn't been flushed yet).
    existing_unit_ids = set(
        (
            await session.execute(
                select(GeotechnicalUnitOrm.id).where(
                    GeotechnicalUnitOrm.app_project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    new_units = 0
    for u_payload in geotechnical_units_payload:
        u_id_raw = u_payload.get("id")
        if u_id_raw is None:
            continue
        u_id = UUID(u_id_raw) if isinstance(u_id_raw, str) else u_id_raw
        if u_id in existing_unit_ids:
            continue
        kwargs = _apply_json_to_kwargs(GeotechnicalUnitOrm, u_payload)
        kwargs["app_project_id"] = project_id
        session.add(GeotechnicalUnitOrm(**kwargs))
        new_units += 1

    # ---- Geological models + their formation contacts --------------------
    existing_model_ids = set(
        (
            await session.execute(
                select(GeologicalModelOrm.id).where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    # Build the set of formation_ids actually present after restore
    # (formations just created in this transaction + formations that
    # already existed in the DB for this project). Contacts that
    # reference a formation_id NOT in this set are orphaned — typically
    # because an older save lost the formation row before the
    # "include-by-reference" save fix landed. Skipping them prevents
    # an FK-violation 500 and lets the rest of the file open.
    existing_formation_ids = set(
        (
            await session.execute(
                select(GeologicalFormationOrm.id).where(
                    GeologicalFormationOrm.app_project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    valid_formation_ids = existing_formation_ids | {
        UUID(f["id"]) if isinstance(f.get("id"), str) else f["id"]
        for f in geological_formations_payload
        if f.get("id") is not None
    }
    new_models = 0
    new_contacts = 0
    skipped_orphan_contacts = 0
    for m_payload in geological_models_payload:
        m_id_raw = m_payload.get("id")
        if m_id_raw is None:
            continue
        m_id = UUID(m_id_raw) if isinstance(m_id_raw, str) else m_id_raw
        if m_id in existing_model_ids:
            # Existing model wins (DB-authoritative when present). The
            # nested contacts are skipped wholesale rather than per-id —
            # mixing a live model with bundled contacts would silently
            # merge two interpretations.
            continue
        contacts_payload = m_payload.get("contacts") or []
        model_kwargs = _apply_json_to_kwargs(GeologicalModelOrm, m_payload)
        model_kwargs["app_project_id"] = project_id
        # Senior-review S6: ``kind`` is a plain VARCHAR with no DB CHECK.
        # A bundle from a future build (or a hand-edited .strix) with an
        # unknown kind would restore silently and then behave as
        # ``geological`` in the crossing validator
        # (``kind in NON_STRATIGRAPHIC_KINDS`` is False for an unknown
        # value). Coerce an unrecognised kind to the geological backbone
        # — the safe default (it KEEPS crossing validation rather than
        # silently disabling it) — and log it loudly.
        bundled_kind = model_kwargs.get("kind")
        if bundled_kind is not None and bundled_kind not in MODEL_KINDS:
            logger.warning(
                f"restore: model {m_id} has unknown kind "
                f"{bundled_kind!r} — coercing to 'geological'"
            )
            model_kwargs["kind"] = MODEL_KIND_GEOLOGICAL
        model = GeologicalModelOrm(**model_kwargs)
        valid_contacts: list[FormationContactOrm] = []
        for c in contacts_payload:
            fid_raw = c.get("formation_id")
            if fid_raw is None:
                skipped_orphan_contacts += 1
                continue
            fid = UUID(fid_raw) if isinstance(fid_raw, str) else fid_raw
            if fid not in valid_formation_ids:
                # Orphan reference — formation was lost from the
                # bundle (or never persisted) but the contact survived.
                # Skip rather than blow up the entire restore on a
                # foreign key violation.
                skipped_orphan_contacts += 1
                continue
            valid_contacts.append(
                FormationContactOrm(**_apply_json_to_kwargs(FormationContactOrm, c))
            )
        model.contacts = valid_contacts
        # Cached TIN surfaces ride along under each model in v3+
        # bundles. Older v3 saves (pre-surface-cache landing)
        # have no ``surfaces`` key — default to empty list, which
        # the next contact mutation refreshes via the recompute
        # hook. Skip surfaces whose formation_id isn't in the
        # restored set (mirror the orphan-contact tolerance).
        surfaces_payload = m_payload.get("surfaces") or []
        # Pre-count contacts per formation in this model so the
        # restored surface's claimed ``source_contact_count`` can be
        # sanity-checked against reality. A mismatch is the cheap
        # cross-bundle staleness signal — we don't need full checksum
        # recompute (which would require reloading anchors); a contact
        # count drift already proves the surface is out of date.
        contacts_per_formation: dict[UUID, int] = {}
        for c in valid_contacts:
            contacts_per_formation[c.formation_id] = (
                contacts_per_formation.get(c.formation_id, 0) + 1
            )
        valid_surfaces: list[FormationSurfaceOrm] = []
        forced_stale = 0
        for s in surfaces_payload:
            fid_raw = s.get("formation_id")
            if fid_raw is None:
                continue
            fid = UUID(fid_raw) if isinstance(fid_raw, str) else fid_raw
            if fid not in valid_formation_ids:
                continue
            kwargs = _apply_json_to_kwargs(FormationSurfaceOrm, s)
            # Bundle may have been saved before the ``is_stale``
            # column existed (older v3 saves) — default to False
            # via the column server-default. For bundles that DO
            # carry the field, trust it unless the contact count
            # disagrees with what we just restored — in that case
            # force is_stale=True. The user clicks Build to refresh.
            actual = contacts_per_formation.get(fid, 0)
            claimed = kwargs.get("source_contact_count")
            if claimed is not None and claimed != actual:
                kwargs["is_stale"] = True
                forced_stale += 1
            valid_surfaces.append(FormationSurfaceOrm(**kwargs))
        if forced_stale:
            logger.info(
                f"restore_project_bundle({project_id}): forced is_stale=True on "
                f"{forced_stale} surface(s) — restored contact count drifted from "
                f"saved source_contact_count"
            )
        model.surfaces = valid_surfaces
        session.add(model)
        new_models += 1
        new_contacts += len(valid_contacts)
    if skipped_orphan_contacts:
        logger.warning(
            f"restore_project_bundle({project_id}): skipped "
            f"{skipped_orphan_contacts} orphan-formation contacts "
            f"(missing formation row in bundle)"
        )

    # ---- Cross-sections --------------------------------------------------
    existing_section_ids = set(
        (
            await session.execute(
                select(CrossSectionOrm.id).where(CrossSectionOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_sections = 0
    for s_payload in cross_sections_payload:
        s_id_raw = s_payload.get("id")
        if s_id_raw is None:
            continue
        s_id = UUID(s_id_raw) if isinstance(s_id_raw, str) else s_id_raw
        if s_id in existing_section_ids:
            continue
        kwargs = _apply_json_to_kwargs(CrossSectionOrm, s_payload)
        kwargs["app_project_id"] = project_id
        session.add(CrossSectionOrm(**kwargs))
        new_sections += 1

    # ---- Investigation reviews -------------------------------------------
    # Per-(project, investigation) decisions. Dedup by id like the other
    # arrays; an existing row wins (DB-authoritative when present). The
    # target_kind/target_id pair is enforced unique at the DB level, so
    # two payloads for the same target would fail at commit — callers
    # shouldn't construct that case.
    #
    # Target-existence validation: the polymorphic anchor has no DB FK,
    # so a malformed (or hand-edited) bundle could otherwise plant a
    # review pointing at nothing. The PUT router does this check per
    # write; we mirror it here per-restore to keep both write surfaces
    # consistent. CPTs and boreholes were just inserted above (or
    # already existed), so the validation set is complete by this point.
    valid_cpt_ids = set(
        (await session.execute(select(CptOrm.id).where(CptOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    valid_borehole_ids = set(
        (
            await session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )

    existing_review_ids = set(
        (
            await session.execute(
                select(InvestigationReviewOrm.id).where(
                    InvestigationReviewOrm.app_project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    new_reviews = 0
    dropped_reviews = 0
    for r_payload in investigation_reviews_payload:
        r_id_raw = r_payload.get("id")
        if r_id_raw is None:
            continue
        r_id = UUID(r_id_raw) if isinstance(r_id_raw, str) else r_id_raw
        if r_id in existing_review_ids:
            continue
        # Target validation. Skip-with-warning beats raise so a single
        # bad row doesn't sabotage an otherwise valid bundle restore;
        # the dropped count surfaces in the log for the user to chase.
        target_kind = r_payload.get("target_kind")
        target_id_raw = r_payload.get("target_id")
        if target_kind is None or target_id_raw is None:
            dropped_reviews += 1
            continue
        target_id = UUID(target_id_raw) if isinstance(target_id_raw, str) else target_id_raw
        valid_targets = valid_cpt_ids if target_kind == "cpt" else valid_borehole_ids
        if target_id not in valid_targets:
            logger.warning(
                f"restore_project_bundle({project_id}): dropping orphan "
                f"review row {r_id} → {target_kind} {target_id} (target "
                f"not present in this project)"
            )
            dropped_reviews += 1
            continue
        kwargs = _apply_json_to_kwargs(InvestigationReviewOrm, r_payload)
        kwargs["app_project_id"] = project_id
        session.add(InvestigationReviewOrm(**kwargs))
        new_reviews += 1

    await session.flush()
    logger.info(
        f"restore_project_bundle({project_id}): "
        f"+{new_cpts} CPTs, +{new_boreholes} boreholes, "
        f"+{new_formations} formations, +{new_units} geotech units, "
        f"+{new_models} models (+{new_contacts} contacts), "
        f"+{new_sections} sections, "
        f"+{new_reviews} reviews ({dropped_reviews} dropped as orphan)"
    )
    return project
