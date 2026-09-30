"""Use case: preview and import one raw lab export (oedometer / triaxial).

Owner rules (2026-09-28 / 29) this use case carries:

* "we need to get the raw data in the db" — every reading of the file is
  stored (``lab_series_tree_builder``).
* Q4 "ask user, to double check, there should be a sample; if no, default
  create one; overlapping depths, yes same sample" — :meth:`preview` proposes
  the borehole (name ends with ``<job>-<borehole>``) and the sample (interval
  overlap) and writes NOTHING; :meth:`execute` attaches to the sample the user
  confirmed, or creates one with the lab's interval.
* Re-import refreshes instead of skipping (Idempotency on ingest): the same
  identity with the same bytes is a no-op; with other bytes it replaces the
  stored readings — CONSENTED (409 until ``confirm_refresh``), never with a
  file carrying ERROR findings, and the test keeps its id.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

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
from groundmodel.infrastructure.parsers.lab.geosys.geosys_constants import GEOSYS_FORMAT_TX_DUMP
from groundmodel.infrastructure.parsers.lab.geosys.geosys_export_reader import (
    GeosysExportReader,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import (
    LabSeriesImportRefusedError,
    LabSeriesRefreshConfirmationRequiredError,
    LabSeriesRefreshRefusedError,
    NotFoundError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ImportLabSeriesFile(GroundModelLogger):
    """Preview / import one raw lab export into a project's sample."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with the request's session (the caller owns its lifetime)."""
        super().__init__(__name__)
        self._session = session
        self._repo = LabSeriesRepository(session)

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
        """
        name = file_name or file_path.name
        raw = file_path.read_bytes()
        self.info(f"lab-series preview: {name!r} ({len(raw)} B) for project {project_id}")
        result = GeosysExportReader().read(raw, source_name=name)
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

        boreholes = await self._repo.list_borehole_names(project_id)
        names = dict(boreholes)
        candidates = match_borehole_ids(
            identity["job_number"], identity["borehole_name"], boreholes
        )
        preview.borehole_candidates = [{"id": bid, "name": names[bid]} for bid in candidates]
        if borehole_id is not None:
            if await self._repo.get_borehole(borehole_id, project_id) is None:
                raise NotFoundError(f"borehole {borehole_id} is not in project {project_id}")
            preview.borehole_match = "chosen"
            preview.proposed_borehole_id = str(borehole_id)
        elif len(candidates) == 1:
            preview.borehole_match = "unique"
            preview.proposed_borehole_id = candidates[0]
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
        result = GeosysExportReader().read(raw, source_name=name)
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
    return GEOSYS_FORMAT_TX_DUMP


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
