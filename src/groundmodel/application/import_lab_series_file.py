"""Use case: preview and import one raw lab export (oedometer / triaxial).

Owner rules (2026-09-28 / 29) this use case carries:

* "we need to get the raw data in the db" — every reading of the file is
  stored (``lab_series_tree_builder``).
* Q4 "ask user, to double check, there should be a sample; if no, default
  create one; overlapping depths, yes same sample" — :meth:`preview` proposes
  the borehole (name ends with ``<job>-<borehole>``) and the sample (interval
  overlap) and writes NOTHING; :meth:`execute` attaches to the sample the user
  confirmed, or creates one with the lab's interval.
* Owner 2026-09-30: "Can't we just auto load from DOV when trying to load a
  lab tests and throw exception if it can't be found?" — when no project
  borehole matches, :meth:`preview` asks DOV for ``<job>-<borehole>`` and
  imports it into the project (the bbox import's building blocks,
  ``ImportBoreholeDov.execute_by_name``); DOV without it, or DOV not
  reachable, is said in the preview (``dov_lookup``), never a 500. This is
  the one write the preview does: the borehole, never the lab test.
* Re-import refreshes instead of skipping (Idempotency on ingest): the same
  identity with the same bytes is a no-op; with other bytes it replaces the
  stored readings — CONSENTED (409 until ``confirm_refresh``), never with a
  file carrying ERROR findings, and the test keeps its id.
"""

