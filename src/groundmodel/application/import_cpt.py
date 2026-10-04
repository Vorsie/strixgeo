"""CPT import use case — parse a GEF file and persist it to the database."""

import time
from pathlib import Path
from typing import cast
from uuid import UUID

import polars as pl
from geoalchemy2 import WKTElement
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.application.stale_investigation_caches import StaleInvestigationCaches
from groundmodel.domain.services.cpt_display_name import cpt_display_name
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.domain.value_objects.water_depth_source import WaterDepthSource
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import (
    CptRefreshConfirmationRequiredError,
    CptRefreshRefusedError,
    DuplicateCptError,
    ParseError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since

# Header / summary columns a refresh-on-duplicate import overwrites from the
# fresh parse. Deliberately EXCLUDES:
#   * ``id`` / ``app_project_id`` / ``created_at`` — identity and scope; every
#     other table (contacts, litho layers, reviews, sections) references the id.
#   * ``elevation_m`` / ``elevation_source`` — handled separately so a manual
#     collar edit outranks the file (debt #8, see ``ElevationSource.MANUAL``).
#   * ``water_depth_m`` / ``water_depth_source`` — handled separately for the
#     same reason (see ``WaterDepthSource.ENGINEER``).
#   * ``original_*`` — the elevation AND water-table rollback snapshots belong
#     to the engineer's override history, not to the file. A refresh leaves
#     them alone: the snapshot answers "what did I overwrite?", and a later
#     re-parse did not overwrite anything.
_REFRESHED_COLUMNS: tuple[str, ...] = (
    "name",
    "cpt_type",
    "project_id",
    "test_id",
    "file_date",
    "company",
    "report_code",
    "location_x",
    "location_y",
    "epsg",
    "z_epsg",
    "location",
    "pre_drill_m",
    "cone_area_ratio",
    "cone_type_code",
    "stop_criterion",
    "max_depth_m",
    "n_rows",
    # A re-read sounding's provenance is the fresh reading's (PDF digitiser);
    # a GEF / DOV refresh writes None, which is what a file import stores.
    "import_provenance",
)

# Series columns replaced wholesale on a refresh. The array columns ARE the
# measurement — a fresh parse of the same file is the authority on all of them.
_REFRESHED_SERIES_COLUMNS: tuple[str, ...] = (
    "depths_m",
    "qc_mpa",
    "fs_mpa",
    "u2_mpa",
    "rf_pct",
    "q_total_mpa",
    "rf_source",
)


def max_depth_m(df: pl.DataFrame) -> float | None:
    """Return the deepest reading in a parsed CPT frame, or None when empty.

    Single source of truth for the stored ``max_depth_m`` summary: the header
    column written on import and the old-vs-new diff a refresh confirmation is
    decided on must agree by construction, not by two copies of the same
    expression.

    Parameters
    ----------
    df : pl.DataFrame
        Parsed measurement rows; ``depth_m`` is required when non-empty.

    Returns
    -------
    float | None
        Maximum ``depth_m``, or ``None`` for a frame with no rows.
    """
    if len(df) == 0:
        return None
    return float(cast(float, df["depth_m"].max()))


class ImportCpt(GroundModelLogger):
    """Use case: parse a CPT file and persist it to the database.

    A *use case* in this architecture is a single, self-contained operation that
    orchestrates infrastructure components (parsers, repositories) without
    containing any domain logic itself.  It owns exactly one database transaction:
    the ``AsyncSession`` passed in is committed on success and left for the caller
    to roll back on failure.

    Typical call site::

        async with AsyncSessionFactory() as session:
            result = await ImportCpt(session).execute(Path("data/cpt/test.gef"))

    Or from a FastAPI route via ``Depends(get_session)``.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active AsyncSession; transaction is committed on success."""
        super().__init__(__name__)
        self._session = session
        self._repo = CptRepository(session)

    async def execute(
        self,
        file_path: Path,
        app_project_id: UUID | None = None,
        *,
        confirm_refresh: bool = False,
    ) -> ImportCptResult:
        """Parse *file_path* and persist the result.

        Parameters
        ----------
        file_path : Path
            Path to a CPT file. Only GEF (.gef) is supported in Phase 1.
        app_project_id : UUID | None, optional
            Project scope for duplicate detection and storage.
        confirm_refresh : bool, optional
            The caller has seen the old-vs-new diff and consented to replacing
            an existing row's data. Defaults to False — see :meth:`persist`.

        Returns
        -------
        ImportCptResult
            UUID of the saved CPT and the list of parse validation issues.

        Raises
        ------
        ParseError
            If the file format is unsupported or the file cannot be parsed.
        FileNotFoundError
            If *file_path* does not exist.
        CptRefreshConfirmationRequiredError
            When the CPT already exists and ``confirm_refresh`` is False.
        CptRefreshRefusedError
            When the fresh parse is too broken to overwrite stored data with.
        """
        # File name at DEBUG, not INFO: a GEF file name carries the project /
        # site code (client-identifying), and ``backend.log`` is unredacted on
        # disk. The always-on phase boundary is the completion line below, which
        # carries the stable ``cpt_id`` instead (owner: "no user data leaks").
        self.debug(f"Importing CPT: {file_path.name}")
        content = file_path.read_bytes()
        result = self._parse(file_path, content)
        # The NAME is "<project>-S<number>" for a bare sounding number (owner
        # ruling 2026-10-04); the stored project id + test id stay as the file
        # wrote them, because they are the duplicate key.
        name = cpt_display_name(result.header.project_id, result.header.test_id) or file_path.stem
        return await self.persist(result, name, app_project_id, confirm_refresh=confirm_refresh)

    async def persist(
        self,
        result: GEFParseResult,
        name: str,
        app_project_id: UUID | None = None,
        *,
        commit: bool = True,
        skip_duplicate_check: bool = False,
        refresh_existing: bool = True,
        confirm_refresh: bool = False,
    ) -> ImportCptResult:
        """Validate and persist an already-parsed CPT result.

        Parameters
        ----------
        result : GEFParseResult
            Parsed CPT data (from GEFParser, DovParser, or any other source).
        name : str
            Display name for the CPT record.
        app_project_id : UUID | None
            Project scope for duplicate detection and storage.
        commit : bool
            When True (default), commit the transaction after the insert. Bulk callers
            should pass False and commit once at the end of the batch — committing
            per CPT in a 200-row import burns 200 fsync round-trips for no benefit.
        skip_duplicate_check : bool
            When True, skip the per-CPT duplicate query. Bulk callers that have
            already done a single batch dedup pass should set this True.
        refresh_existing : bool
            When True (default), a CPT that already exists under this project is
            REFRESHED in place — series + header replaced from the fresh parse,
            same row id — and the result carries ``refreshed=True``. When False,
            the duplicate raises ``DuplicateCptError`` as before (kept for
            callers that must treat a re-import as an error rather than an
            update).
        confirm_refresh : bool
            The caller has shown the user the old-vs-new diff and been told to
            go ahead. A refresh destroys the stored series with no undo, so
            without this the duplicate raises
            ``CptRefreshConfirmationRequiredError`` carrying the diff instead of
            writing. Bulk / non-interactive callers that own their own
            confirmation pass True.

        Returns
        -------
        ImportCptResult
            UUID of the saved (or refreshed) CPT and the list of parse
            validation issues.

        Raises
        ------
        ParseError
            If XY coordinates are missing, or the file's coordinate-system
            code could not be resolved to an EPSG code.
        DuplicateCptError
            Only when ``refresh_existing`` is False and a CPT with the same
            project_id + test_id already exists in this project.
        CptRefreshConfirmationRequiredError
            When the CPT exists, ``refresh_existing`` is True and
            ``confirm_refresh`` is False.
        CptRefreshRefusedError
            When the CPT exists and the fresh parse has no rows or carries
            ERROR-level issues — refused regardless of confirmation.
        """
        h = result.header

        # Location is mandatory — a CPT without a CRS-tagged position cannot be placed
        # on a map or used in spatial queries.
        if h.x is None or h.y is None:
            raise ParseError(f"Cannot import '{name}': XY coordinates are required")
        if h.epsg is None:
            # Two different failures reach here and they need different
            # answers from the reader: a file that declared nothing, versus a
            # file that declared a coordinate-system code our codelist does
            # not carry. Quote the code so the second case is actionable
            # rather than looking like the first.
            if h.xy_code is not None:
                raise ParseError(
                    f"Cannot import '{name}': coordinate-system code {h.xy_code} is not a "
                    "known GEF code or supported EPSG, so the coordinates cannot be placed"
                )
            raise ParseError(
                f"Cannot import '{name}': coordinates are present but the file declares "
                "no coordinate-system code"
            )

        # Duplicate guard scoped to app_project_id so the same CPT can be imported into
        # different projects. project_id + test_id uniquely identify a CPT within its source.
        if not skip_duplicate_check and h.project_id and h.test_id:
            existing = await self._repo.find_by_project_test(
                h.project_id, h.test_id, app_project_id
            )
            if existing is not None:
                if not refresh_existing:
                    raise DuplicateCptError(
                        f"CPT already exists: contract_number={h.project_id!r}, "
                        f"test_number={h.test_id!r} (id={existing.id})",
                        existing_id=existing.id,
                    )
                # Order matters: refuse an unusable file BEFORE asking for
                # consent. There is nothing to consent to — no confirmation may
                # authorise replacing a good series with an empty one.
                self._refuse_unusable_refresh(result, name, existing_id=existing.id)
                if not confirm_refresh:
                    raise self._confirmation_required(existing, result, name)
                return await self._refresh(existing, result, name, commit=commit)

        cpt_id: UUID = uuid7()
        t_map = time.perf_counter()
        cpt_orm = self._to_orm(cpt_id, name, result, app_project_id)
        self.debug(f"ORM mapping: {ms_since(t_map)} ms ({len(result.data)} rows)")

        # In batch mode (commit=False) skip the per-row flush too — the final
        # commit will batch all INSERTs into one network exchange.
        t_save = time.perf_counter()
        await self._repo.save(cpt_orm, flush=commit)
        if commit:
            await self._session.commit()
        self.debug(f"DB save+{'commit' if commit else 'no-commit'}: {ms_since(t_save)} ms")

        n_err = sum(1 for i in result.issues if i.level == "error")
        n_warn = sum(1 for i in result.issues if i.level == "warning")
        self.success(
            f"CPT imported: {cpt_id} ({len(result.data)} rows, {n_err} errors, {n_warn} warnings)"
        )
        return ImportCptResult(cpt_id=cpt_id, issues=result.issues, name=name)

    # ------------------------------------------------------------------
    # Refresh-on-duplicate
    # ------------------------------------------------------------------

    def _refuse_unusable_refresh(
        self, result: GEFParseResult, name: str, *, existing_id: UUID | None = None
    ) -> None:
        """Refuse to overwrite a stored CPT with a parse that cannot be trusted.

        Two shapes qualify, and neither is recoverable by confirming: a parse
        with no data rows (a truncated download, a header-only export) and one
        carrying ERROR-level issues (non-monotonic depths, a missing required
        column). Both would replace a real measurement with a worse one, and a
        refresh has no undo.

        Parameters
        ----------
        result : GEFParseResult
            The fresh parse offered as a replacement.
        name : str
            Display name (the CPT test_id), carried in the user-facing refusal.
        existing_id : UUID | None
            Id of the stored CPT being protected. Logged INSTEAD of ``name`` so
            the always-on WARNING carries no client-identifying text — the name
            is the test_id, which encodes the project / site code, and
            ``backend.log`` is unredacted on disk (owner: "no user data leaks").
            The raised exception still names the CPT, because that message is
            shown to the engineer looking at their own project.

        Raises
        ------
        CptRefreshRefusedError
            When the fresh parse has zero rows or ERROR-level issues.
        """
        if len(result.data) == 0:
            self.warning(
                f"CPT refresh refused (id={existing_id}): the file parsed to 0 rows — "
                "the stored series is left untouched"
            )
            raise CptRefreshRefusedError(
                "no_rows",
                f"The file for {name!r} parsed to 0 data rows, so it cannot replace the "
                "stored measurements. The existing CPT was left untouched.",
            )

        errors = [i for i in result.issues if i.level == ValidationLevel.ERROR]
        if errors:
            codes = ", ".join(sorted({i.code for i in errors}))
            self.warning(
                f"CPT refresh refused (id={existing_id}): {len(errors)} parse error(s) "
                f"[{codes}] — the stored series is left untouched"
            )
            raise CptRefreshRefusedError(
                "parse_errors",
                f"The file for {name!r} parsed with {len(errors)} error(s) ({codes}), so it "
                "cannot replace the stored measurements. The existing CPT was left untouched.",
            )

    def _confirmation_required(
        self, existing: CptOrm, result: GEFParseResult, name: str
    ) -> CptRefreshConfirmationRequiredError:
        """Build the confirmation refusal, carrying the old-vs-new diff.

        Parameters
        ----------
        existing : CptOrm
            The stored row that would be overwritten.
        result : GEFParseResult
            The fresh parse offered as a replacement.
        name : str
            Display name from the fresh import.

        Returns
        -------
        CptRefreshConfirmationRequiredError
            Raised by the caller so the diff reaches the dialog.
        """
        df = result.data
        new_max_depth = max_depth_m(df)
        n_errors = sum(1 for i in result.issues if i.level == ValidationLevel.ERROR)
        n_warnings = sum(1 for i in result.issues if i.level == ValidationLevel.WARNING)
        # Id (not name) at INFO: the name is the test_id, which encodes the
        # project / site code, and ``backend.log`` is unredacted on disk. The
        # numeric diff carries no client identity. The name stays recoverable at
        # DEBUG, and the raised error still names the CPT for the engineer.
        self.info(
            f"CPT refresh awaiting confirmation (id={existing.id}): "
            f"{existing.n_rows} rows to {existing.max_depth_m} m → {len(df)} rows to "
            f"{new_max_depth} m"
        )
        self.debug(f"CPT refresh awaiting confirmation (id={existing.id}): name {name!r}")
        return CptRefreshConfirmationRequiredError(
            existing_id=existing.id,
            name=existing.name or name,
            old_max_depth_m=existing.max_depth_m,
            new_max_depth_m=new_max_depth,
            old_n_rows=existing.n_rows,
            new_n_rows=len(df),
            n_errors=n_errors,
            n_warnings=n_warnings,
        )

    async def _refresh(
        self,
        existing: CptOrm,
        result: GEFParseResult,
        name: str,
        *,
        commit: bool,
    ) -> ImportCptResult:
        """Overwrite an existing CPT row from a fresh parse, keeping its id.

        Re-importing a file the user already imported is how a parser fix
        reaches an existing project — the alternative (delete + re-import)
        destroys every interpretation anchored to the row. So the row is
        updated in place: the id, the project scope, the review status and
        every referencing row (contacts, litho layers, sections) survive.

        The cached geometries derived from this investigation (formation TINs,
        3-D body solids) are flipped to stale because a corrected series moves
        the contacts anchored on it — the same treatment an elevation edit gets.

        Parameters
        ----------
        existing : CptOrm
            The row found by the duplicate guard. Loaded without its series
            (``find_by_project_test`` does not eager-load), so the series is
            fetched here through the repository.
        result : GEFParseResult
            The fresh parse to write over the stored values.
        name : str
            Display name from the fresh import.
        commit : bool
            When True, commit the transaction; bulk callers pass False and
            commit once at the end of the batch.

        Returns
        -------
        ImportCptResult
            ``cpt_id`` of the EXISTING row, ``refreshed=True``, plus the fresh
            parse's validation issues.
        """
        t_refresh = time.perf_counter()
        # Build a throwaway ORM instance from the fresh parse so the
        # header→column mapping lives in exactly one place (``_to_orm``).
        # It is never added to the session; only its values are copied across.
        fresh = self._to_orm(existing.id, name, result, existing.app_project_id)

        for column in _REFRESHED_COLUMNS:
            setattr(existing, column, getattr(fresh, column))

        # A manual collar edit outranks the file — see ElevationSource.MANUAL
        # (debt #8). Anything else (gef / dov / none) is file-derived and the
        # fresh parse is the authority on it.
        if existing.elevation_source == ElevationSource.MANUAL.value:
            self.info(
                f"CPT refresh {existing.id}: keeping the manual elevation "
                f"{existing.elevation_m} m (file says {fresh.elevation_m} m)"
            )
        else:
            existing.elevation_m = fresh.elevation_m
            existing.elevation_source = fresh.elevation_source

        # An engineer-set water table outranks the file, for a reason that is
        # NOT symmetrical with the collar: the whole Robertson normalisation —
        # the Ic curve he validates against and the ghost boundaries he is
        # offered — hangs off this number. A re-parse silently moving it would
        # re-interpret a column he has already read, with no gesture from him.
        # Engineer judgement outranks a re-parse; clearing his value is an
        # explicit act (PATCH with null), never a side effect of an import.
        if existing.water_depth_source == WaterDepthSource.ENGINEER.value:
            self.info(
                f"CPT refresh {existing.id}: keeping the engineer's water table "
                f"{existing.water_depth_m} m (file says {fresh.water_depth_m} m)"
            )
        else:
            existing.water_depth_m = fresh.water_depth_m
            existing.water_depth_source = fresh.water_depth_source

        # Replace the series in place rather than swapping the relationship:
        # ``cpt_series.cpt_id`` is the primary key, so a delete-orphan plus an
        # insert of the same key in one flush can trip the PK constraint
        # depending on unit-of-work ordering. Mutating the loaded row cannot.
        stored = await self._session.get(CptSeriesOrm, existing.id)
        if stored is None:
            # Defensive: a header-only row (import interrupted before the
            # series landed) still refreshes into a complete CPT.
            #
            # Built explicitly rather than by adding ``fresh.series``: that
            # object back-populates ``series.cpt = fresh`` (``back_populates``
            # on CptSeriesOrm), and SQLAlchemy's default
            # ``save-update, merge`` cascade would pull the TRANSIENT ``fresh``
            # — which carries the SAME primary key as the persistent
            # ``existing`` — into the session, turning a graceful repair into a
            # FlushError on the identity conflict.
            self.warning(f"CPT refresh {existing.id}: no stored series — inserting one")
            self._session.add(
                CptSeriesOrm(
                    cpt_id=existing.id,
                    **{c: getattr(fresh.series, c) for c in _REFRESHED_SERIES_COLUMNS},
                )
            )
        else:
            for column in _REFRESHED_SERIES_COLUMNS:
                setattr(stored, column, getattr(fresh.series, column))

        # A corrected series moves every contact anchored here, so the derived
        # 3-D geometry has to be rebuilt before it can be trusted again.
        stale = await StaleInvestigationCaches(self._session).execute(cpt_id=existing.id)

        if commit:
            await self._session.commit()

        n_err = sum(1 for i in result.issues if i.level == "error")
        n_warn = sum(1 for i in result.issues if i.level == "warning")
        self.success(
            f"CPT refreshed in place: {existing.id} ({len(result.data)} rows, "
            f"{n_err} errors, {n_warn} warnings, {stale.surfaces} surface(s) + "
            f"{stale.solids} solid(s) staled) in {ms_since(t_refresh)} ms"
        )
        return ImportCptResult(cpt_id=existing.id, issues=result.issues, refreshed=True, name=name)

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse(self, file_path: Path, content: bytes) -> GEFParseResult:
        # Format is determined by file extension — GEF files always use .gef.
        # AGS (.ags) and LAS (.las) parsers will be added here in Phase 2.
        suffix = file_path.suffix.lower()
        if suffix == ".gef":
            return GEFParser().parse_bytes(content)
        raise ParseError(
            f"Unsupported CPT file format: {suffix!r} — only .gef is supported in Phase 1"
        )

    # ------------------------------------------------------------------
    # ORM mapping
    # ------------------------------------------------------------------

    def _to_orm(
        self, cpt_id: UUID, name: str, result: GEFParseResult, app_project_id: UUID | None
    ) -> CptOrm:
        h = result.header
        df = result.data

        # persist() guarantees x and y are non-None before _to_orm runs (it raises
        # ParseError otherwise). The asserts are here so mypy can narrow the types
        # AND a future refactor that bypasses persist() crashes loudly instead of
        # silently writing meaningless 0.0 coordinates to the DB.
        assert h.x is not None, "_to_orm called with header.x=None — persist() should have raised"
        assert h.y is not None, "_to_orm called with header.y=None — persist() should have raised"

        return CptOrm(
            id=cpt_id,
            app_project_id=app_project_id,
            name=name,
            cpt_type=result.cpt_type.value,
            project_id=h.project_id,
            test_id=h.test_id,
            file_date=h.file_date or None,
            company=h.company or None,
            report_code=h.report_code or None,
            location_x=h.x,
            location_y=h.y,
            elevation_m=h.z,
            # Provenance flag — see ``ElevationSource``. The parser
            # already stamped GEF / DOV / NONE on the result; we
            # forward it untouched so the refresh-on-duplicate path
            # can later overwrite imported Z without clobbering
            # manual edits (debt #8).
            elevation_source=result.elevation_source.value,
            epsg=h.epsg,
            z_epsg=h.z_epsg,
            location=self._make_point(h),
            pre_drill_m=h.pre_drill_m,
            water_depth_m=h.water_depth_m,
            # Provenance stamp — a depth here can only have come from
            # ``#MEASUREMENTVAR= 14``. NULL when the file records none, so the
            # consumer falls back to the assumption and says so.
            water_depth_source=(
                WaterDepthSource.GEF.value if h.water_depth_m is not None else None
            ),
            cone_area_ratio=h.net_area_ratio,
            cone_type_code=h.cone_type_code,
            stop_criterion=h.stop_criterion,
            max_depth_m=max_depth_m(df),
            n_rows=len(df),
            import_provenance=result.import_provenance,
            series=CptSeriesOrm(
                cpt_id=cpt_id,
                depths_m=df["depth_m"].to_list(),
                qc_mpa=df["qc_mpa"].to_list(),
                fs_mpa=df["fs_mpa"].to_list() if "fs_mpa" in df.columns else None,
                u2_mpa=df["u2_mpa"].to_list() if "u2_mpa" in df.columns else None,
                rf_pct=df["rf_pct"].to_list() if "rf_pct" in df.columns else None,
                # qt_mpa (CPTU corrected qc) is intentionally NOT persisted;
                # see cpt_series_orm.py and Data Integrity Rules §1. Source
                # qty 15 / DOV <Qt> for CPTU lands in the parser DataFrame
                # but is dropped here.
                q_total_mpa=(df["q_total_mpa"].to_list() if "q_total_mpa" in df.columns else None),
                rf_source=result.rf_source.value if result.rf_source else None,
            ),
        )

    @staticmethod
    def _make_point(h: GEFHeader) -> WKTElement | None:
        """Build a PostGIS point in the native source CRS, or None if coordinates are missing."""
        if h.x is not None and h.y is not None and h.epsg is not None:
            return WKTElement(f"SRID={h.epsg};POINT({h.x} {h.y})")
        return None
