"""Repository for Project persistence."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Columns that must NEVER be carried across a deep clone — every clone
# of a row gets a fresh primary key, fresh server-side timestamps, and a
# parent FK that the caller injects. Listed once here rather than in
# every per-class clone helper below so adding a new "always reset"
# column lands in one place.
_NEVER_COPY = frozenset({"id", "created_at", "updated_at"})


def _column_dict(orm: Any, exclude: frozenset[str]) -> dict[str, Any]:
    """Snapshot every mapped column on ``orm`` except those in ``exclude``.

    Used by the deep-clone helpers to copy a row's values forward without
    enumerating field names per class — a new column added to any ORM
    model rides along automatically. The exclusion set carries the
    primary key + parent FKs that each clone path overrides.
    """
    return {
        col.key: getattr(orm, col.key)
        for col in orm.__class__.__mapper__.column_attrs
        if col.key not in exclude
    }


class ProjectRepository(GroundModelLogger):
    """Async CRUD for ``ProjectOrm`` rows.

    Mirrors the access pattern of ``CptRepository`` / ``BoreholeRepository``:
    one ``AsyncSession`` per request, no broker. Keeps the soft-delete
    semantics tight — ``archive`` and ``unarchive`` flip ``archived_at``
    rather than mutating the row twice.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def save(self, project: ProjectOrm, *, flush: bool = True) -> None:
        """Persist a new or updated project.

        Parameters
        ----------
        project : ProjectOrm
            Row to add to the session. For updates, the row must already be
            attached (loaded from this session) so SQLAlchemy emits an UPDATE
            rather than an INSERT.
        flush : bool
            When ``True`` (default), flush so a freshly-built row's id round-
            trips to the DB and any DB-side defaults populate. Bulk callers
            pass ``False``.
        """
        self._session.add(project)
        if flush:
            await self._session.flush()
            self.success(f"Project saved: {project.id} — {project.name}")

    async def get_by_id(self, project_id: UUID) -> ProjectOrm | None:
        """Return the project with the given id, or ``None``.

        Returns archived projects too — the router decides whether to surface
        them based on the request's ``status`` filter.
        """
        result = await self._session.execute(select(ProjectOrm).where(ProjectOrm.id == project_id))
        return result.scalar_one_or_none()

    async def list_all(self, *, include_archived: bool = False) -> list[ProjectOrm]:
        """Return every project, ordered by most-recent activity first.

        Parameters
        ----------
        include_archived : bool
            When ``False`` (default), hide rows where ``archived_at`` is set
            so the projects-list view keeps active work front-and-centre. When
            ``True``, return both active and archived; an "Archived" view in
            the UI uses this.
        """
        stmt = select(ProjectOrm).order_by(ProjectOrm.updated_at.desc())
        if not include_archived:
            stmt = stmt.where(ProjectOrm.archived_at.is_(None))
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def list_archived(self) -> list[ProjectOrm]:
        """Return only archived projects (for the 'Archived' view)."""
        stmt = (
            select(ProjectOrm)
            .where(ProjectOrm.archived_at.is_not(None))
            .order_by(ProjectOrm.archived_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def archive(self, project_id: UUID) -> ProjectOrm | None:
        """Soft-delete: stamp ``archived_at`` so the project drops out of
        default listings. Returns ``None`` when the id is unknown so the
        router can map to 404.
        """
        project = await self.get_by_id(project_id)
        if project is None:
            return None
        # Stamp with timezone-aware UTC so the column matches its declared
        # ``DateTime(timezone=True)`` type — naive datetimes round-trip as
        # implicit UTC on PostgreSQL but break ordering against other tz-
        # aware writes.
        project.archived_at = datetime.now(UTC)
        await self._session.flush()
        self.info(f"Project {project_id} archived")
        return project

    async def unarchive(self, project_id: UUID) -> ProjectOrm | None:
        """Restore a previously-archived project (clear ``archived_at``)."""
        project = await self.get_by_id(project_id)
        if project is None:
            return None
        project.archived_at = None
        await self._session.flush()
        self.info(f"Project {project_id} unarchived")
        return project

    async def duplicate(self, source_id: UUID, new_name: str | None = None) -> ProjectOrm | None:
        """Deep-clone a project + every CPT and Borehole tree under it.

        Used by the desktop client's File → Save As. Creates a new
        ``ProjectOrm`` with a fresh UUID, copies every metadata field
        from the source, then walks the source's CPTs (with series) and
        Boreholes (with drill_segments / field_log_intervals /
        observations → layers → admixtures / samples → all 6 lab-test
        families) under the new ``app_project_id``.

        Returns the new ``ProjectOrm`` (already attached to the session,
        ready for ``commit``), or ``None`` when ``source_id`` doesn't
        resolve. Caller is responsible for the commit.

        ``new_name`` overrides the source's name; defaults to
        ``"Copy of <source name>"``. Lifecycle (status / archived_at)
        does NOT carry across — a fresh copy starts active, like any
        other new project.

        DB rows only — the .gmproj file write is the caller's
        responsibility (the desktop client knows where the user wants
        the new file saved).
        """
        source = await self.get_by_id(source_id)
        if source is None:
            return None

        new_project = ProjectOrm(
            id=uuid7(),
            name=new_name if new_name else f"Copy of {source.name}",
            project_number=source.project_number,
            client=source.client,
            site_label=source.site_label,
            description=source.description,
            tags=list(source.tags),
            default_horizontal_epsg=source.default_horizontal_epsg,
            default_vertical_epsg=source.default_vertical_epsg,
            phase=source.phase,
            status="active",
            archived_at=None,
        )
        self._session.add(new_project)

        # Fetch source children with eager loads so the per-row clones
        # below don't N+1 against the DB.
        cpts_stmt = (
            select(CptOrm)
            .where(CptOrm.app_project_id == source_id)
            .options(selectinload(CptOrm.series))
        )
        boreholes_stmt = (
            select(BoreholeOrm)
            .where(BoreholeOrm.app_project_id == source_id)
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
        source_cpts = (await self._session.execute(cpts_stmt)).scalars().all()
        source_boreholes = (await self._session.execute(boreholes_stmt)).scalars().all()

        for cpt in source_cpts:
            self._session.add(_clone_cpt(cpt, new_project.id))
        for borehole in source_boreholes:
            self._session.add(_clone_borehole(borehole, new_project.id))

        await self._session.flush()
        self.success(
            f"Project {source_id} duplicated to {new_project.id} — "
            f"{len(source_cpts)} CPTs + {len(source_boreholes)} boreholes"
        )
        return new_project


# ---------------------------------------------------------------------------
# Deep-clone helpers — one per ORM class with non-trivial children. Each
# helper returns a fresh, unattached instance (cascade=all on the parent
# relationship inserts the children when the parent is added to a session).
# ---------------------------------------------------------------------------


def _clone_cpt(source: CptOrm, new_app_project_id: UUID) -> CptOrm:
    new_cpt = CptOrm(
        id=uuid7(),
        app_project_id=new_app_project_id,
        **_column_dict(source, _NEVER_COPY | {"app_project_id"}),
    )
    if source.series is not None:
        # ``cpt_series`` has no separate ``id`` column — its PK is the
        # ``cpt_id`` FK back to its parent (1:1 relationship). Cascade
        # writes the FK when the parent is added to the session, so we
        # don't pass an explicit id or cpt_id here.
        new_cpt.series = CptSeriesOrm(
            **_column_dict(source.series, _NEVER_COPY | {"cpt_id"}),
        )
    return new_cpt


def _clone_borehole(source: BoreholeOrm, new_app_project_id: UUID) -> BoreholeOrm:
    new_bh = BoreholeOrm(
        id=uuid7(),
        app_project_id=new_app_project_id,
        **_column_dict(source, _NEVER_COPY | {"app_project_id"}),
    )
    new_bh.drill_segments = [
        _clone_leaf(seg, parent_fk="borehole_id") for seg in source.drill_segments
    ]
    new_bh.field_log_intervals = [
        _clone_leaf(fl, parent_fk="borehole_id") for fl in source.field_log_intervals
    ]
    new_bh.observations = [_clone_observation(obs) for obs in source.observations]
    new_bh.samples = [_clone_sample(sample) for sample in source.samples]
    return new_bh


def _clone_observation(source: ObservationOrm) -> ObservationOrm:
    new_obs = ObservationOrm(
        id=uuid7(),
        **_column_dict(source, _NEVER_COPY | {"borehole_id"}),
    )
    new_obs.layers = [_clone_layer(layer) for layer in source.layers]
    return new_obs


def _clone_layer(source: ObservationLayerOrm) -> ObservationLayerOrm:
    new_layer = ObservationLayerOrm(
        id=uuid7(),
        **_column_dict(source, _NEVER_COPY | {"observation_id"}),
    )
    new_layer.admixtures = [
        _clone_leaf(admix, parent_fk="observation_layer_id") for admix in source.admixtures
    ]
    return new_layer


def _clone_sample(source: SampleOrm) -> SampleOrm:
    new_sample = SampleOrm(
        id=uuid7(),
        **_column_dict(source, _NEVER_COPY | {"borehole_id"}),
    )
    # All six lab-test families share the leaf-clone shape: copy every
    # column except id + sample_id, generate a new id, attach.
    new_sample.grain_sizes = [_clone_leaf(g, parent_fk="sample_id") for g in source.grain_sizes]
    new_sample.atterberg_limits_tests = [
        _clone_leaf(a, parent_fk="sample_id") for a in source.atterberg_limits_tests
    ]
    new_sample.caco3_content_tests = [
        _clone_leaf(c, parent_fk="sample_id") for c in source.caco3_content_tests
    ]
    new_sample.organic_content_tests = [
        _clone_leaf(o, parent_fk="sample_id") for o in source.organic_content_tests
    ]
    new_sample.water_content_tests = [
        _clone_leaf(w, parent_fk="sample_id") for w in source.water_content_tests
    ]
    new_sample.scalar_lab_tests = [
        _clone_leaf(s, parent_fk="sample_id") for s in source.scalar_lab_tests
    ]
    return new_sample


def _clone_leaf(source: Any, *, parent_fk: str) -> Any:
    """Generic leaf clone — fresh id, every column except id + parent_fk.

    Used for ORM rows with no children of their own (drill_segment,
    field_log_interval, admixture, the 6 lab-test families). The
    relationship cascade attaches the leaf when its parent is added.
    The parent reference is set by the caller's relationship-list
    assignment, NOT by writing the FK column directly here.
    """
    return source.__class__(
        id=uuid7(),
        **_column_dict(source, _NEVER_COPY | {parent_fk}),
    )