from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_borehole_dov import ImportBoreholeDov
from groundmodel.application.import_borehole_dov_by_name_result import (
    ImportBoreholeDovByNameResult,
)
from groundmodel.application.lab_series_import_result import LabSeriesImportResult
from groundmodel.application.lab_series_preview import LabSeriesPreview
from groundmodel.application.lab_series_tree_builder import (
    LabExportResult,
    build_lab_series_test,
    issues_to_json,
    lab_series_identity,
)
from groundmodel.domain.services.lab_sample_matching import (
    SampleCandidate,
    match_borehole_ids,
    match_sample,
)
from groundmodel.infrastructure.db.models.lab_series_test_orm import LabSeriesTestOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.repositories.lab_series_repository import (
    LabSeriesRepository,
)
from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_constants import (
    LAB_EXPORT_FORMAT_TX_DUMP,
)
from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_reader import (
    LabExportReader,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import (
    LabBoreholeConflictError,
    LabSeriesImportRefusedError,
    LabSeriesRefreshConfirmationRequiredError,
    LabSeriesRefreshRefusedError,
    NotFoundError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

DovBoreholeFetcher = Callable[[str, UUID], Awaitable[ImportBoreholeDovByNameResult]]
"""``(name, project_id) -> result``: import one borehole from DOV by name."""


class ImportLabSeriesFile(GroundModelLogger):
    """Preview / import one raw lab export into a project's sample."""

    def __init__(
        self, session: AsyncSession, *, dov_borehole_fetcher: DovBoreholeFetcher | None = None
    ) -> None:
        """Initialise with the request's session (the caller owns its lifetime).

        Parameters
        ----------
        session : AsyncSession
            The request's session.
        dov_borehole_fetcher : DovBoreholeFetcher or None
            Imports one borehole from DOV by name; default
            ``ImportBoreholeDov(session).execute_by_name`` (tests pass a fake).
        """
        super().__init__(__name__)
        self._session = session
        self._repo = LabSeriesRepository(session)
        self._fetch_dov_borehole: DovBoreholeFetcher = (
            dov_borehole_fetcher or self._import_borehole_from_dov
        )

    async def _import_borehole_from_dov(
        self, name: str, project_id: UUID
    ) -> ImportBoreholeDovByNameResult:
        """The default DOV fetcher, built only when a lookup is needed."""
        return await ImportBoreholeDov(self._session).execute_by_name(
            name, app_project_id=project_id
        )

    # ------------------------------------------------------------------ preview

    async def preview(
        self,
        file_path: Path,
        project_id: UUID,
        *,
        file_name: str | None = None,
        borehole_id: UUID | None = None,
    ) -> LabSeriesPreview:
        """Parse the file and propose where it goes — writes nothing.

        Parameters
        ----------
        file_path : pathlib.Path
            The uploaded file on disk.
        project_id : UUID
            The app project.
        file_name : str or None
            The upload's own name (default: ``file_path.name``).
        borehole_id : UUID or None
            The borehole the user picked; ``None`` = propose one from the
            lab's identity.

        Returns
        -------
        LabSeriesPreview
            Identity, borehole and sample proposals, the existing-test state
            and every finding.

        Raises
        ------
        ParseError
            When the file is none of the supported raw exports.
        NotFoundError
            When ``borehole_id`` is not a borehole of the project.
        LabBoreholeConflictError
            When the DOV borehole write clashed with a stored row (409).

        Notes
        -----
        When no project borehole matches, the borehole is fetched from DOV
        and written into the project (``dov_lookup``); nothing else is
        written.
        """
        name = file_name or file_path.name
        raw = file_path.read_bytes()
        self.info(f"lab-series preview: {name!r} ({len(raw)} B) for project {project_id}")
        result = LabExportReader().read(raw, source_name=name)
        identity = _identity_dict(result)
        preview = LabSeriesPreview(
            file_name=name,
            kind=lab_series_identity(result)[0],
            source_format=_source_format(result),
            test_type_token=lab_series_identity(result)[1],
            identity=identity,
            specimens=_specimen_summaries(result),
            issues=issues_to_json(result.issues),
            has_errors=result.has_errors,
        )

        names, candidates = await self._match_project_boreholes(identity, project_id)
        preview.borehole_candidates = [{"id": bid, "name": names[bid]} for bid in candidates]
        if borehole_id is not None:
            if await self._repo.get_borehole(borehole_id, project_id) is None:
                raise NotFoundError(f"borehole {borehole_id} is not in project {project_id}")
            preview.borehole_match = "chosen"
            preview.proposed_borehole_id = str(borehole_id)
        elif len(candidates) == 1:
            preview.borehole_match = "unique"
            preview.proposed_borehole_id = candidates[0]
        elif not candidates and identity["job_number"] and identity["borehole_name"]:
            await self._fetch_from_dov(preview, identity, project_id)
        else:
            preview.borehole_match = "ambiguous" if candidates else "none"

        if preview.proposed_borehole_id is not None:
            samples = await self._repo.list_samples(UUID(preview.proposed_borehole_id))
            preview.samples = [_sample_dict(s) for s in samples]
            sample_id, how = match_sample(
                identity["depth_top_m"],
                identity["depth_base_m"],
                identity["sample_number"],
                [
                    SampleCandidate(str(s.id), s.depth_top_m, s.depth_base_m, s.sample_number)
                    for s in samples
                ],
            )
            preview.proposed_sample_id, preview.sample_match = sample_id, how
        if identity["depth_top_m"] is not None and identity["depth_base_m"] is not None:
            preview.create_sample_default = {
                "depth_top_m": identity["depth_top_m"],
                "depth_base_m": identity["depth_base_m"],
                "sample_number": identity["sample_number"],
            }

        existing = await self._find_existing(result, project_id)
        if existing is not None:
            preview.existing_test = {
                "id": str(existing.id),
                "sample_id": str(existing.sample_id),
                "same_content": existing.source_sha256 == _sha256(raw),
            }
        self.success(
            f"lab-series preview {name!r}: {preview.kind} {identity['sample_number']!r}, "
            f"borehole {preview.borehole_match} ({len(candidates)} candidate(s)), sample "
            f"{preview.sample_match}, existing={preview.existing_test is not None}, "
            f"{len(preview.issues)} finding(s)"
        )
        return preview

    async def _match_project_boreholes(
        self, identity: dict[str, Any], project_id: UUID
    ) -> tuple[dict[str, str], list[str]]:
        """The project boreholes whose name OR DOV ``test_id`` ends with ``<job>-<borehole>``.

        The name is what the user sees and may rename; a DOV borehole's
        ``test_id`` (``1411-GEO-19/122-B7A``) stays DOV's own, so a renamed
        borehole still matches. Logs at INFO what was considered and, when
        nothing matched, the same-job boreholes that were rejected
        ("log what was NOT found").

        Parameters
        ----------
        identity : dict[str, Any]
            The lab's identity (``job_number``, ``borehole_name``).
        project_id : UUID
            The app project.

        Returns
        -------
        tuple[dict[str, str], list[str]]
            ``{id: name}`` of every project borehole, and the matching ids in
            list order (no duplicates).
        """
        boreholes = await self._repo.list_borehole_names(project_id)
        test_ids = await self._repo.list_borehole_test_ids(project_id)
        names = dict(boreholes)
        job, hole = identity["job_number"], identity["borehole_name"]
        by_name = match_borehole_ids(job, hole, boreholes)
        by_test_id = match_borehole_ids(job, hole, [(b, t) for b, t in test_ids if t])
        candidates = list(dict.fromkeys([*by_name, *by_test_id]))
        wanted = f"{job}-{hole}" if hole else f"{job}-*"
        self.info(
            f"lab-series preview: {len(boreholes)} project borehole(s) considered for "
            f"{wanted!r} (name or DOV test_id ends with it): {len(by_name)} by name, "
            f"{len(by_test_id)} by test_id -> {len(candidates)} candidate(s)"
        )
        if not candidates and job:
            # The matcher without a borehole = every borehole of the job.
            same_job = [names[b] for b in match_borehole_ids(job, None, boreholes)]
            shown = ", ".join(repr(n) for n in same_job[:20]) or "none"
            self.info(
                f"lab-series preview: no borehole ends with {wanted!r}; same-job boreholes "
                f"rejected ({len(same_job)}): {shown}"
            )
        return names, candidates

    async def _fetch_from_dov(
        self, preview: LabSeriesPreview, identity: dict[str, Any], project_id: UUID
    ) -> None:
        """No project borehole matched: ask DOV for ``<job>-<borehole>`` (in place).

        Found → imported into the project and proposed (``borehole_match``
        ``"unique"``). Already in the project (a concurrent preview stored it)
        → proposed, ``dov_lookup`` stays ``None``. Not found, or DOV not
        reachable → ``borehole_match`` ``"none"`` and ``dov_lookup`` says why;
        the user picks a borehole or the file is not imported. A DOV failure is never raised on.

        Raises
        ------
        LabBoreholeConflictError
            The borehole write clashed with a stored row that could not be
            returned instead (rolled back first).
        """
        name = "".join(f"{identity['job_number']}-{identity['borehole_name']}".split())
        preview.borehole_match = "none"
        self.info(f"lab-series preview: no project borehole ends with {name!r}; asking DOV")
        try:
            outcome = await self._fetch_dov_borehole(name, project_id)
        except IntegrityError as exc:
            # A borehole write that clashed and could not be resolved to the
            # stored row: roll back and refuse by name (409), never a 500.
            await self._session.rollback()
            self.warning(f"lab-series preview: borehole write for {name!r} clashed: {exc.orig!r}")
            raise LabBoreholeConflictError(name) from exc
        except (httpx.HTTPError, TimeoutError) as exc:
            self.warning(f"lab-series preview: DOV not reachable for {name!r}: {exc!r}")
            preview.dov_lookup = {
                "status": "unreachable",
                "borehole_name": name,
                "borehole_id": None,
            }
            return
        if outcome.borehole_id is None:
            self.warning(
                f"lab-series preview: DOV has no borehole {name!r} (found={outcome.found})"
            )
            preview.dov_lookup = {"status": "not_found", "borehole_name": name, "borehole_id": None}
            return
        bid = str(outcome.borehole_id)
        preview.borehole_candidates = [{"id": bid, "name": outcome.dov_name}]
        preview.borehole_match = "unique"
        preview.proposed_borehole_id = bid
        if outcome.already_in_project:
            # Stored meanwhile by another request (or missed by the name
            # match): a local match, not a DOV fetch — the desktop must not
            # list it as "fetched from DOV".
            self.info(
                f"lab-series preview: {outcome.dov_name!r} is already in the project as {bid}"
            )
            return
        self.success(f"lab-series preview: fetched {outcome.dov_name!r} from DOV as {bid}")
        preview.dov_lookup = {
            "status": "fetched",
            "borehole_name": outcome.dov_name,
            "borehole_id": bid,
        }

    # ------------------------------------------------------------------ execute

    async def execute(
        self,
        file_path: Path,
        project_id: UUID,
        *,
        borehole_id: UUID,
        file_name: str | None = None,
        sample_id: UUID | None = None,
        create_sample: bool = False,
        sample_depth_top_m: float | None = None,
        sample_depth_base_m: float | None = None,
        confirm_refresh: bool = False,
    ) -> LabSeriesImportResult:
        """Store the file's readings on the confirmed (or a new) sample.

        Parameters
        ----------
        file_path : pathlib.Path
            The uploaded file on disk.
        project_id : UUID
            The app project.
        borehole_id : UUID
            The borehole the user confirmed.
        file_name : str or None
            The upload's own name (default: ``file_path.name``).
        sample_id : UUID or None
            The existing sample to attach to.
        create_sample : bool
            Create a new sample instead (used when ``sample_id`` is ``None``).
        sample_depth_top_m, sample_depth_base_m : float or None
            The new sample's interval when the user entered one; default the
            lab's sampling interval.
        confirm_refresh : bool
            The user saw the diff and agreed to replace a stored test.

        Returns
        -------
        LabSeriesImportResult
            The stored test and sample, and what happened (created / refreshed
            / unchanged).

        Raises
        ------
        ParseError
            The file is none of the supported raw exports.
        NotFoundError
            The borehole or the sample is not in the project.
        LabSeriesImportRefusedError
            The sample choice cannot be honoured (422).
        LabSeriesRefreshConfirmationRequiredError
            Same identity, other content, not confirmed (409, nothing written).
        LabSeriesRefreshRefusedError
            Same identity, but the fresh parse has ERROR findings (422).
        """
        name = file_name or file_path.name
        raw = file_path.read_bytes()
        sha = _sha256(raw)
        self.info(
            f"lab-series import: {name!r} ({len(raw)} B) project {project_id} borehole "
            f"{borehole_id} sample {sample_id} create={create_sample} confirm={confirm_refresh}"
        )
        result = LabExportReader().read(raw, source_name=name)
        issues = issues_to_json(result.issues)
        kind = lab_series_identity(result)[0]

        existing = await self._find_existing(result, project_id)
        if existing is not None:
            return await self._refresh(existing, result, raw, name, sha, confirm_refresh)

        if await self._repo.get_borehole(borehole_id, project_id) is None:
            raise NotFoundError(f"borehole {borehole_id} is not in project {project_id}")
        sample, created = await self._resolve_sample(
            result,
            project_id,
            borehole_id,
            sample_id,
            create_sample,
            sample_depth_top_m,
            sample_depth_base_m,
        )
        test = build_lab_series_test(result, source_file_name=name, source_sha256=sha)
        test.sample_id = sample.id
        self._session.add(test)
        await self._session.commit()
        self.success(
            f"lab-series import {name!r}: {kind} test {test.id} on sample {sample.id} "
            f"(created sample: {created}), {test.n_specimens} specimen(s), "
            f"{len(issues)} finding(s)"
        )
        return LabSeriesImportResult(
            test_id=test.id,
            sample_id=sample.id,
            kind=kind,
            created_sample=created,
            issues=issues,
            has_errors=result.has_errors,
        )

    # ------------------------------------------------------------------ helpers

    async def _find_existing(
        self, result: LabExportResult, project_id: UUID
    ) -> LabSeriesTestOrm | None:
        """The stored test with the same lab identity, or ``None``."""
        kind, test_type, job, sample_number = lab_series_identity(result)
        if sample_number is None:
            # Without a sample number there is no identity to refresh against;
            # the test is new every time.
            return None
        return await self._repo.find_by_identity(
            project_id,
            kind=kind,
            test_type_token=test_type,
            lab_job_number=job,
            lab_sample_number=sample_number,
        )

    async def _refresh(
        self,
        existing: LabSeriesTestOrm,
        result: LabExportResult,
        raw: bytes,
        name: str,
        sha: str,
        confirm: bool,
    ) -> LabSeriesImportResult:
        """Same identity: no-op on the same bytes, else a consented replace."""
        issues = issues_to_json(result.issues)
        kind = lab_series_identity(result)[0]
        if existing.source_sha256 == sha:
            self.info(f"lab-series import {name!r}: identical to stored test {existing.id} — no-op")
            return LabSeriesImportResult(
                test_id=existing.id,
                sample_id=existing.sample_id,
                kind=kind,
                unchanged=True,
                issues=issues,
                has_errors=result.has_errors,
            )
        if result.has_errors:
            codes = sorted({i["code"] for i in issues if i["level"] == ValidationLevel.ERROR.value})
            self.warning(f"lab-series refresh of {existing.id} refused: ERROR findings {codes}")
            raise LabSeriesRefreshRefusedError(
                "parse_errors",
                f"{name}: the file has ERROR findings ({', '.join(codes)}); it will not "
                "replace the stored test",
            )
        old_specimens, old_readings = await self._repo.count_readings(existing.id)
        new_test = build_lab_series_test(result, source_file_name=name, source_sha256=sha)
        if not confirm:
            diff = {
                "old_n_specimens": old_specimens,
                "new_n_specimens": new_test.n_specimens,
                "old_n_readings": old_readings,
                "new_n_readings": sum(s.n_points for s in new_test.specimens),
                "old_source_file_name": existing.source_file_name,
                "new_source_file_name": name,
                "n_errors": 0,
                "n_warnings": sum(1 for i in issues if i["level"] == ValidationLevel.WARNING.value),
            }
            self.info(f"lab-series refresh of {existing.id} awaits confirmation: {diff}")
            raise LabSeriesRefreshConfirmationRequiredError(existing.id, diff)

        # Replace the whole tree in one transaction, keeping the test id and
        # its sample: delete the old row (the tree cascades), then insert the
        # new tree under the same id.
        test_id, sample_id, created_at = existing.id, existing.sample_id, existing.created_at
        await self._repo.delete_test(test_id)
        await self._session.flush()
        self._session.expunge(existing)
        new_test.id = test_id
        new_test.sample_id = sample_id
        new_test.created_at = created_at
        self._session.add(new_test)
        await self._session.commit()
        self.success(f"lab-series test {test_id} refreshed from {name!r} (consented)")
        return LabSeriesImportResult(
            test_id=test_id,
            sample_id=sample_id,
            kind=kind,
            refreshed=True,
            issues=issues,
            has_errors=result.has_errors,
        )

    async def _resolve_sample(
        self,
        result: LabExportResult,
        project_id: UUID,
        borehole_id: UUID,
        sample_id: UUID | None,
        create_sample: bool,
        top: float | None,
        base: float | None,
    ) -> tuple[SampleOrm, bool]:
        """The confirmed sample, or a new one; refuse what cannot be honoured."""
        if sample_id is not None:
            sample = await self._repo.get_sample(sample_id, project_id)
            if sample is None:
                raise NotFoundError(f"sample {sample_id} is not in project {project_id}")
            if sample.borehole_id != borehole_id:
                raise LabSeriesImportRefusedError(
                    "sample_not_on_borehole",
                    f"sample {sample_id} is not on borehole {borehole_id}",
                )
            return sample, False
        if not create_sample:
            raise LabSeriesImportRefusedError(
                "sample_choice_required",
                "choose an existing sample or ask for a new one (create_sample)",
            )
        identity = _identity_dict(result)
        top = top if top is not None else identity["depth_top_m"]
        base = base if base is not None else identity["depth_base_m"]
        if top is None or base is None or base < top:
            raise LabSeriesImportRefusedError(
                "sample_interval_required",
                "the export names no sampling interval: enter the new sample's depth "
                f"top and base (got {top!r} to {base!r})",
            )
        sample = SampleOrm(
            id=uuid7(),
            borehole_id=borehole_id,
            depth_top_m=top,
            depth_base_m=base,
            # The lab's own description and sample number, pass-through.
            description=identity["visual_description"] or "",
            sample_number=identity["sample_number"],
        )
        self._session.add(sample)
        await self._session.flush()
        self.info(f"lab-series import: created sample {sample.id} {top}-{base} m on {borehole_id}")
        return sample, True


# ---------------------------------------------------------------------------
# Module-private pure helpers
# ---------------------------------------------------------------------------


def _sha256(raw: bytes) -> str:
    """Hex SHA-256 of the file bytes (the idempotency stamp)."""
    return hashlib.sha256(raw).hexdigest()


def _source_format(result: LabExportResult) -> str:
    """The recognised export's format stamp."""
    if isinstance(result, OedometerListingResult):
        return result.source_format
    return LAB_EXPORT_FORMAT_TX_DUMP


def _identity_dict(result: LabExportResult) -> dict[str, Any]:
    """The lab's identity as written, one shape for both kinds."""
    if isinstance(result, OedometerListingResult):
        h = result.header
        return {
            "job_number": h.job_number,
            "borehole_name": h.borehole_name,
            "sequence_number": h.sequence_number,
            "sample_number": h.sample_number,
            "depth_top_m": h.depth_top_m,
            "depth_base_m": h.depth_base_m,
            "visual_description": h.visual_description,
        }
    return {
        "job_number": result.job_number,
        "borehole_name": result.borehole_name,
        "sequence_number": result.sequence_number,
        "sample_number": result.sample_number,
        "depth_top_m": result.depth_top_m,
        "depth_base_m": result.depth_base_m,
        "visual_description": result.visual_description,
    }


def _specimen_summaries(result: LabExportResult) -> list[dict[str, Any]]:
    """Per specimen: label, stage count, reading count."""
    if isinstance(result, OedometerListingResult):
        return [
            {
                "label": None,
                "n_stages": len(result.stages),
                "n_readings": sum(len(s.elapsed_min) for s in result.stages),
            }
        ]
    return [
        {"label": s.specimen_id, "n_stages": 1, "n_readings": len(s.point_numbers)}
        for s in result.specimens
    ]


def _sample_dict(sample: SampleOrm) -> dict[str, Any]:
    """A sample as the preview lists it."""
    return {
        "id": str(sample.id),
        "depth_top_m": sample.depth_top_m,
        "depth_base_m": sample.depth_base_m,
        "sample_number": sample.sample_number,
    }
