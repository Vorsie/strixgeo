"""DigitisedBoreholeAdapter: a borehole read off a PDF -> the shapes the borehole import stores."""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from uuid6 import uuid7

from groundmodel.domain.models.borehole.borehole import Borehole
from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.domain.models.borehole.observation_layer import ObservationLayer
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_file_sample import DovFileSample
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    BOREHOLE_ID_MAX_CHARS,
    IMPORT_BLOCKING_ISSUES,
    ISSUE_INTERVAL_NOT_STORED,
    ISSUE_SAMPLE_ID_CUT,
    ISSUE_SAMPLE_NOT_STORED,
    PDF_BOREHOLE_FALLBACK_PROJECT_ID,
    SAMPLE_ID_MAX_CHARS,
)
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole import DigitisedBorehole
from groundmodel.infrastructure.parsers.borehole.pdf.pdf_borehole_import_entry import (
    PdfBoreholeImportEntry,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    make_issue,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DigitisedBoreholeAdapter(GroundModelLogger):
    """Shape a ``DigitisedBorehole`` for the borehole ORM builders.

    The PDF twin of the DOV file parser's entry building: header ->
    ``Borehole`` (no drill segments, no field log), intervals -> ONE
    lithological-description ``Observation`` whose layers carry the printed
    description verbatim and no DOV code (the track editor's rule parser is the
    description -> codes path), samples -> ``DovFileSample`` rows with the id
    verbatim, the water level -> ``water_table_depth_m``. Nothing is guessed:
    an interval or a sample without depths is not stored and is named in a
    finding.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def adapt(
        self,
        borehole: DigitisedBorehole,
        *,
        epsg: int | None,
        confirmations: dict[str, Any],
    ) -> PdfBoreholeImportEntry:
        """Return the import entry of one digitised borehole.

        Parameters
        ----------
        borehole : DigitisedBorehole
            As the triage parsed it.
        epsg : int or None
            The horizontal system to store: the printed one, or the one the
            user confirmed for X/Y printed without a system.
        confirmations : dict
            The user's confirmations (``crs``, ``water_unit_confirmed``),
            stored verbatim in the provenance.

        Returns
        -------
        PdfBoreholeImportEntry
            Ready for the use case; ``borehole`` is None when the sheets print
            no position.
        """
        header = borehole.header
        issues = list(borehole.issues)
        name = header.name[:BOREHOLE_ID_MAX_CHARS]
        printed_project = (header.project_code or "").strip()[:BOREHOLE_ID_MAX_CHARS]
        key = uuid7()
        start_date = _iso_date(header.date_iso)
        water = borehole.water_levels[0].depth_m if borehole.water_levels else None
        parse: BoreholeParseResult | None = None
        if header.x is not None and header.y is not None:
            parse = BoreholeParseResult(
                borehole=Borehole(
                    id=key,
                    name=name,
                    location_x=header.x,
                    location_y=header.y,
                    epsg=epsg,
                    elevation_m=header.ground_level_m,
                    z_epsg=header.z_epsg,
                    total_depth_m=header.total_depth_m,
                    start_date=start_date,
                    executor=header.driller,
                    water_table_depth_m=water,
                )
            )
        observation = self._observation(borehole, key, start_date, issues)
        samples, labels = self._samples(borehole, issues)
        provenance = {
            **borehole.provenance,
            # The printed header in full: the fields no borehole column holds
            # (surface label, remark, project name, identification standard,
            # the raw label/value pairs) are kept here (ruling 1).
            "header": header.to_dict(),
            # Ruling 2: layers that print only the drill technique / a sample
            # remark have no lithology; their depth ranges, so a later
            # grain-size result can be matched to them.
            "sampled_intervals_m": [
                [i.depth_top_m, i.depth_base_m]
                for i in borehole.intervals
                if i.lithology_absent_reason and i.depth_top_m is not None
            ],
            "confirmations": confirmations,
        }
        blocked = parse is None or any(i.code in IMPORT_BLOCKING_ISSUES for i in issues)
        self.debug(
            "adapted %s: %d layer(s), %d sample(s), blocked=%s",
            borehole.key,
            len(observation.layers) if observation else 0,
            len(samples),
            blocked,
        )
        return PdfBoreholeImportEntry(
            key=borehole.key,
            project_id=printed_project or PDF_BOREHOLE_FALLBACK_PROJECT_ID,
            test_id=name,
            name=name,
            borehole_key=key,
            borehole=parse,
            observation=observation,
            samples=samples,
            sample_labels=labels,
            provenance=provenance,
            issues=issues,
            blocked=blocked,
        )

    def _observation(
        self,
        borehole: DigitisedBorehole,
        borehole_key: UUID,
        observed: date | None,
        issues: list[ValidationIssue],
    ) -> Observation | None:
        """Return the description track, one layer per interval with depths."""
        observation = Observation(
            borehole_id=borehole_key,
            observation_type=ObservationType.LITHOLOGICAL_DESCRIPTION,
            observation_date=observed,
        )
        for interval in borehole.intervals:
            top, base = interval.depth_top_m, interval.depth_base_m
            if top is None or base is None or base <= top or top < 0:
                issues.append(
                    make_issue(
                        ValidationLevel.WARNING,
                        ISSUE_INTERVAL_NOT_STORED,
                        f"{borehole.header.name}: the interval {interval.description!r} has no "
                        "readable depth range; it was not stored",
                        {"text": interval.description, "top_m": top, "base_m": base},
                    )
                )
                continue
            observation.layers.append(
                ObservationLayer(
                    observation_id=observation.id,
                    top_m=top,
                    base_m=base,
                    # Verbatim (the raw upstream text, translated nowhere); a
                    # "sampled" interval keeps its drill-technique text here
                    # and has no code either way (ruling 2).
                    description=interval.description,
                    layer_index=len(observation.layers),
                )
            )
        return observation if observation.layers else None

    def _samples(
        self, borehole: DigitisedBorehole, issues: list[ValidationIssue]
    ) -> tuple[list[DovFileSample], dict[UUID, str | None]]:
        """Return the stored samples (as drawn, ruling 7) and their printed labels."""
        samples: list[DovFileSample] = []
        labels: dict[UUID, str | None] = {}
        for sample in borehole.samples:
            top, base = sample.depth_top_m, sample.depth_base_m
            if top is None or base is None:
                issues.append(
                    make_issue(
                        ValidationLevel.WARNING,
                        ISSUE_SAMPLE_NOT_STORED,
                        f"{borehole.header.name}: sample {sample.sample_id!r} could not be "
                        "placed on the depth axis; it was not stored",
                        {"sample_id": sample.sample_id},
                    )
                )
                continue
            number = sample.sample_id
            description = ""
            if len(number) > SAMPLE_ID_MAX_CHARS:
                issues.append(
                    make_issue(
                        ValidationLevel.WARNING,
                        ISSUE_SAMPLE_ID_CUT,
                        f"{borehole.header.name}: sample id {sample.sample_id!r} is longer than "
                        f"{SAMPLE_ID_MAX_CHARS} characters; cut, the whole id is in its "
                        "description",
                        {"sample_id": sample.sample_id, "max": SAMPLE_ID_MAX_CHARS},
                    )
                )
                number = number[:SAMPLE_ID_MAX_CHARS]
                description = sample.sample_id
            stored = DovFileSample(
                sample_key=uuid7(),
                permkey=None,
                # Verbatim, trailing character included (ruling 6).
                sample_number=number,
                depth_top_m=top,
                depth_base_m=base,
                description=description,
                sample_type=sample.sample_type,
            )
            samples.append(stored)
            label = sample.sample_label
            labels[stored.sample_key] = label[:SAMPLE_ID_MAX_CHARS] if label else None
        return samples, labels


def _iso_date(text: str | None) -> date | None:
    """Return the printed date as a ``date`` (None when absent or not a real date)."""
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None
