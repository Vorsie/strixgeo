"""Use case: import a LOCAL DOV borehole XML file (one or several borings).

The file-side twin of ``ImportBoreholeDov`` (bbox) — same identity
(``project_id="DOV"`` + ``test_id`` = DOV identificatie), same ORM builders
(``dov_borehole_orm_builders``), so a boring imported from a file and the same
boring imported from a DOV bbox meet on the same row.

Duplicates follow the CPT re-import rule (CLAUDE.md "API Endpoints"): a boring
already in the project is REFRESHED IN PLACE — same borehole id, so every
interpretation anchored on it survives — but only with the caller's consent,
because the overwrite has no undo. Without ``confirm_refresh`` the use case
raises ``BoreholeRefreshConfirmationRequiredError`` carrying the old-vs-new
diff and writes NOTHING for the file. A boring whose fresh parse carries
errors is refused even when confirmed (``BoreholeRefreshRefusedError``).

One commit per file: either every boring of the file lands, or none does.
"""

from __future__ import annotations

import time
from datetime import date
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.dov_borehole_orm_builders import (
    apply_file_sample,
    build_borehole_orm,
    build_drill_segment_orms,
    build_field_log_orms,
    build_observation_layer_orms,
    build_observation_orm,
    build_sample_orm,
)
from groundmodel.application.import_borehole_file_result import ImportBoreholeFileResult
from groundmodel.application.imported_boring import ImportedBoring
from groundmodel.application.stale_investigation_caches import StaleInvestigationCaches
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    BoreholeRepository,
    borehole_full_tree_options,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_entry import (
    DovBoringFileEntry,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_parser import (
    DovBoringFileParser,
)
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_PROJECT_ID
from groundmodel.infrastructure.parsers.validation.validation_issue import make_issue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import (
    BoreholeRefreshConfirmationRequiredError,
    BoreholeRefreshRefusedError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since

# Header columns a refresh takes from the file WHEN THE FILE HAS A VALUE. A
# value the file lacks is kept: the stored row may carry it from the DOV WFS
# row (bbox import), and a local file is not the whole DOV record. Excluded on
# purpose: id / app_project_id / project_id / test_id (identity and scope),
# drill_method (WFS-only summary), elevation (handled separately so a manual
# collar edit outranks the file, debt #8).
_REFRESHED_HEADER_COLUMNS: tuple[str, ...] = (
    "name",
    "location_x",
    "location_y",
    "epsg",
    "start_date",
    "borehole_type",
    "purpose",
    "municipality",
    "executor",
    "total_depth_m",
    "water_table_depth_m",
)

# Code of the ERROR a new boring gets when it is not persisted.
NOT_IMPORTED_CODE = "NOT_IMPORTED"


class ImportBoreholeFile(GroundModelLogger):
    """Parse a local DOV borehole XML file and persist every boring in it.

    Parameters
    ----------
    session : AsyncSession
        Database session; committed once per file on success.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = BoreholeRepository(session)

    async def execute(
        self,
        file_path: Path,
        app_project_id: UUID | None,
        *,
        confirm_refresh: bool = False,
        today: date | None = None,
        file_name: str | None = None,
    ) -> ImportBoreholeFileResult:
        """Import every boring of *file_path* into *app_project_id*.

        Parameters
        ----------
        file_path : Path
            The XML file.
        app_project_id : UUID | None
            Project scope for storage and duplicate detection.
        confirm_refresh : bool
            The user has seen the diff and asked for the replacement of the
            borings already in the project. Defaults to False, which makes the
            confirmation refusal the safe default.
        today : date | None
            Reference date for the DATE_IN_FUTURE flag (tests pin it).
        file_name : str | None
            The name the user knows the file by (the upload's name; the route
            hands a temp file). Defaults to ``file_path.name``.

        Returns
        -------
        ImportBoreholeFileResult
            One ``ImportedBoring`` per boring plus file-level findings.

        Raises
        ------
        ParseError
            When the file is not XML or holds no ``<boring>``.
        BoreholeRefreshRefusedError
            When a boring already in the project has a fresh parse with errors.
        BoreholeRefreshConfirmationRequiredError
            When borings are already in the project and ``confirm_refresh`` is
            False. Nothing is written.
        """
        t_total = time.perf_counter()
        self.info(
            f"Borehole file import started: {file_path.suffix} file "
            f"({file_path.stat().st_size} bytes), project={app_project_id}, "
            f"confirm_refresh={confirm_refresh}"
        )
        label = file_name or file_path.name
        self.debug(f"Borehole file import: file name {label!r}")
        parsed = DovBoringFileParser().parse(file_path.read_bytes(), name=label, today=today)
        entries = self._drop_repeats(parsed.borings)

        test_ids = [e.test_id for e in entries if e.test_id]
        existing_ids = await self._repo.find_existing_test_ids(
            DOV_PROJECT_ID, test_ids, app_project_id
        )
        duplicates = [e for e in entries if e.test_id in existing_ids]
        self.info(
            f"Borehole file import: {len(entries)} boring(s), "
            f"{len(duplicates)} already in the project"
        )

        # Order matters (the CPT rule): refuse an unusable file BEFORE asking
        # for consent — no confirmation may authorise replacing a good
        # borehole with a broken parse.
        for entry in duplicates:
            if entry.borehole.has_errors:
                codes = ", ".join(
                    sorted({i.code for i in entry.issues if i.level == ValidationLevel.ERROR})
                )
                self.warning(
                    f"Borehole file refresh refused (id={existing_ids[entry.test_id]}): "
                    f"parse errors [{codes}]; nothing written"
                )
                raise BoreholeRefreshRefusedError(
                    "parse_errors",
                    f"The file's boring {entry.name!r} parsed with errors ({codes}), so it "
                    "cannot replace the stored borehole. Nothing was imported from this file.",
                )

        stored = (
            await self._load_existing([existing_ids[e.test_id] for e in duplicates])
            if duplicates
            else {}
        )
        if duplicates and not confirm_refresh:
            diffs = [
                self._diff(stored[existing_ids[e.test_id]], e)
                for e in duplicates
                if existing_ids[e.test_id] in stored
            ]
            self.info(
                f"Borehole file import awaiting confirmation: {len(diffs)} refresh(es); "
                "nothing written"
            )
            raise BoreholeRefreshConfirmationRequiredError(diffs)

        result = ImportBoreholeFileResult(issues=list(parsed.issues))
        written = 0
        total = len(entries)
        for i, entry in enumerate(entries, 1):
            existing_id = existing_ids.get(entry.test_id)
            if existing_id is not None and existing_id in stored:
                await self._refresh(stored[existing_id], entry)
                result.boreholes.append(
                    ImportedBoring(
                        borehole_id=existing_id,
                        name=entry.name,
                        test_id=entry.test_id,
                        issues=entry.issues,
                        refreshed=True,
                    )
                )
                written += 1
                self.debug(f"Borehole file [{i}/{total}]: refreshed {existing_id}")
                continue
            outcome = await self._insert(entry, app_project_id)
            written += int(outcome.imported)
            result.boreholes.append(outcome)
            self.debug(
                f"Borehole file [{i}/{total}]: "
                f"{'imported ' + str(outcome.borehole_id) if outcome.imported else 'skipped'}"
            )

        if written:
            await self._session.commit()
        n_refreshed = sum(1 for b in result.boreholes if b.refreshed)
        n_skipped = sum(1 for b in result.boreholes if not b.imported)
        n_flags = sum(len(b.issues) for b in result.boreholes) + len(result.issues)
        self.success(
            f"Borehole file import done in {ms_since(t_total)} ms: "
            f"{written - n_refreshed} new, {n_refreshed} refreshed, {n_skipped} skipped, "
            f"{n_flags} finding(s)"
        )
        return result

    # ------------------------------------------------------------------
    # Steps
    # ------------------------------------------------------------------

    def _drop_repeats(self, entries: list[DovBoringFileEntry]) -> list[DovBoringFileEntry]:
        """Keep the first boring per identificatie; flag and drop later repeats."""
        seen: set[str] = set()
        kept: list[DovBoringFileEntry] = []
        for entry in entries:
            if entry.test_id and entry.test_id in seen:
                self.warning("Borehole file: a boring appears twice in the file; second dropped")
                kept_entry = next(k for k in kept if k.test_id == entry.test_id)
                kept_entry.issues.append(
                    make_issue(
                        ValidationLevel.WARNING,
                        "DUPLICATE_BORING_IN_FILE",
                        f"{entry.name}: the file holds this boring twice; the second copy "
                        "was not imported",
                    )
                )
                continue
            seen.add(entry.test_id)
            kept.append(entry)
        return kept

    async def _insert(
        self, entry: DovBoringFileEntry, app_project_id: UUID | None
    ) -> ImportedBoring:
        """Persist a NEW boring (no flush); skip it when it has no usable position."""
        if entry.borehole.has_errors:
            # NO_COORDINATES / ZERO_COORDINATES: an unmappable borehole is not
            # safe to persist (the bbox import refuses the same row).
            entry.issues.append(
                make_issue(
                    ValidationLevel.ERROR,
                    NOT_IMPORTED_CODE,
                    f"{entry.name}: not imported, the boring has no usable position",
                )
            )
            self.warning(f"Borehole file: a new boring was skipped (errors) ({entry.test_id!r})")
            return ImportedBoring(
                borehole_id=None,
                name=entry.name,
                test_id=entry.test_id,
                issues=entry.issues,
                imported=False,
            )
        orm = build_borehole_orm(
            entry.borehole.borehole,
            entry.borehole,
            borehole_id=entry.borehole_key,
            test_id=entry.test_id,
            app_project_id=app_project_id,
        )
        await self._repo.save(orm, flush=False)
        for interp in entry.interpretations:
            obs = build_observation_orm(
                interp.result.observation, interp.permkey, borehole_id=orm.id
            )
            if obs is not None:
                self._session.add(obs)
        for sample in entry.samples:
            self._session.add(build_sample_orm(sample, orm.id))
        return ImportedBoring(
            borehole_id=orm.id, name=entry.name, test_id=entry.test_id, issues=entry.issues
        )

    async def _refresh(self, existing: BoreholeOrm, entry: DovBoringFileEntry) -> None:
        """Overwrite a stored borehole from the file, keeping its id.

        Header columns take the file's value when it has one; drill segments
        and field log are replaced wholesale; each interpretation whose DOV
        permkey matches a stored observation replaces that observation's
        layers IN PLACE (the observation id survives, so a contact or litho
        layer citing it as its source keeps the link — the per-layer link does
        not, the layers are new rows); other interpretations are added; stored
        observations the file does not carry are kept.
        """
        t_refresh = time.perf_counter()
        fresh = entry.borehole.borehole
        for column in _REFRESHED_HEADER_COLUMNS:
            value = getattr(fresh, column)
            if value is not None:
                setattr(existing, column, value)

        if existing.elevation_source == ElevationSource.MANUAL.value:
            self.info(
                f"Borehole file refresh {existing.id}: keeping the manual elevation "
                f"{existing.elevation_m} m (file says {fresh.elevation_m} m)"
            )
        elif fresh.elevation_m is not None:
            existing.elevation_m = fresh.elevation_m
            existing.z_epsg = fresh.z_epsg
            existing.elevation_source = ElevationSource.DOV.value

        existing.drill_segments = build_drill_segment_orms(entry.borehole)
        existing.field_log_intervals = build_field_log_orms(entry.borehole)
        existing.n_drill_segments = len(entry.borehole.drill_segments)
        existing.n_field_log_intervals = len(entry.borehole.field_log)

        by_permkey = {o.dov_permkey: o for o in existing.observations if o.dov_permkey}
        replaced = added = 0
        for interp in entry.interpretations:
            observation = interp.result.observation
            if not observation.layers:
                continue
            stored_obs = by_permkey.get(interp.permkey) if interp.permkey else None
            if stored_obs is not None:
                stored_obs.observation_type = observation.observation_type.value
                stored_obs.author = observation.author
                stored_obs.observation_date = observation.observation_date
                stored_obs.reliability = observation.reliability
                stored_obs.score_category = observation.score_category
                stored_obs.drill_method_score = observation.drill_method_score
                stored_obs.layers = build_observation_layer_orms(observation)
                replaced += 1
                continue
            obs = build_observation_orm(observation, interp.permkey, borehole_id=existing.id)
            if obs is not None:
                existing.observations.append(obs)
                added += 1

        samples_replaced, samples_added = self._refresh_samples(existing, entry)

        # The collar or the depths may have moved: every cached geometry
        # anchored on this borehole is rebuilt before it is trusted again.
        stale = await StaleInvestigationCaches(self._session).execute(borehole_id=existing.id)
        self.info(
            f"Borehole file refresh {existing.id}: {existing.n_drill_segments} segment(s), "
            f"{existing.n_field_log_intervals} field-log row(s), {replaced} observation(s) "
            f"replaced, {added} added, {samples_replaced} sample(s) refreshed, "
            f"{samples_added} added, {stale.surfaces} surface(s) + {stale.solids} solid(s) "
            f"staled in {ms_since(t_refresh)} ms"
        )

    @staticmethod
    def _refresh_samples(existing: BoreholeOrm, entry: DovBoringFileEntry) -> tuple[int, int]:
        """Refresh the stored samples from the file, like the observation streams.

        A file sample matches a stored one by DOV permkey, else (no permkey on
        either side) by sample number + top depth; a match is updated IN PLACE
        (same sample id, so its lab tests from a bbox import and its geotech
        assignment survive); an unmatched file sample is added; stored samples
        the file does not carry are kept (the file is not the whole record).

        Returns
        -------
        tuple[int, int]
            (refreshed, added) counts.
        """
        stored: list[SampleOrm] = list(existing.samples)
        by_permkey = {s.dov_permkey: s for s in stored if s.dov_permkey}
        by_number: dict[tuple[str | None, float], SampleOrm] = {
            (s.sample_number, s.depth_top_m): s for s in stored if s.sample_number
        }
        refreshed = added = 0
        for sample in entry.samples:
            match = (
                by_permkey.get(sample.permkey)
                if sample.permkey
                else by_number.get((sample.sample_number, sample.depth_top_m))
            )
            if match is not None:
                apply_file_sample(match, sample)
                refreshed += 1
                continue
            existing.samples.append(build_sample_orm(sample, existing.id))
            added += 1
        return refreshed, added

    async def _load_existing(self, ids: list[UUID]) -> dict[UUID, BoreholeOrm]:
        """Load the stored boreholes a refresh touches, with every child eager-loaded."""
        rows = await self._session.execute(
            select(BoreholeOrm)
            .where(BoreholeOrm.id.in_(ids))
            .options(*borehole_full_tree_options())
        )
        return {orm.id: orm for orm in rows.scalars().unique()}

    @staticmethod
    def _diff(existing: BoreholeOrm, entry: DovBoringFileEntry) -> dict[str, object]:
        """Build the old-vs-new diff one boring shows in the confirmation dialog."""
        old_layers = [
            len(o.layers)
            for o in existing.observations
            if o.observation_type == ObservationType.LITHOLOGICAL_DESCRIPTION.value
        ]
        primary = entry.primary_lithology
        return {
            "borehole_id": str(existing.id),
            "name": entry.name,
            "test_id": entry.test_id,
            "old_total_depth_m": existing.total_depth_m,
            "new_total_depth_m": entry.borehole.borehole.total_depth_m,
            "old_n_litho_layers": max(old_layers) if old_layers else 0,
            "new_n_litho_layers": primary.n_layers if primary is not None else 0,
            "n_errors": sum(1 for i in entry.issues if i.level == ValidationLevel.ERROR),
            "n_warnings": sum(1 for i in entry.issues if i.level == ValidationLevel.WARNING),
        }
