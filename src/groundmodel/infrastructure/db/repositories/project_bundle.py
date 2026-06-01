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
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.api.schemas.project.project_bundle import BUNDLE_FORMAT_VERSION


class BundleIntegrityError(ValueError):
    """Raised when a bundle would be (or is) internally inconsistent.

    Catches the class of bug that wiped 833 accepted layers in the
    2026-05-31 dogfeed: the export query missed 19 litho-instance
    formations even though contacts/layers referenced them, so the
    file was self-inconsistent. A later revert-to-last-save restored
    from this broken file, dropping every dependent row as an orphan.

    Two callers raise this:

    * ``build_project_bundle`` — refuses to write a bundle where any
      contact/layer/unit references a formation_id that does not
      exist in the DB (cannot be recovered for inclusion in the
      export).
    * ``restore_project_bundle`` in ``replace=True`` mode — refuses
      to wipe the existing DB children when the inbound bundle would
      orphan any contacts/layers because formation_ids referenced by
      them are missing from the bundle's formation list. The non-
      replace path stays tolerant so legacy bundles still open.

    Inherits from ValueError so the project router's existing
    ``except (ValueError, KeyError, TypeError)`` 400 conversion picks
    it up automatically — callers see a clear message instead of a
    500.
    """


from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm

# Legacy aliases used by residual references in the restore path (lens shapes /
# nodes sections still use the old names internally — renamed in slice 4).
LithoLensOrm = BodyOrm
LithoLensShapeOrm = BodyBoundaryShapeOrm
LithoLensBoundaryNodeOrm = BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
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
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.constants.model_kind import (
    MODEL_KIND_GEOLOGICAL,
    MODEL_KIND_LITHOSTRATIGRAPHIC,
    MODEL_KINDS,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Columns dropped on serialise + restore. Timestamps are server-defaults;
# geometry is rebuilt from x/y/epsg. ``archived_at`` is by-design active
# on restore — see module docstring.
_SKIP_COLUMNS = frozenset({"created_at", "updated_at", "archived_at", "location"})

# Restore-boundary caps for FormationSurface TIN blobs (debt #19). The
# .strix bundle's ``vertices`` / ``triangles`` JSONB arrays are deserialised
# straight into PostgreSQL with no inherent bound — a malicious or
# accidentally-oversized bundle could OOM the asyncio process or balloon a
# DB row. A real v1 TIN is a few KB; even a Phase-5 kriging surface stays
# well under these. Over the cap → blank the geometry + force is_stale so
# the user rebuilds (the surface row survives; only the runaway blob is
# dropped). Folds into debt #5 (tamper hardening) — same trigger.
_MAX_SURFACE_SOURCE_CONTACTS = 50_000
_MAX_TIN_ARRAY_LEN = 200_000

# Debt #48: the module-level `logger = LoggerFactory.get_logger(__name__)`
# is gone. Logging now flows through `ProjectBundleService(GroundModelLogger)`
# (defined below) so every entry-point inherits the typed logger surface
# via `self.X(...)`, per CLAUDE.md's "logging via inheritance" rule. The
# existing `_build_project_bundle_impl` / `_restore_project_bundle_impl`
# functions take `logger: GroundModelLogger` as a parameter — Python's
# LEGB resolution picks up the parameter wherever the body says
# `logger.X(...)`, so the bodies are unchanged.


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


async def _build_project_bundle_impl(
    session: AsyncSession,
    project: ProjectOrm,
    logger: GroundModelLogger,
) -> dict[str, Any]:
    """Return a fully serialised snapshot of a project + every child.

    The project row is passed in (already loaded by the caller).
    Children are eager-loaded here in one batch each — same pattern as
    ``ProjectRepository.duplicate``.

    The output is a plain ``dict`` (no Pydantic) — FastAPI serialises it
    to JSON via the default encoder. Floats / ints / strings / lists /
    nested dicts all pass through; UUIDs and dates were already
    flattened to strings inside the per-table helpers.

    Debt #48: ``logger`` is passed in (typically as the
    ``ProjectBundleService`` instance) so every log line carries the
    service's `self` surface — the module no longer holds a free-
    standing module-level logger.
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
            # A4 — litho layers ride alongside contacts on each model.
            # Geological models always have an empty layer set (the
            # litho_layer XOR CHECK plus the trigger's kind gate make
            # this an invariant), so the eager load is cheap there
            # and load-bearing for litho models.
            selectinload(GeologicalModelOrm.litho_layers),
        )
    )
    sections_stmt = select(CrossSectionOrm).where(CrossSectionOrm.app_project_id == project.id)
    reviews_stmt = select(InvestigationReviewOrm).where(
        InvestigationReviewOrm.app_project_id == project.id
    )
    # Litho lens metadata rows (#101 R4 Position 4).  Slim rows: id, model_id,
    # formation_id, body_ordinal, name, primary_section_id.
    # app_project_id is declared on the lens table so we scope directly.
    lenses_stmt = select(LithoLensOrm).where(LithoLensOrm.app_project_id == project.id)
    # Formation absence records (#101 R4 Position 4).  Scoped via
    # geological_formation → project (formation carries app_project_id).
    absences_stmt = (
        select(FormationAbsenceOrm)
        .join(
            GeologicalFormationOrm,
            FormationAbsenceOrm.formation_id == GeologicalFormationOrm.id,
        )
        .where(GeologicalFormationOrm.app_project_id == project.id)
    )
    # Contact-level correlation edges (#133 Phase 2+3).  Scoped through
    # geological_model — the edge table has no direct app_project_id column.
    # Both contact FK endpoints are owned by the same model so model_id is
    # the correct scope anchor.
    contact_edges_stmt = (
        select(LithoContactCorrelationEdgeOrm)
        .join(
            GeologicalModelOrm,
            LithoContactCorrelationEdgeOrm.model_id == GeologicalModelOrm.id,
        )
        .where(GeologicalModelOrm.app_project_id == project.id)
    )
    # Lens boundary shapes + nodes (#163f Slice 2). Scoped through
    # geological_model (the shape carries model_id; nodes hang off the shape).
    lens_shapes_stmt = (
        select(LithoLensShapeOrm)
        .join(GeologicalModelOrm, LithoLensShapeOrm.model_id == GeologicalModelOrm.id)
        .where(GeologicalModelOrm.app_project_id == project.id)
    )
    lens_boundary_nodes_stmt = (
        select(LithoLensBoundaryNodeOrm)
        .join(LithoLensShapeOrm, LithoLensBoundaryNodeOrm.shape_id == LithoLensShapeOrm.id)
        .join(GeologicalModelOrm, LithoLensShapeOrm.model_id == GeologicalModelOrm.id)
        .where(GeologicalModelOrm.app_project_id == project.id)
    )

    cpts = (await session.execute(cpts_stmt)).scalars().all()
    boreholes = (await session.execute(boreholes_stmt)).scalars().all()
    formations = (await session.execute(formations_stmt)).scalars().all()
    units = (await session.execute(units_stmt)).scalars().all()
    models = (await session.execute(models_stmt)).scalars().all()
    sections = (await session.execute(sections_stmt)).scalars().all()
    reviews = (await session.execute(reviews_stmt)).scalars().all()
    lenses = (await session.execute(lenses_stmt)).scalars().all()
    absences = (await session.execute(absences_stmt)).scalars().all()
    contact_edges = (await session.execute(contact_edges_stmt)).scalars().all()
    lens_shapes = (await session.execute(lens_shapes_stmt)).scalars().all()
    lens_boundary_nodes = (await session.execute(lens_boundary_nodes_stmt)).scalars().all()

    # ---- Integrity check + auto-recovery (2026-05-31 dogfeed fix). ------
    # Collect every formation_id referenced by a contact / litho_layer /
    # geotechnical unit on this project. The export query for formations
    # scopes by ``app_project_id``; if a referenced formation lives
    # outside that scope (a resolver-instance row whose app_project_id
    # drifted, or any other historical leak) the query misses it. The
    # bundle then ships layers whose formation_ids point at rows that
    # aren't in the bundle, and the next restore drops every dependent
    # row as an orphan. Recover by globally re-fetching the missing ids;
    # if any are truly absent from the DB, refuse to write the corrupt
    # bundle so the user sees the error at save time, not at restore.
    referenced_fids: set[UUID] = set()
    for model in models:
        for contact in model.contacts:
            referenced_fids.add(contact.formation_id)
        for layer in model.litho_layers:
            referenced_fids.add(layer.formation_id)
    for unit in units:
        fid = getattr(unit, "formation_id", None)
        if fid is not None:
            referenced_fids.add(fid)
    emitted_fids = {f.id for f in formations}
    missing_fids = referenced_fids - emitted_fids
    if missing_fids:
        extra_rows = list(
            (
                await session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.id.in_(missing_fids)
                    )
                )
            )
            .scalars()
            .all()
        )
        found_fids = {f.id for f in extra_rows}
        still_missing = missing_fids - found_fids
        if still_missing:
            sample = sorted(str(i) for i in list(still_missing)[:5])
            raise BundleIntegrityError(
                f"Bundle export refused for project {project.id}: "
                f"{len(still_missing)} formation(s) referenced by "
                f"layers/contacts/units do not exist in the DB and cannot "
                f"be included in the bundle. Writing this file would "
                f"silently drop the dependent rows on the next restore. "
                f"Sample missing formation ids: {sample}."
            )
        logger.warning(
            f"bundle export: recovered {len(extra_rows)} formation(s) "
            f"referenced by layers/contacts/units that were missing from "
            f"the project-scope query (schema drift — investigate). "
            f"Sample recovered ids: "
            f"{sorted(str(f.id) for f in extra_rows)[:3]}"
        )
        formations = list(formations) + extra_rows

    # v4 bundle. Every per-project decision rides along — the .gmproj
    # is the user's anchor, the DB is just a cache. v4 adds the
    # ``litho_layers`` array under each model payload (Shape A — A4 of
    # the unified litho boundary model).

    bundle = {
        "format_version": BUNDLE_FORMAT_VERSION,
        "project": _column_to_json(project, _SKIP_COLUMNS),
        "cpts": [_cpt_to_dict(c) for c in cpts],
        "boreholes": [_borehole_to_dict(b) for b in boreholes],
        "geological_formations": [_column_to_json(f, _SKIP_COLUMNS) for f in formations],
        "geotechnical_units": [_column_to_json(u, _SKIP_COLUMNS) for u in units],
        "geological_models": [_geological_model_to_dict(m) for m in models],
        "cross_sections": [_column_to_json(s, _SKIP_COLUMNS) for s in sections],
        "investigation_reviews": [_column_to_json(r, _SKIP_COLUMNS) for r in reviews],
        # Body rows (slice 4.1 rename from litho_lenses). Each row carries the
        # full BodyOrm column set: id, model_id, formation_id, body_ordinal,
        # source_investigation_id, name, primary_section_id, and the six extent
        # columns (extent_left/right_kind / target_contact_id / neighbour_inv_id).
        # formation_absences carries (formation_id, investigation_kind,
        # investigation_id, source). Bundles saved before these fields existed
        # open cleanly via the schema's default_factory=list.
        "bodies": [_column_to_json(lens, _SKIP_COLUMNS) for lens in lenses],
        "formation_absences": [_column_to_json(a, _SKIP_COLUMNS) for a in absences],
        # Contact-level correlation edges (#133 Phase 2+3). Each row carries
        # (model_id, contact_a_id, contact_b_id, source, user_approved).
        # Additive field: bundles saved before this field existed open cleanly
        # via the schema's default_factory=list.
        "litho_contact_correlation_edges": [
            _column_to_json(ce, _SKIP_COLUMNS) for ce in contact_edges
        ],
        # Lens boundary shapes + control nodes (#163f Slice 2). Shapes carry
        # (model_id, body_id, render_style); nodes carry (shape_id,
        # boundary, node_index, along_m, elevation_m). Additive — bundles saved
        # before these existed open cleanly via default_factory=list.
        "litho_lens_shapes": [_column_to_json(s, _SKIP_COLUMNS) for s in lens_shapes],
        "litho_lens_boundary_nodes": [
            _column_to_json(n, _SKIP_COLUMNS) for n in lens_boundary_nodes
        ],
    }
    logger.info(
        f"bundled project {project.id}: {len(cpts)} CPTs + {len(boreholes)} boreholes "
        f"+ {len(formations)} formations + {len(units)} geotech units "
        f"+ {len(models)} models + {len(sections)} sections "
        f"+ {len(reviews)} reviews + {len(contact_edges)} litho contact correlation edges "
        f"+ {len(lenses)} bodies + {len(absences)} formation absences"
    )
    return bundle


def _geological_model_to_dict(model: GeologicalModelOrm) -> dict[str, Any]:
    """Serialise a geological model with its formation contacts +
    cached TIN surfaces + (litho models only) litho_layers nested.

    Mirrors the rest of the bundle's nesting convention — child rows
    live under their parent (CPT.series, borehole.observations[]) — so
    restore is a single-level walk per top-level array.

    The cached surfaces ride along so opening a .strix on a fresh DB
    doesn't pay the recompute cost up front. The next contact mutation
    refreshes the cache anyway, but for a freshly-opened project the
    section view's slice query lands on already-computed geometry.

    Litho models carry only ``litho_layers`` — the Shape A primitives
    (id, formation_id, anchor, depth_top_m, depth_base_m, status,
    source, confidence, ...) are the source of truth post-A3. The
    ``contacts`` field is emitted as an empty list for litho models
    (A4 slice 4c) — formation_contact stays populated in the DB as a
    legacy mirror via the LL→FC trigger, but the bundle no longer
    duplicates the data. On restore the LL→FC trigger fires per
    accepted-layer INSERT and rebuilds the FC mirror, so a fresh v4
    bundle opens cleanly on a wiped DB without contact rows in the
    payload.

    Geological models keep the historical ``contacts`` shape (the
    geological axis never grew Shape A) and always emit an empty
    ``litho_layers`` (the litho_layer XOR CHECK + the trigger's kind
    gate make this an invariant), so v4 readers can branch on
    model.kind safely.

    Older v4 bundles that DID emit ``contacts`` on litho models still
    restore — the explicit FC inserts run via the legacy path, the
    FC→LL trigger UPSERTs the matching LL rows. The slice-1 de-dupe
    rule (skip explicit LL INSERT when the layer's id is in the
    contacts payload) handles the overlap.
    """
    payload = _column_to_json(model, _SKIP_COLUMNS)
    if model.kind == MODEL_KIND_LITHOSTRATIGRAPHIC:
        # Shape A native: layers are the truth, contacts are derived
        # via the trigger and don't ride along in the bundle.
        payload["contacts"] = []
    else:
        payload["contacts"] = [
            _column_to_json(c, _SKIP_COLUMNS | {"model_id"}) for c in model.contacts
        ]
    payload["surfaces"] = [_column_to_json(s, _SKIP_COLUMNS | {"model_id"}) for s in model.surfaces]
    payload["litho_layers"] = [
        _column_to_json(layer, _SKIP_COLUMNS | {"model_id"}) for layer in model.litho_layers
    ]
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


async def _wipe_project_scoped_rows(
    session: AsyncSession,
    project_id: UUID,
    *,
    logger: GroundModelLogger,
) -> None:
    """Delete every project-scoped CHILD collection, keeping the project shell.

    Backs replace-restore (revert-to-last-save, debt #160): after the wipe the
    idempotent restore insert re-materialises the whole bundle against an empty
    project, so a close-without-save reverts creates, mutations, AND deletes.

    Order is FK-safe and relies on the verified DB-level ``ON DELETE CASCADE``
    map (bulk ``delete()`` fires DB cascades, not ORM-relationship cascades):

    * ``geological_model`` is deleted by ``kind`` — geotechnical →
      lithostratigraphic → geological — because ``parent_geological_model_id``
      is ``ON DELETE RESTRICT`` (a child model pins its parent). Each model
      delete CASCADEs to its formation contacts, contact-correlation edges,
      lens metadata, and lens shapes (→ boundary nodes).
    * ``geological_formation`` next — CASCADEs to any remaining formation
      contacts, geotechnical units, formation absences, and formation-scoped
      lens rows.
    * ``cross_section`` / ``investigation_review`` / ``cpt`` / ``borehole`` are
      independent project-scoped roots; deleting a cpt/borehole CASCADEs to its
      series / child tree and to contacts anchored on it.

    The project row itself is preserved — metadata revert is handled by the
    separate metadata two-stage-save model. Runs in the caller's session;
    wipe + insert + the caller's single commit are atomic.

    Parameters
    ----------
    session
        Async session whose transaction also carries the subsequent insert.
    project_id
        Project whose child collections are removed.
    logger
        Logger for the phase-summary line.
    """
    for kind in ("geotechnical", "lithostratigraphic", "geological"):
        await session.execute(
            delete(GeologicalModelOrm).where(
                GeologicalModelOrm.app_project_id == project_id,
                GeologicalModelOrm.kind == kind,
            )
        )
    await session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == project_id)
    )
    await session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == project_id)
    )
    await session.execute(
        delete(InvestigationReviewOrm).where(InvestigationReviewOrm.app_project_id == project_id)
    )
    await session.execute(delete(CptOrm).where(CptOrm.app_project_id == project_id))
    await session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await session.flush()
    logger.info(f"replace-restore: wiped project-scoped rows for project {project_id}")


async def _restore_project_bundle_impl(
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
    bodies_payload: list[dict[str, Any]] | None = None,
    formation_absences_payload: list[dict[str, Any]] | None = None,
    litho_contact_correlation_edges_payload: list[dict[str, Any]] | None = None,
    litho_lens_shapes_payload: list[dict[str, Any]] | None = None,
    litho_lens_boundary_nodes_payload: list[dict[str, Any]] | None = None,
    *,
    logger: GroundModelLogger,
    replace: bool = False,
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
    bodies_payload = bodies_payload or []
    formation_absences_payload = formation_absences_payload or []
    litho_contact_correlation_edges_payload = litho_contact_correlation_edges_payload or []
    litho_lens_shapes_payload = litho_lens_shapes_payload or []
    litho_lens_boundary_nodes_payload = litho_lens_boundary_nodes_payload or []
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

    # ---- Replace mode: wipe child collections before re-inserting --------
    # Revert-to-last-save (debt #160). Runs after the project shell is
    # resolved (kept) and before any insert, in this same transaction, so the
    # net effect is "project's children == the bundle exactly".
    if replace:
        # Pre-wipe integrity guard (2026-05-31 dogfeed fix). When the inbound
        # bundle is self-inconsistent (layers/contacts reference formation_ids
        # not in the bundle's formation array), the post-wipe insert silently
        # drops those rows as orphans. The non-replace open-from-file path
        # stays tolerant on purpose so legacy bundles still open; the
        # destructive ``replace`` path must NOT wipe valid DB state to make
        # room for a broken file. Counting orphans up front lets the user see
        # an actionable error instead of "all my data is gone".
        bundle_fids: set[UUID] = set()
        for f_payload in geological_formations_payload:
            fid_raw = f_payload.get("id")
            if fid_raw is None:
                continue
            bundle_fids.add(UUID(fid_raw) if isinstance(fid_raw, str) else fid_raw)

        def _ref_fid(raw: object) -> UUID | None:
            if raw is None:
                return None
            return UUID(raw) if isinstance(raw, str) else raw  # type: ignore[return-value]

        orphan_layer_count = 0
        orphan_contact_count = 0
        orphan_fids: set[UUID] = set()
        for m_payload in geological_models_payload:
            for c in m_payload.get("contacts") or []:
                fid = _ref_fid(c.get("formation_id"))
                if fid is not None and fid not in bundle_fids:
                    orphan_contact_count += 1
                    orphan_fids.add(fid)
            for layer in m_payload.get("litho_layers") or []:
                fid = _ref_fid(layer.get("formation_id"))
                if fid is not None and fid not in bundle_fids:
                    orphan_layer_count += 1
                    orphan_fids.add(fid)
        for u_payload in geotechnical_units_payload:
            fid = _ref_fid(u_payload.get("formation_id"))
            if fid is not None and fid not in bundle_fids:
                orphan_fids.add(fid)
        if orphan_fids:
            sample = sorted(str(i) for i in list(orphan_fids)[:5])
            raise BundleIntegrityError(
                f"Replace-restore refused for project {project_id}: bundle "
                f"is self-inconsistent. "
                f"{orphan_layer_count} litho layer(s) and "
                f"{orphan_contact_count} formation contact(s) reference "
                f"{len(orphan_fids)} formation id(s) not present in the "
                f"bundle's geological_formations array. Wiping the DB to "
                f"match this bundle would silently drop those rows. "
                f"Sample missing formation ids: {sample}."
            )
        await _wipe_project_scoped_rows(session, project_id, logger=logger)

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
        oversized_surfaces = 0
        for s in surfaces_payload:
            fid_raw = s.get("formation_id")
            if fid_raw is None:
                continue
            fid = UUID(fid_raw) if isinstance(fid_raw, str) else fid_raw
            if fid not in valid_formation_ids:
                continue
            kwargs = _apply_json_to_kwargs(FormationSurfaceOrm, s)
            # Debt #19: cap the untrusted TIN blobs at the restore
            # boundary. A claimed source_contact_count, or a vertices /
            # triangles array, beyond the sane ceiling is treated as
            # corrupt/hostile — keep the surface row but blank the
            # geometry and force is_stale so the user rebuilds, rather
            # than letting an unbounded JSONB array reach PostgreSQL and
            # OOM the asyncio process.
            verts = kwargs.get("vertices") or []
            tris = kwargs.get("triangles") or []
            claimed_count = kwargs.get("source_contact_count")
            if (
                (claimed_count is not None and claimed_count > _MAX_SURFACE_SOURCE_CONTACTS)
                or len(verts) > _MAX_TIN_ARRAY_LEN
                or len(tris) > _MAX_TIN_ARRAY_LEN
            ):
                logger.warning(
                    f"restore_project_bundle({project_id}): surface for "
                    f"formation {fid} exceeds size caps "
                    f"(claimed={claimed_count}, verts={len(verts)}, "
                    f"tris={len(tris)}) — geometry dropped, is_stale forced"
                )
                kwargs["vertices"] = []
                kwargs["triangles"] = []
                kwargs["is_stale"] = True
                oversized_surfaces += 1
                valid_surfaces.append(FormationSurfaceOrm(**kwargs))
                continue
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
        if oversized_surfaces:
            logger.warning(
                f"restore_project_bundle({project_id}): dropped geometry on "
                f"{oversized_surfaces} surface(s) exceeding the bundle TIN size "
                f"caps (debt #19) — is_stale forced, rebuild required"
            )
        model.surfaces = valid_surfaces
        # A4 — Shape A litho layers ride alongside contacts on each
        # model. v4 bundles emit them explicitly; v3 bundles do not,
        # so the default-empty payload list is correct for the legacy
        # case (the FC→LL mirror trigger materialises layers from the
        # contacts that follow).
        #
        # Coexistence rule for v4 restore:
        # * For every accepted layer there's a matching FormationContact
        #   in ``contacts_payload`` with the same id. The FC→LL trigger
        #   creates the layer row when the contact INSERTs (status =
        #   'accepted'), so we MUST NOT also INSERT the same id
        #   explicitly — that would conflict on the pkey. We skip
        #   those and let the trigger do the work.
        # * For pending / rejected layers there's no matching FC
        #   (only accepted boundaries land in formation_contact). The
        #   trigger never touches those rows, so we INSERT them
        #   explicitly to preserve status.
        layers_payload = m_payload.get("litho_layers") or []
        contact_ids_in_payload = {
            UUID(c["id"]) if isinstance(c.get("id"), str) else c["id"]
            for c in contacts_payload
            if c.get("id") is not None
        }
        valid_layers: list[LithoLayerOrm] = []
        skipped_orphan_layers = 0
        skipped_layers_with_matching_fc = 0
        for layer_payload in layers_payload:
            fid_raw = layer_payload.get("formation_id")
            if fid_raw is None:
                skipped_orphan_layers += 1
                continue
            fid = UUID(fid_raw) if isinstance(fid_raw, str) else fid_raw
            if fid not in valid_formation_ids:
                skipped_orphan_layers += 1
                continue
            lid_raw = layer_payload.get("id")
            lid = UUID(lid_raw) if isinstance(lid_raw, str) else lid_raw
            if lid in contact_ids_in_payload:
                # Trigger handles it via the contact INSERT.
                skipped_layers_with_matching_fc += 1
                continue
            valid_layers.append(
                LithoLayerOrm(**_apply_json_to_kwargs(LithoLayerOrm, layer_payload))
            )
        model.litho_layers = valid_layers
        if skipped_orphan_layers:
            logger.warning(
                f"restore_project_bundle({project_id}): skipped "
                f"{skipped_orphan_layers} orphan-formation litho layers "
                f"(missing formation row in bundle)"
            )
        if skipped_layers_with_matching_fc:
            logger.debug(
                f"restore_project_bundle({project_id}): skipped explicit "
                f"INSERT for {skipped_layers_with_matching_fc} layers — "
                f"FC→LL trigger materialises them from contact INSERTs"
            )
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

    # ---- Litho correlation edges (Phase 2) ----------------------------------
    # Restored AFTER geological_models exist (their model_id FK must resolve).
    # The edge table has no app_project_id column; we scope the existence
    # check through the model ids that belong to this project.  This also
    # acts as the bundle-injection guard: an edge whose model_id isn't in
    # this project's model set is silently dropped rather than raising an FK
    # violation (a crafted or merged bundle can't plant foreign edges).
    #
    # Correlations are MODEL-level, not section-level.  This restore block
    # does NOT touch seeded_formation_contact_ids on any cross-section row —
    # structural proof that the #57/applyUpdatedSection trap cannot recur here.
    valid_model_ids_for_edges = set(
        (
            await session.execute(
                select(GeologicalModelOrm.id).where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    # ---- Bodies (slice 4.1 — replaces litho_lenses) --------------------------
    # Restored AFTER geological_models (body.model_id FK) and formations
    # (body.formation_id FK).  Each body row carries app_project_id directly.
    #
    # Extent guards (slice 4.1): for extent_<side>_kind == 'to_target' the
    # target_contact_id must resolve to a formation_contact row belonging to
    # this project; for 'pinch_out_halfway' / 'extrapolated' the
    # neighbour_inv_id must resolve to a CPT or borehole in this project.
    # 'open' and NULL kinds require no extra check.  Unresolvable extents are
    # stripped (set to NULL) rather than dropping the whole body — losing the
    # extent hint is less destructive than losing the body entirely.
    #
    # source_investigation_id guard: if the polymorphic investigation id does
    # not resolve to any CPT or borehole in this project, the body is dropped
    # with a warning (consistent with today's drop-orphan pattern).
    valid_investigation_ids = valid_cpt_ids | valid_borehole_ids
    # Also include investigations that were queued in this transaction
    # (payload walks) but not yet flushed.
    for cpt_payload in cpts_payload:
        cpt_id_raw = cpt_payload.get("id")
        if cpt_id_raw is not None:
            valid_investigation_ids.add(
                UUID(cpt_id_raw) if isinstance(cpt_id_raw, str) else cpt_id_raw
            )
    for bh_p in boreholes_payload:
        bh_id_raw = bh_p.get("id")
        if bh_id_raw is not None:
            valid_investigation_ids.add(
                UUID(bh_id_raw) if isinstance(bh_id_raw, str) else bh_id_raw
            )
    # Build the set of formation_contact ids already in the DB for this
    # project — used to validate 'to_target' extents without a flush.
    valid_contact_ids_for_bodies: set[UUID] = set(
        (
            await session.execute(
                select(FormationContactOrm.id)
                .join(GeologicalModelOrm, FormationContactOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    # Include contacts that were queued in this transaction (nested in models).
    for m_payload in geological_models_payload:
        for c in m_payload.get("contacts") or []:
            c_id_raw = c.get("id")
            if c_id_raw is not None:
                valid_contact_ids_for_bodies.add(
                    UUID(c_id_raw) if isinstance(c_id_raw, str) else c_id_raw
                )

    existing_lens_ids = set(
        (await session.execute(select(BodyOrm.id).where(BodyOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    new_lenses = 0
    skipped_lenses = 0
    dropped_lenses = 0
    total_lenses = len(bodies_payload)
    logger.info(f"restore_project_bundle({project_id}): restoring {total_lenses} body/bodies")
    for i, lens_payload in enumerate(bodies_payload, start=1):
        lens_id_raw = lens_payload.get("id")
        if lens_id_raw is None:
            logger.debug(f"[{i}/{total_lenses}] body skipped — payload has no id")
            skipped_lenses += 1
            continue
        lens_id = UUID(lens_id_raw) if isinstance(lens_id_raw, str) else lens_id_raw
        if lens_id in existing_lens_ids:
            logger.debug(f"[{i}/{total_lenses}] body {lens_id} already present — skipped")
            skipped_lenses += 1
            continue
        # Bundle-injection guard: model must belong to this project.
        model_id_raw = lens_payload.get("model_id")
        if model_id_raw is None:
            logger.warning(f"[{i}/{total_lenses}] body {lens_id} has no model_id — dropped")
            dropped_lenses += 1
            continue
        model_id = UUID(model_id_raw) if isinstance(model_id_raw, str) else model_id_raw
        if model_id not in valid_model_ids_for_edges:
            logger.warning(
                f"[{i}/{total_lenses}] body {lens_id} → model {model_id} "
                f"not in this project — dropped (bundle-injection guard)"
            )
            dropped_lenses += 1
            continue
        # Formation FK guard.
        pf_raw = lens_payload.get("formation_id")
        if pf_raw is None:
            logger.warning(f"[{i}/{total_lenses}] body {lens_id} missing formation_id — dropped")
            dropped_lenses += 1
            continue
        pf_id = UUID(pf_raw) if isinstance(pf_raw, str) else pf_raw
        if pf_id not in valid_formation_ids:
            logger.warning(
                f"[{i}/{total_lenses}] body {lens_id}: formation_id {pf_id} "
                f"not present in this project — dropped (dangling FK)"
            )
            dropped_lenses += 1
            continue
        # source_investigation_id guard: the polymorphic investigation must
        # exist in this project's CPT or borehole set.
        src_inv_raw = lens_payload.get("source_investigation_id")
        if src_inv_raw is None:
            logger.warning(
                f"[{i}/{total_lenses}] body {lens_id} missing source_investigation_id — dropped"
            )
            dropped_lenses += 1
            continue
        src_inv_id = UUID(src_inv_raw) if isinstance(src_inv_raw, str) else src_inv_raw
        if src_inv_id not in valid_investigation_ids:
            logger.warning(
                f"[{i}/{total_lenses}] body {lens_id}: source_investigation_id {src_inv_id} "
                f"not in this project's CPTs/boreholes — dropped (dangling polymorphic FK)"
            )
            dropped_lenses += 1
            continue
        # Extent integrity: strip unresolvable extents rather than dropping
        # the whole body — losing an extent hint is less destructive than
        # losing the body. 'open' and NULL kinds need no FK check.
        _EXTENT_SIDES = ("left", "right")
        _TARGET_KINDS = frozenset({"to_target"})
        _NEIGHBOUR_KINDS = frozenset({"pinch_out_halfway", "extrapolated"})
        kwargs = _apply_json_to_kwargs(BodyOrm, lens_payload)
        for side in _EXTENT_SIDES:
            kind_key = f"extent_{side}_kind"
            target_key = f"extent_{side}_target_contact_id"
            neighbour_key = f"extent_{side}_neighbour_inv_id"
            extent_kind = kwargs.get(kind_key)
            if extent_kind in _TARGET_KINDS:
                target_raw = kwargs.get(target_key)
                if target_raw is None:
                    logger.warning(
                        f"[{i}/{total_lenses}] body {lens_id}: {kind_key}='to_target' "
                        f"but {target_key} is NULL — stripping extent"
                    )
                    kwargs[kind_key] = None
                    kwargs[target_key] = None
                else:
                    target_id = UUID(target_raw) if isinstance(target_raw, str) else target_raw
                    if target_id not in valid_contact_ids_for_bodies:
                        logger.warning(
                            f"[{i}/{total_lenses}] body {lens_id}: {target_key} {target_id} "
                            f"not in this project's contacts — stripping extent"
                        )
                        kwargs[kind_key] = None
                        kwargs[target_key] = None
            elif extent_kind in _NEIGHBOUR_KINDS:
                nbr_raw = kwargs.get(neighbour_key)
                if nbr_raw is None:
                    logger.warning(
                        f"[{i}/{total_lenses}] body {lens_id}: {kind_key}={extent_kind!r} "
                        f"but {neighbour_key} is NULL — stripping extent"
                    )
                    kwargs[kind_key] = None
                else:
                    nbr_id = UUID(nbr_raw) if isinstance(nbr_raw, str) else nbr_raw
                    if nbr_id not in valid_investigation_ids:
                        logger.warning(
                            f"[{i}/{total_lenses}] body {lens_id}: {neighbour_key} {nbr_id} "
                            f"not in this project's investigations — stripping extent"
                        )
                        kwargs[kind_key] = None
                        kwargs[neighbour_key] = None
        kwargs["app_project_id"] = project_id
        session.add(BodyOrm(**kwargs))
        existing_lens_ids.add(lens_id)
        new_lenses += 1
        logger.debug(f"[{i}/{total_lenses}] body {lens_id} queued for insert")
    if dropped_lenses:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped_lenses} "
            f"body/bodies (model/formation/investigation not in project or missing FK)"
        )

    # ---- Formation absences (Position 4) -----------------------------------
    # Restored AFTER geological formations (absence.formation_id FK must
    # resolve).  ``valid_formation_ids`` was populated during the formation
    # restore section above and covers both pre-existing and freshly-queued
    # formation ids.
    existing_absence_ids = set(
        (
            await session.execute(
                select(FormationAbsenceOrm.id)
                .join(
                    GeologicalFormationOrm,
                    FormationAbsenceOrm.formation_id == GeologicalFormationOrm.id,
                )
                .where(GeologicalFormationOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_absences = 0
    skipped_absences = 0
    dropped_absences = 0
    total_absences = len(formation_absences_payload)
    logger.info(
        f"restore_project_bundle({project_id}): restoring {total_absences} formation absence(s)"
    )
    for i, ab_payload in enumerate(formation_absences_payload, start=1):
        ab_id_raw = ab_payload.get("id")
        if ab_id_raw is None:
            logger.debug(f"[{i}/{total_absences}] formation absence skipped — payload has no id")
            skipped_absences += 1
            continue
        ab_id = UUID(ab_id_raw) if isinstance(ab_id_raw, str) else ab_id_raw
        if ab_id in existing_absence_ids:
            logger.debug(
                f"[{i}/{total_absences}] formation absence {ab_id} already present — skipped"
            )
            skipped_absences += 1
            continue
        # Formation FK guard.
        fa_id_raw = ab_payload.get("formation_id")
        if fa_id_raw is None:
            logger.warning(
                f"[{i}/{total_absences}] formation absence {ab_id} has no formation_id — dropped"
            )
            dropped_absences += 1
            continue
        ab_formation_id = UUID(fa_id_raw) if isinstance(fa_id_raw, str) else fa_id_raw
        if ab_formation_id not in valid_formation_ids:
            logger.warning(
                f"[{i}/{total_absences}] formation absence {ab_id} → formation {ab_formation_id} "
                f"not in this project — dropped (dangling FK)"
            )
            dropped_absences += 1
            continue
        kwargs = _apply_json_to_kwargs(FormationAbsenceOrm, ab_payload)
        session.add(FormationAbsenceOrm(**kwargs))
        new_absences += 1
        logger.debug(f"[{i}/{total_absences}] formation absence {ab_id} queued for insert")
    if dropped_absences:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped_absences} "
            f"formation absence(s) (formation not in project or missing formation_id)"
        )

    # ---- Litho contact correlation edges (#133 Phase 2+3) -------------------
    # Restored AFTER geological_models + formation_contacts exist.  Both
    # contact_a_id and contact_b_id FK into formation_contact; model_id FK
    # into geological_model.  ``valid_model_ids_for_edges`` was built during
    # the litho-correlation-edges restore section above.
    #
    # Build the set of formation_contact ids that now exist for this project.
    # Contacts are nested under models in the bundle, so the authoritative set
    # is: DB contacts for the project's models UNION contacts carried in the
    # models payload (just inserted above, not yet flushed).
    valid_contact_ids: set[UUID] = set(
        (
            await session.execute(
                select(FormationContactOrm.id)
                .join(GeologicalModelOrm, FormationContactOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    # Also include contacts that were queued for insert in this transaction
    # (not yet flushed) — their ids live in the restored model.contacts lists.
    for m_payload in geological_models_payload:
        for c in m_payload.get("contacts") or []:
            c_id_raw = c.get("id")
            if c_id_raw is not None:
                valid_contact_ids.add(UUID(c_id_raw) if isinstance(c_id_raw, str) else c_id_raw)

    existing_contact_edge_ids = set(
        (
            await session.execute(
                select(LithoContactCorrelationEdgeOrm.id)
                .join(
                    GeologicalModelOrm,
                    LithoContactCorrelationEdgeOrm.model_id == GeologicalModelOrm.id,
                )
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_contact_edges = 0
    skipped_contact_edges = 0
    dropped_contact_edges = 0
    total_contact_edges = len(litho_contact_correlation_edges_payload)
    logger.info(
        f"restore_project_bundle({project_id}): restoring "
        f"{total_contact_edges} litho contact correlation edge(s)"
    )
    for i, ce_payload in enumerate(litho_contact_correlation_edges_payload, start=1):
        ce_id_raw = ce_payload.get("id")
        if ce_id_raw is None:
            logger.debug(
                f"[{i}/{total_contact_edges}] litho contact edge skipped — payload has no id"
            )
            skipped_contact_edges += 1
            continue
        ce_id = UUID(ce_id_raw) if isinstance(ce_id_raw, str) else ce_id_raw
        if ce_id in existing_contact_edge_ids:
            logger.debug(
                f"[{i}/{total_contact_edges}] litho contact edge {ce_id} already present — skipped"
            )
            skipped_contact_edges += 1
            continue
        # Bundle-injection guard: model must belong to this project.
        model_id_raw = ce_payload.get("model_id")
        if model_id_raw is None:
            logger.warning(
                f"[{i}/{total_contact_edges}] litho contact edge {ce_id} has no model_id — dropped"
            )
            dropped_contact_edges += 1
            continue
        ce_model_id = UUID(model_id_raw) if isinstance(model_id_raw, str) else model_id_raw
        if ce_model_id not in valid_model_ids_for_edges:
            logger.warning(
                f"[{i}/{total_contact_edges}] litho contact edge {ce_id} → model "
                f"{ce_model_id} not in this project — dropped (bundle-injection guard)"
            )
            dropped_contact_edges += 1
            continue
        # Contact FK guard: both endpoints must be formation_contact rows
        # belonging to this project's models.
        ca_raw = ce_payload.get("contact_a_id")
        cb_raw = ce_payload.get("contact_b_id")
        if ca_raw is None or cb_raw is None:
            logger.warning(
                f"[{i}/{total_contact_edges}] litho contact edge {ce_id} "
                f"missing contact endpoint(s) — dropped"
            )
            dropped_contact_edges += 1
            continue
        ca_id = UUID(ca_raw) if isinstance(ca_raw, str) else ca_raw
        cb_id = UUID(cb_raw) if isinstance(cb_raw, str) else cb_raw
        if ca_id not in valid_contact_ids or cb_id not in valid_contact_ids:
            logger.warning(
                f"[{i}/{total_contact_edges}] litho contact edge {ce_id}: contact "
                f"endpoint(s) not present in this project — dropped (dangling FK)"
            )
            dropped_contact_edges += 1
            continue
        kwargs = _apply_json_to_kwargs(LithoContactCorrelationEdgeOrm, ce_payload)
        session.add(LithoContactCorrelationEdgeOrm(**kwargs))
        new_contact_edges += 1
        logger.debug(f"[{i}/{total_contact_edges}] litho contact edge {ce_id} queued for insert")
    if dropped_contact_edges:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped_contact_edges} "
            f"litho contact correlation edge(s) (model/contact not in project or missing FK)"
        )

    # ---- Lens boundary shapes + nodes (#163f Slice 2) ----------------------
    # Shapes restored AFTER geological_models (shape.model_id FK).  Nodes
    # restored AFTER shapes (node.shape_id FK).  Idempotent by id; dangling
    # FKs dropped with a warning, mirroring the sections above.
    existing_shape_ids: set[UUID] = set(
        (
            await session.execute(
                select(LithoLensShapeOrm.id)
                .join(GeologicalModelOrm, LithoLensShapeOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    valid_shape_ids: set[UUID] = set(existing_shape_ids)
    new_lens_shapes = 0
    dropped_lens_shapes = 0
    for shape_payload in litho_lens_shapes_payload:
        sid_raw = shape_payload.get("id")
        mid_raw = shape_payload.get("model_id")
        if sid_raw is None or mid_raw is None:
            dropped_lens_shapes += 1
            continue
        sid = UUID(sid_raw) if isinstance(sid_raw, str) else sid_raw
        mid = UUID(mid_raw) if isinstance(mid_raw, str) else mid_raw
        if sid in existing_shape_ids:
            valid_shape_ids.add(sid)
            continue
        if mid not in valid_model_ids_for_edges:
            logger.warning(
                f"restore_project_bundle({project_id}): lens shape {sid} → model {mid} "
                f"not in this project — dropped (dangling FK)"
            )
            dropped_lens_shapes += 1
            continue
        session.add(LithoLensShapeOrm(**_apply_json_to_kwargs(LithoLensShapeOrm, shape_payload)))
        valid_shape_ids.add(sid)
        new_lens_shapes += 1

    existing_node_ids: set[UUID] = set(
        (
            await session.execute(
                select(LithoLensBoundaryNodeOrm.id)
                .join(
                    LithoLensShapeOrm,
                    LithoLensBoundaryNodeOrm.shape_id == LithoLensShapeOrm.id,
                )
                .join(GeologicalModelOrm, LithoLensShapeOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_lens_nodes = 0
    dropped_lens_nodes = 0
    for node_payload in litho_lens_boundary_nodes_payload:
        nid_raw = node_payload.get("id")
        shid_raw = node_payload.get("shape_id")
        if nid_raw is None or shid_raw is None:
            dropped_lens_nodes += 1
            continue
        nid = UUID(nid_raw) if isinstance(nid_raw, str) else nid_raw
        shid = UUID(shid_raw) if isinstance(shid_raw, str) else shid_raw
        if nid in existing_node_ids:
            continue
        if shid not in valid_shape_ids:
            logger.warning(
                f"restore_project_bundle({project_id}): lens boundary node {nid} → shape {shid} "
                f"not in this project — dropped (dangling FK)"
            )
            dropped_lens_nodes += 1
            continue
        session.add(
            LithoLensBoundaryNodeOrm(
                **_apply_json_to_kwargs(LithoLensBoundaryNodeOrm, node_payload)
            )
        )
        new_lens_nodes += 1
    if dropped_lens_shapes or dropped_lens_nodes:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped_lens_shapes} lens shape(s) "
            f"+ {dropped_lens_nodes} lens boundary node(s) (dangling FK)"
        )

    await session.flush()
    logger.info(
        f"restore_project_bundle({project_id}): "
        f"+{new_cpts} CPTs, +{new_boreholes} boreholes, "
        f"+{new_formations} formations, +{new_units} geotech units, "
        f"+{new_models} models (+{new_contacts} contacts), "
        f"+{new_sections} sections, "
        f"+{new_reviews} reviews ({dropped_reviews} dropped as orphan), "
        f"+{new_contact_edges} litho contact edges "
        f"({skipped_contact_edges} skipped, {dropped_contact_edges} dropped), "
        f"+{new_lenses} lenses ({skipped_lenses} skipped, {dropped_lenses} dropped), "
        f"+{new_absences} formation absences "
        f"({skipped_absences} skipped, {dropped_absences} dropped)"
    )
    return project


# ---------------------------------------------------------------------------
# Class surface (debt #48 — logger-via-inheritance)
# ---------------------------------------------------------------------------


class ProjectBundleService(GroundModelLogger):
    """Service wrapping the .gmproj round-trip (build / restore) so the
    log surface inherits the typed ``GroundModelLogger`` levels per
    CLAUDE.md's "logging via inheritance" rule.

    The two methods delegate to the existing ``_*_impl`` module
    functions, passing ``self`` as the ``logger`` parameter so every
    log line is emitted under this service's logger name with the
    standard ``self.X`` surface (info / warning / debug / etc.). The
    impl bodies are unchanged — Python's LEGB resolution picks up the
    parameter wherever the body says ``logger.X(...)``.

    Construction takes the SQLAlchemy session. The service is cheap to
    instantiate (one ``getLogger`` + a session ref); per-request
    construction in the router handler is fine.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._session = session

    async def build(self, project: ProjectOrm) -> dict[str, Any]:
        """Serialise the full project tree to a JSON-friendly dict.

        See :func:`_build_project_bundle_impl` for the per-table
        nesting layout the result carries.
        """
        return await _build_project_bundle_impl(self._session, project, logger=self)

    async def restore(
        self,
        project_id: UUID,
        project_payload: dict[str, Any],
        cpts_payload: list[dict[str, Any]],
        boreholes_payload: list[dict[str, Any]],
        geological_formations_payload: list[dict[str, Any]] | None = None,
        geological_models_payload: list[dict[str, Any]] | None = None,
        cross_sections_payload: list[dict[str, Any]] | None = None,
        investigation_reviews_payload: list[dict[str, Any]] | None = None,
        geotechnical_units_payload: list[dict[str, Any]] | None = None,
        bodies_payload: list[dict[str, Any]] | None = None,
        formation_absences_payload: list[dict[str, Any]] | None = None,
        litho_contact_correlation_edges_payload: list[dict[str, Any]] | None = None,
        litho_lens_shapes_payload: list[dict[str, Any]] | None = None,
        litho_lens_boundary_nodes_payload: list[dict[str, Any]] | None = None,
        *,
        replace: bool = False,
    ) -> ProjectOrm:
        """Idempotently materialise the project tree from a bundle.

        See :func:`_restore_project_bundle_impl` for the per-section
        dedup / orphan-skip semantics.

        Parameters
        ----------
        replace
            When True, wipe the project's child collections before inserting
            (revert-to-last-save, debt #160) so the project ends up matching
            the bundle exactly. When False (default), insert is idempotent —
            existing rows are skipped (the open-from-file path).
        """
        return await _restore_project_bundle_impl(
            self._session,
            project_id,
            project_payload,
            cpts_payload,
            boreholes_payload,
            geological_formations_payload,
            geological_models_payload,
            cross_sections_payload,
            investigation_reviews_payload,
            geotechnical_units_payload,
            bodies_payload,
            formation_absences_payload,
            litho_contact_correlation_edges_payload,
            litho_lens_shapes_payload,
            litho_lens_boundary_nodes_payload,
            logger=self,
            replace=replace,
        )


# ---------------------------------------------------------------------------
# Public module-level wrappers — backwards-compat for existing callers
# (the project router) so the class-ification is a pure addition. New
# code should prefer the ``ProjectBundleService`` surface above.
# ---------------------------------------------------------------------------


async def build_project_bundle(session: AsyncSession, project: ProjectOrm) -> dict[str, Any]:
    """Backwards-compat wrapper — see ``ProjectBundleService.build``."""
    return await ProjectBundleService(session).build(project)


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
    bodies_payload: list[dict[str, Any]] | None = None,
    formation_absences_payload: list[dict[str, Any]] | None = None,
    litho_contact_correlation_edges_payload: list[dict[str, Any]] | None = None,
    litho_lens_shapes_payload: list[dict[str, Any]] | None = None,
    litho_lens_boundary_nodes_payload: list[dict[str, Any]] | None = None,
    *,
    replace: bool = False,
) -> ProjectOrm:
    """Backwards-compat wrapper — see ``ProjectBundleService.restore``."""
    return await ProjectBundleService(session).restore(
        project_id,
        project_payload,
        cpts_payload,
        boreholes_payload,
        geological_formations_payload,
        geological_models_payload,
        cross_sections_payload,
        investigation_reviews_payload,
        geotechnical_units_payload,
        bodies_payload,
        formation_absences_payload,
        litho_contact_correlation_edges_payload,
        litho_lens_shapes_payload,
        litho_lens_boundary_nodes_payload,
        replace=replace,
    )
