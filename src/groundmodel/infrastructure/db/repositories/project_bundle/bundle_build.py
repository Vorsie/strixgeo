"""Bundle build pipeline — serialise a live project tree to a JSON dict.

Backs the ``GET /projects/{id}/bundle`` endpoint (File → Save on the
desktop client). The single public entry-point is
``_build_project_bundle_impl``.

The output is a plain ``dict`` (no Pydantic) — FastAPI serialises it
to JSON via the default encoder. Floats / ints / strings / lists /
nested dicts all pass through; UUIDs and dates were already flattened
to strings inside the per-table helpers from ``bundle_serialization``.

An integrity check (2026-05-31 dogfeed fix) collects every
formation_id referenced by contacts / litho layers and
cross-references against the project-scoped formation query. Recovered
rows from a global re-fetch ride along in the export; any id that is
truly absent from the DB causes a ``BundleIntegrityError`` — the
engineer sees the error at save time, not at restore.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm import (
    GeotechTieTombstoneOrm,
)
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    borehole_full_tree_options,
)
from groundmodel.shared.bundle_format import BUNDLE_FORMAT_VERSION
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

from .bundle_collections import assert_bundle_keys_registered
from .bundle_serialization import (
    _SKIP_COLUMNS,
    _borehole_to_dict,
    _column_to_json,
    _cpt_to_dict,
    _geological_model_to_dict,
)

if TYPE_CHECKING:
    pass


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


async def _build_project_bundle_impl(
    session: AsyncSession,
    project: ProjectOrm,
    logger: GroundModelLogger,
    *,
    include_solids: bool = True,
) -> dict[str, Any]:
    """Return a fully serialised snapshot of a project + every child.

    The project row is passed in (already loaded by the caller).
    Children are eager-loaded here in one batch each — same pattern as
    ``ProjectRepository.duplicate``.

    Debt #48: ``logger`` is passed in (typically as the
    ``ProjectBundleService`` instance) so every log line carries the
    service's `self` surface — the module no longer holds a free-
    standing module-level logger.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project : ProjectOrm
        Project row whose children will be serialised.
    logger : GroundModelLogger
        Caller's typed logger (passed in so log lines carry the service
        module name, not this internal module name).
    include_solids : bool, default True
        When ``False`` the cached ``litho_solids`` meshes are NOT queried
        or serialised — the key is emitted as an empty list. The desktop
        File → Save path passes ``False`` because the ``.strix`` v3 file
        format never stored the 3-D meshes (``buildProjectFile`` drops the
        key) and nothing in the client reads them from the bundle, so
        shipping ~10 MB of vertices/triangles per save was pure waste that
        made every save slow. Defaults to ``True`` so any caller that DOES
        want the meshes (a future export-from-bundle path) is unaffected.

    Returns
    -------
    dict[str, Any]
        JSON-friendly bundle dict.

    Raises
    ------
    BundleIntegrityError
        When formation_ids referenced by contacts/layers are
        absent from the DB and cannot be recovered.
    """
    cpts_stmt = (
        select(CptOrm)
        .where(CptOrm.app_project_id == project.id)
        .options(selectinload(CptOrm.series))
    )
    boreholes_stmt = (
        select(BoreholeOrm)
        .where(BoreholeOrm.app_project_id == project.id)
        .options(*borehole_full_tree_options())
    )
    # Geological-model tree. The bundle carries the user's interpretation
    # work (formations + models + every contact) so re-opening the file
    # on a wiped DB — or on a different device — brings the model back
    # alongside the raw investigations.
    formations_stmt = select(GeologicalFormationOrm).where(
        GeologicalFormationOrm.app_project_id == project.id
    )
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
    lenses_stmt = select(BodyOrm).where(BodyOrm.app_project_id == project.id)
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
    # Geometric body-connectivity facts (owner ruling 2026-08-12). Scoped
    # through geological_model like the edges — same anchor, same reason.
    geometry_facts_stmt = (
        select(BodyGeometryFactOrm)
        .join(
            GeologicalModelOrm,
            BodyGeometryFactOrm.model_id == GeologicalModelOrm.id,
        )
        .where(GeologicalModelOrm.app_project_id == project.id)
    )
    # The engineer's deleted packing ties (owner 2026-08-17: "a tie i delete
    # stays deleted"). Scoped through geological_model like the edges; keyed by
    # PLACE (xyz both ends + section) so the memory survives band rebuilds AND
    # a save/reopen round-trip — without this a Discard would resurrect them.
    tie_tombstones_stmt = (
        select(GeotechTieTombstoneOrm)
        .join(
            GeologicalModelOrm,
            GeotechTieTombstoneOrm.model_id == GeologicalModelOrm.id,
        )
        .where(GeologicalModelOrm.app_project_id == project.id)
    )
    # The engineer's "Separate" rulings (owner 2026-08-31, debt #278 R5: a body
    # is only a body if geometrically connected OR the user says so). Scoped
    # through geological_model like the facts; a layer-id pair the resolver reads
    # as a cannot-link. Without it a save/restore or clone would silently rejoin
    # bodies the engineer explicitly separated — the ruling's word was "permanent".
    body_separations_stmt = (
        select(BodySeparationOrm)
        .join(
            GeologicalModelOrm,
            BodySeparationOrm.model_id == GeologicalModelOrm.id,
        )
        .where(GeologicalModelOrm.app_project_id == project.id)
    )
    # The engineer's "Join with…" rulings (owner 2026-08-31, debt #278: the
    # positive half of the same body-identity rule). Scoped like the separations;
    # a layer-id pair the resolver reads as a must-link. Without it a save/restore
    # or clone would silently split bodies the engineer explicitly joined.
    body_unions_stmt = (
        select(BodyUnionOrm)
        .join(
            GeologicalModelOrm,
            BodyUnionOrm.model_id == GeologicalModelOrm.id,
        )
        .where(GeologicalModelOrm.app_project_id == project.id)
    )
    # Lens boundary shapes + nodes (#163f Slice 2). Scoped through
    # geological_model (the shape carries model_id; nodes hang off the shape).
    lens_shapes_stmt = (
        select(BodyBoundaryShapeOrm)
        .join(GeologicalModelOrm, BodyBoundaryShapeOrm.model_id == GeologicalModelOrm.id)
        .where(GeologicalModelOrm.app_project_id == project.id)
    )
    lens_boundary_nodes_stmt = (
        select(BodyBoundaryNodeOrm)
        .join(BodyBoundaryShapeOrm, BodyBoundaryNodeOrm.shape_id == BodyBoundaryShapeOrm.id)
        .join(GeologicalModelOrm, BodyBoundaryShapeOrm.model_id == GeologicalModelOrm.id)
        .where(GeologicalModelOrm.app_project_id == project.id)
    )
    # Cached watertight body solids (watertight-loft builder Task 9, spec §7).
    # Scoped through geological_model — the solid table has no direct
    # app_project_id column (the model_id FK is the project anchor). Carrying
    # the built meshes in the bundle lets a freshly-opened .strix export 3-D
    # geometry without paying the on-click rebuild; staleness rides along so
    # the UI still knows when a solid predates a contact edit.
    # Skipped entirely when ``include_solids`` is False (File → Save) — the
    # meshes are megabytes and the .strix file never stores them.
    litho_solids_stmt = (
        select(LithoBodySolidOrm)
        .join(GeologicalModelOrm, LithoBodySolidOrm.model_id == GeologicalModelOrm.id)
        .where(GeologicalModelOrm.app_project_id == project.id)
    )

    cpts = (await session.execute(cpts_stmt)).scalars().all()
    boreholes = (await session.execute(boreholes_stmt)).scalars().all()
    formations = (await session.execute(formations_stmt)).scalars().all()
    models = (await session.execute(models_stmt)).scalars().all()
    sections = (await session.execute(sections_stmt)).scalars().all()
    reviews = (await session.execute(reviews_stmt)).scalars().all()
    lenses = (await session.execute(lenses_stmt)).scalars().all()
    absences = (await session.execute(absences_stmt)).scalars().all()
    contact_edges = (await session.execute(contact_edges_stmt)).scalars().all()
    geometry_facts = (await session.execute(geometry_facts_stmt)).scalars().all()
    tie_tombstones = (await session.execute(tie_tombstones_stmt)).scalars().all()
    body_separations = (await session.execute(body_separations_stmt)).scalars().all()
    body_unions = (await session.execute(body_unions_stmt)).scalars().all()
    lens_shapes = (await session.execute(lens_shapes_stmt)).scalars().all()
    lens_boundary_nodes = (await session.execute(lens_boundary_nodes_stmt)).scalars().all()
    litho_solids = (
        (await session.execute(litho_solids_stmt)).scalars().all() if include_solids else []
    )

    # ---- Integrity check + auto-recovery (2026-05-31 dogfeed fix). ------
    # Collect every formation_id referenced by a contact / litho_layer
    # on this project. The export query for formations
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
        "geological_models": [_geological_model_to_dict(m) for m in models],
        "cross_sections": [_column_to_json(s, _SKIP_COLUMNS) for s in sections],
        "investigation_reviews": [_column_to_json(r, _SKIP_COLUMNS) for r in reviews],
        # Body rows (slice 4.1 rename from litho_lenses). Each row carries the
        # core BodyOrm column set: id, model_id, formation_id, body_ordinal,
        # source_investigation_id, name, primary_section_id.  (The retired
        # extent_* columns were dropped from BodyOrm by migration
        # d8868bb27884, so they can no longer appear here.)
        # formation_absences carries (formation_id, investigation_kind,
        # investigation_id, source). Bundles saved before these fields existed
        # open cleanly via the schema's default_factory=list.
        "bodies": [_column_to_json(lens, _SKIP_COLUMNS) for lens in lenses],
        "formation_absences": [_column_to_json(a, _SKIP_COLUMNS) for a in absences],
        # Contact-level correlation edges (#133 Phase 2+3). Each row carries
        # (model_id, layer_a_id, layer_b_id, source, user_approved,
        # review_reason). Additive field: bundles saved before this field existed
        # open cleanly via the schema's default_factory=list, and a bundle saved
        # before review_reason existed restores it as NULL (unflagged).
        "litho_contact_correlation_edges": [
            _column_to_json(ce, _SKIP_COLUMNS) for ce in contact_edges
        ],
        # Geometric body-connectivity facts (owner ruling 2026-08-12). Each row
        # carries (model_id, layer_a_id, layer_b_id) — the persisted stage-3
        # merge evidence, so a restored project keeps its merged bodies without
        # waiting for the first recompute. Additive: older bundles open cleanly
        # via the schema's default_factory=list.
        "body_geometry_facts": [_column_to_json(f, _SKIP_COLUMNS) for f in geometry_facts],
        # Deleted packing ties, keyed by place (owner 2026-08-17). Additive:
        # older bundles open cleanly via the restore's empty-list default.
        "geotech_tie_tombstones": [_column_to_json(t, _SKIP_COLUMNS) for t in tie_tombstones],
        # User "Separate" rulings (owner 2026-08-31, debt #278 R5). Each row
        # carries (model_id, layer_a_id, layer_b_id) — the cannot-link the
        # resolver honours. Additive: older bundles open cleanly via the
        # restore's empty-list default.
        "body_separations": [_column_to_json(s, _SKIP_COLUMNS) for s in body_separations],
        # User "Join with…" rulings (owner 2026-08-31, debt #278). Each row carries
        # (model_id, layer_a_id, layer_b_id) — the must-link the resolver honours.
        # Additive: older bundles open cleanly via the restore's empty-list default.
        "body_unions": [_column_to_json(u, _SKIP_COLUMNS) for u in body_unions],
        # Body boundary shapes + control nodes (#163f Slice 2). Shapes carry
        # (model_id, body_id, render_style); nodes carry (shape_id,
        # boundary, node_index, along_m, elevation_m). Additive — bundles saved
        # before these existed open cleanly via default_factory=list.
        "body_boundary_shapes": [_column_to_json(s, _SKIP_COLUMNS) for s in lens_shapes],
        "body_boundary_nodes": [_column_to_json(n, _SKIP_COLUMNS) for n in lens_boundary_nodes],
        # Cached watertight body solids (watertight-loft Task 9). Every column
        # rides along — id, model_id, body_id, formation_id, method, vertices,
        # triangles, source_pick_count/checksum, is_stale, is_flagged — so a
        # restore reproduces the row exactly (no rebuild needed). Additive:
        # bundles saved before this field existed open cleanly via the schema's
        # default_factory=list. Pre-ship amnesty — no format_version bump.
        "litho_solids": [_column_to_json(s, _SKIP_COLUMNS) for s in litho_solids],
    }
    # Every copy path (Save As, restore, revert) is driven off the registry
    # rather than its own list of tables. Checking the bundle against it here
    # means a collection added above but never registered fails at save time,
    # loudly, instead of being silently skipped by each of those paths.
    assert_bundle_keys_registered(bundle)
    logger.info(
        f"bundled project {project.id}: {len(cpts)} CPTs + {len(boreholes)} boreholes "
        f"+ {len(formations)} formations "
        f"+ {len(models)} models + {len(sections)} sections "
        f"+ {len(reviews)} reviews + {len(contact_edges)} litho contact correlation edges "
        f"+ {len(lenses)} bodies + {len(absences)} formation absences "
        f"+ {len(litho_solids)} litho body solids"
    )
    return bundle
