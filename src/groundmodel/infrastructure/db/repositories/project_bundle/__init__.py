"""project_bundle — full round-trip between ORM tree and .gmproj JSON.

This package backs the .gmproj v4 file format: a project's complete
state (header metadata + every CPT with its series + every borehole
with its full tree + the interpretation work) serialises to one
JSON-friendly dict, restores from one back to the DB.

Used by:

* ``GET /projects/{id}/bundle`` — the desktop client calls this on
  File → Save and embeds the result in the .gmproj file.
* ``POST /projects/{id}/restore`` — the desktop client calls this on
  open when the DB doesn't have the row the file points at, passing
  the embedded bundle so CPTs, boreholes, and the geological /
  lithostratigraphic model come back along with the project shell.

The round-trip is idempotent: re-restoring a bundle whose rows already
exist (by id) returns them as-is rather than failing or duplicating.

Public surface (preserved for backwards compatibility with all existing
callers — import paths are unchanged):

* ``BundleIntegrityError`` — raised when a bundle is self-inconsistent.
* ``ProjectBundleService`` — ``GroundModelLogger``-inheriting service
  with ``.build()`` and ``.restore()`` methods.
* ``build_project_bundle`` — module-level backwards-compat wrapper.
* ``restore_project_bundle`` — module-level backwards-compat wrapper.

Internal helpers (re-exported for the test suite that reaches into them
directly):

* ``_to_json``, ``_from_json`` — value-level encode/decode.
* ``_column_to_json``, ``_apply_json_to_kwargs``, ``_normalise_restore_keys``
  — row-level helpers.
* ``_cap``, ``_uuid``, ``_series_row_count``, ``_validate_tin_payload``
  — restore utility helpers.
* ``_MAX_CPT_SERIES_ROWS``, ``_MAX_SURFACE_SOURCE_CONTACTS`` — caps.
* All other ``_*`` helpers from the sub-modules.

Package layout:

* ``bundle_serialization`` — JSON encode/decode helpers + per-table
  dict serialisers + size-cap constants.
* ``bundle_row_builders`` — ORM row constructors (CPT, borehole tree,
  uuid coercion, location rebuild, _cap).
* ``bundle_build`` — ``_build_project_bundle_impl`` + ``BundleIntegrityError``.
* ``bundle_restore_litho`` — litho-specific restore phases (geological
  models, bodies, formation absences, contact edges, lens shapes/nodes).
* ``bundle_restore_core`` — core restore phases (CPTs, boreholes,
  formations, geotech units, cross-sections, reviews, orchestrator).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Public domain error + service
from .bundle_build import BundleIntegrityError, _build_project_bundle_impl
from .bundle_restore_core import (
    _build_valid_formation_ids,
    _build_valid_model_ids,
    _restore_boreholes,
    _restore_cross_sections,
    _restore_formations,
    _restore_investigation_reviews,
    _restore_project_bundle_impl,
    _wipe_project_scoped_rows,
)
from .bundle_restore_drops import BundleRestoreDrops
from .bundle_restore_litho import (
    _attach_companion_body_links,
    _restore_bodies,
    _restore_contact_edges,
    _restore_formation_absences,
    _restore_geological_models,
    _restore_lens_shapes_and_nodes,
)
from .bundle_row_builders import (
    _build_borehole,
    _build_cpt,
    _build_layer,
    _build_observation,
    _build_sample,
    _cap,
    _make_location,
    _series_row_count,
    _uuid,
    _validate_tin_payload,
)

# Re-export all internal helpers so existing callers keep working
# without any import-path changes.
from .bundle_serialization import (
    _MAX_BOREHOLE_DRILL_SEGMENTS,
    _MAX_BOREHOLE_FIELD_LOG_INTERVALS,
    _MAX_BOREHOLE_OBSERVATIONS,
    _MAX_BOREHOLE_SAMPLES,
    _MAX_CPT_SERIES_ROWS,
    _MAX_LAYER_ADMIXTURES,
    _MAX_OBSERVATION_LAYERS,
    _MAX_SAMPLE_LAB_TESTS,
    _MAX_SURFACE_SOURCE_CONTACTS,
    _MAX_TIN_ARRAY_LEN,
    _SKIP_COLUMNS,
    _apply_json_to_kwargs,
    _borehole_to_dict,
    _column_to_json,
    _cpt_to_dict,
    _from_json,
    _geological_model_to_dict,
    _layer_to_dict,
    _normalise_restore_keys,
    _observation_to_dict,
    _sample_to_dict,
    _to_json,
)

__all__ = [
    # Public API
    "BundleIntegrityError",
    "BundleRestoreDrops",
    "ProjectBundleService",
    "build_project_bundle",
    "restore_project_bundle",
    # Serialisation helpers
    "_to_json",
    "_from_json",
    "_column_to_json",
    "_apply_json_to_kwargs",
    "_normalise_restore_keys",
    "_cpt_to_dict",
    "_borehole_to_dict",
    "_observation_to_dict",
    "_layer_to_dict",
    "_sample_to_dict",
    "_geological_model_to_dict",
    # Row builders
    "_make_location",
    "_build_cpt",
    "_build_borehole",
    "_build_observation",
    "_build_layer",
    "_build_sample",
    "_series_row_count",
    "_validate_tin_payload",
    "_cap",
    "_uuid",
    # Constants
    "_SKIP_COLUMNS",
    "_MAX_SURFACE_SOURCE_CONTACTS",
    "_MAX_TIN_ARRAY_LEN",
    "_MAX_CPT_SERIES_ROWS",
    "_MAX_BOREHOLE_DRILL_SEGMENTS",
    "_MAX_BOREHOLE_FIELD_LOG_INTERVALS",
    "_MAX_BOREHOLE_OBSERVATIONS",
    "_MAX_OBSERVATION_LAYERS",
    "_MAX_LAYER_ADMIXTURES",
    "_MAX_BOREHOLE_SAMPLES",
    "_MAX_SAMPLE_LAB_TESTS",
    # Restore core
    "_wipe_project_scoped_rows",
    "_restore_cpts",
    "_restore_boreholes",
    "_restore_formations",
    "_build_valid_formation_ids",
    "_build_valid_model_ids",
    "_restore_cross_sections",
    "_restore_investigation_reviews",
    "_restore_project_bundle_impl",
    # Restore litho
    "_restore_geological_models",
    "_restore_bodies",
    "_restore_formation_absences",
    "_restore_contact_edges",
    "_restore_lens_shapes_and_nodes",
    "_attach_companion_body_links",
    # Build impl
    "_build_project_bundle_impl",
]

# ---------------------------------------------------------------------------
# _restore_cpts is defined in bundle_restore_core but not re-imported above
# because it is implicitly available via _restore_project_bundle_impl. Import
# it explicitly so the __all__ entry resolves.
# ---------------------------------------------------------------------------
from .bundle_restore_core import _restore_cpts  # noqa: E402


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

    async def build(self, project: ProjectOrm, *, include_solids: bool = True) -> dict[str, Any]:
        """Serialise the full project tree to a JSON-friendly dict.

        See :func:`_build_project_bundle_impl` for the per-table
        nesting layout the result carries.

        Parameters
        ----------
        project : ProjectOrm
            Project row whose children will be serialised.
        include_solids : bool, default True
            When ``False`` the cached ``litho_solids`` 3-D meshes are
            omitted (emitted as an empty list). The desktop File → Save
            passes ``False`` — the .strix file never stores the meshes,
            so fetching them is wasted work. See
            :func:`_build_project_bundle_impl`.

        Returns
        -------
        dict[str, Any]
            JSON-friendly bundle dict.
        """
        return await _build_project_bundle_impl(
            self._session, project, logger=self, include_solids=include_solids
        )

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
        bodies_payload: list[dict[str, Any]] | None = None,
        formation_absences_payload: list[dict[str, Any]] | None = None,
        litho_contact_correlation_edges_payload: list[dict[str, Any]] | None = None,
        body_geometry_facts_payload: list[dict[str, Any]] | None = None,
        body_boundary_shapes_payload: list[dict[str, Any]] | None = None,
        body_boundary_nodes_payload: list[dict[str, Any]] | None = None,
        litho_solids_payload: list[dict[str, Any]] | None = None,
        geotech_tie_tombstones_payload: list[dict[str, Any]] | None = None,
        body_separations_payload: list[dict[str, Any]] | None = None,
        body_unions_payload: list[dict[str, Any]] | None = None,
        bed_overrides_payload: list[dict[str, Any]] | None = None,
        *,
        replace: bool = False,
        drops: BundleRestoreDrops | None = None,
    ) -> ProjectOrm:
        """Idempotently materialise the project tree from a bundle.

        See :func:`_restore_project_bundle_impl` for the per-section
        dedup / orphan-skip semantics.

        Parameters
        ----------
        project_id : UUID
            Canonical project id (URL-driven).
        project_payload : dict[str, Any]
            Raw project metadata dict from the bundle.
        cpts_payload : list[dict[str, Any]]
            CPT dicts from the bundle.
        boreholes_payload : list[dict[str, Any]]
            Borehole dicts (with full child tree) from the bundle.
        geological_formations_payload : list[dict[str, Any]] | None
            Formation rows; ``None`` → empty (legacy caller compat).
        geological_models_payload : list[dict[str, Any]] | None
            Model rows with nested contacts / surfaces / litho_layers.
        cross_sections_payload : list[dict[str, Any]] | None
            Cross-section rows.
        investigation_reviews_payload : list[dict[str, Any]] | None
            Per-(project, investigation) review rows.
        bodies_payload : list[dict[str, Any]] | None
            Body (lens) rows.
        formation_absences_payload : list[dict[str, Any]] | None
            Formation-absence rows.
        litho_contact_correlation_edges_payload : list[dict[str, Any]] | None
            Litho contact correlation edge rows.
        body_geometry_facts_payload : list[dict[str, Any]] | None
            Geometric body-connectivity fact rows (owner ruling 2026-08-12).
        body_boundary_shapes_payload : list[dict[str, Any]] | None
            Lens boundary shape rows.
        body_boundary_nodes_payload : list[dict[str, Any]] | None
            Lens boundary node rows.
        litho_solids_payload : list[dict[str, Any]] | None
            Cached watertight body-solid rows (watertight-loft Task 9).
        body_separations_payload : list[dict[str, Any]] | None
            User "Separate" rulings (owner 2026-08-31, debt #278 R5).
        body_unions_payload : list[dict[str, Any]] | None
            User "Join with…" rulings (owner 2026-08-31, debt #278).
        bed_overrides_payload : list[dict[str, Any]] | None
            Manual bed-level polygon rows (owner ruling 2026-09-06).
        replace : bool
            When True, wipe the project's child collections before inserting
            (revert-to-last-save, debt #160) so the project ends up matching
            the bundle exactly. When False (default), insert is idempotent —
            existing rows are skipped (the open-from-file path).
        drops : BundleRestoreDrops | None
            Mutable tally, mutated in place, of rows the size caps dropped, so
            the caller can surface them in the restore response (L6).

        Returns
        -------
        ProjectOrm
            The project row (created or pre-existing).

        Raises
        ------
        BundleIntegrityError
            On ``replace=True`` when the bundle is self-inconsistent.
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
            bodies_payload,
            formation_absences_payload,
            litho_contact_correlation_edges_payload,
            body_geometry_facts_payload,
            body_boundary_shapes_payload,
            body_boundary_nodes_payload,
            litho_solids_payload,
            # Keyword deliberately: the positional block above is frozen (a
            # mid-list insertion once shifted three payloads into the wrong
            # restorers); everything new travels by name.
            geotech_tie_tombstones_payload=geotech_tie_tombstones_payload,
            body_separations_payload=body_separations_payload,
            body_unions_payload=body_unions_payload,
            bed_overrides_payload=bed_overrides_payload,
            logger=self,
            replace=replace,
            drops=drops,
        )


# ---------------------------------------------------------------------------
# Public module-level wrappers — backwards-compat for existing callers
# (the project router) so the class-ification is a pure addition. New
# code should prefer the ``ProjectBundleService`` surface above.
# ---------------------------------------------------------------------------


async def build_project_bundle(
    session: AsyncSession, project: ProjectOrm, *, include_solids: bool = True
) -> dict[str, Any]:
    """Backwards-compat wrapper — see ``ProjectBundleService.build``.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project : ProjectOrm
        Project row to serialise.
    include_solids : bool, default True
        Forwarded to ``ProjectBundleService.build`` — ``False`` omits the
        cached ``litho_solids`` meshes (File → Save uses this).

    Returns
    -------
    dict[str, Any]
        JSON-friendly bundle dict.
    """
    return await ProjectBundleService(session).build(project, include_solids=include_solids)


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
    bodies_payload: list[dict[str, Any]] | None = None,
    formation_absences_payload: list[dict[str, Any]] | None = None,
    litho_contact_correlation_edges_payload: list[dict[str, Any]] | None = None,
    body_geometry_facts_payload: list[dict[str, Any]] | None = None,
    body_boundary_shapes_payload: list[dict[str, Any]] | None = None,
    body_boundary_nodes_payload: list[dict[str, Any]] | None = None,
    litho_solids_payload: list[dict[str, Any]] | None = None,
    geotech_tie_tombstones_payload: list[dict[str, Any]] | None = None,
    body_separations_payload: list[dict[str, Any]] | None = None,
    body_unions_payload: list[dict[str, Any]] | None = None,
    bed_overrides_payload: list[dict[str, Any]] | None = None,
    *,
    replace: bool = False,
    drops: BundleRestoreDrops | None = None,
) -> ProjectOrm:
    """Backwards-compat wrapper — see ``ProjectBundleService.restore``.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Canonical project id (URL-driven).
    project_payload : dict[str, Any]
        Raw project metadata dict from the bundle.
    cpts_payload : list[dict[str, Any]]
        CPT dicts from the bundle.
    boreholes_payload : list[dict[str, Any]]
        Borehole dicts from the bundle.
    geological_formations_payload : list[dict[str, Any]] | None
        Formation rows.
    geological_models_payload : list[dict[str, Any]] | None
        Model rows with nested contacts / surfaces / litho_layers.
    cross_sections_payload : list[dict[str, Any]] | None
        Cross-section rows.
    investigation_reviews_payload : list[dict[str, Any]] | None
        Review rows.
    bodies_payload : list[dict[str, Any]] | None
        Body rows.
    formation_absences_payload : list[dict[str, Any]] | None
        Formation-absence rows.
    litho_contact_correlation_edges_payload : list[dict[str, Any]] | None
        Correlation edge rows.
    body_geometry_facts_payload : list[dict[str, Any]] | None
        Geometric body-connectivity fact rows.
    body_boundary_shapes_payload : list[dict[str, Any]] | None
        Lens boundary shape rows.
    body_boundary_nodes_payload : list[dict[str, Any]] | None
        Lens boundary node rows.
    litho_solids_payload : list[dict[str, Any]] | None
        Cached watertight body-solid rows (watertight-loft Task 9).
    geotech_tie_tombstones_payload : list[dict[str, Any]] | None
        The engineer's deleted packing ties, keyed by place (owner 2026-08-17).
    body_separations_payload : list[dict[str, Any]] | None
        User "Separate" rulings (owner 2026-08-31, debt #278 R5).
    body_unions_payload : list[dict[str, Any]] | None
        User "Join with…" rulings (owner 2026-08-31, debt #278).
    bed_overrides_payload : list[dict[str, Any]] | None
        Manual bed-level polygon rows (owner ruling 2026-09-06).
    replace : bool
        When True, wipe before insert (revert-to-last-save).
    drops : BundleRestoreDrops | None
        Mutable tally, mutated in place, of rows the size caps dropped (L6).

    Returns
    -------
    ProjectOrm
        The project row (created or pre-existing).

    Raises
    ------
    BundleIntegrityError
        On ``replace=True`` when the bundle is self-inconsistent.
    """
    return await ProjectBundleService(session).restore(
        project_id,
        project_payload,
        cpts_payload,
        boreholes_payload,
        geological_formations_payload,
        geological_models_payload,
        cross_sections_payload,
        investigation_reviews_payload,
        bodies_payload,
        formation_absences_payload,
        litho_contact_correlation_edges_payload,
        body_geometry_facts_payload,
        body_boundary_shapes_payload,
        body_boundary_nodes_payload,
        litho_solids_payload,
        geotech_tie_tombstones_payload=geotech_tie_tombstones_payload,
        body_separations_payload=body_separations_payload,
        body_unions_payload=body_unions_payload,
        bed_overrides_payload=bed_overrides_payload,
        replace=replace,
        drops=drops,
    )
