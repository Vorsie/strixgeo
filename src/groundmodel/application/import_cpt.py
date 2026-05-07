"""CPT import use case — parse a GEF file and persist it to the database."""

from pathlib import Path
from uuid import UUID

from geoalchemy2 import WKTElement
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.shared.exceptions import DuplicateCptError, ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


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

    async def execute(self, file_path: Path, app_project_id: UUID | None = None) -> ImportCptResult:
        """Parse *file_path* and persist the result.

        Parameters
        ----------
        file_path : Path
            Path to a CPT file. Only GEF (.gef) is supported in Phase 1.

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
        """
        self.info(f"Importing CPT: {file_path.name}")
        content = file_path.read_bytes()
        result = self._parse(file_path, content)

        # Duplicate guard: only when GEF file has both opdrachtnummer and proefnummer.
        h = result.header
        if h.project_id and h.test_id:
            existing = await self._repo.find_by_project_test(h.project_id, h.test_id)
            if existing is not None:
                raise DuplicateCptError(
                    f"CPT already exists: opdrachtnummer={h.project_id!r}, "
                    f"proefnummer={h.test_id!r} (id={existing.id})"
                )

        cpt_id: UUID = uuid7()
        cpt_orm = self._to_orm(cpt_id, file_path, result, app_project_id)

        await self._repo.save(cpt_orm)
        await self._session.commit()

        n_err = sum(1 for i in result.issues if i.level == "error")
        n_warn = sum(1 for i in result.issues if i.level == "warning")
        self.success(
            f"CPT imported: {cpt_id} ({len(result.data)} rows, {n_err} errors, {n_warn} warnings)"
        )
        return ImportCptResult(cpt_id=cpt_id, issues=result.issues)

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
        self, cpt_id: UUID, file_path: Path, result: GEFParseResult, app_project_id: UUID | None
    ) -> CptOrm:
        h = result.header
        df = result.data

        return CptOrm(
            id=cpt_id,
            app_project_id=app_project_id,
            name=h.test_id.strip() or file_path.stem,
            cpt_type=result.cpt_type.value,
            project_id=h.project_id,
            test_id=h.test_id,
            file_date=h.file_date or None,
            company=h.company or None,
            report_code=h.report_code or None,
            location_x=h.x or 0.0,
            location_y=h.y or 0.0,
            elevation_m=h.z,
            epsg=h.epsg,
            z_epsg=h.z_epsg,
            location=self._make_point(h),
            pre_drill_m=h.pre_drill_m,
            water_depth_m=h.water_depth_m,
            cone_area_ratio=h.net_area_ratio,
            cone_type_code=h.cone_type_code,
            stop_criterion=h.stop_criterion,
            max_depth_m=float(df["depth_m"].max()) if len(df) > 0 else None,
            n_rows=len(df),
            series=CptSeriesOrm(
                cpt_id=cpt_id,
                depths_m=df["depth_m"].to_list(),
                qc_mpa=df["qc_mpa"].to_list(),
                fs_mpa=df["fs_mpa"].to_list() if "fs_mpa" in df.columns else None,
                u2_mpa=df["u2_mpa"].to_list() if "u2_mpa" in df.columns else None,
                rf_pct=df["rf_pct"].to_list() if "rf_pct" in df.columns else None,
            ),
        )

    @staticmethod
    def _make_point(h: GEFHeader) -> WKTElement | None:
        """Build a PostGIS point in the native source CRS, or None if coordinates are missing."""
        if h.x is not None and h.y is not None and h.epsg is not None:
            return WKTElement(f"SRID={h.epsg};POINT({h.x} {h.y})")
        return None
