"""Newer oedometer module raw dump (``uit_nieuwemodule.csv``) → raw stages.

Format after geolib_rvo ``gui/gui_03_consolidatie.lees_nieuwe_module`` (owner's
own library), which reads this export for its consolidation analysis. Only the
file format is ported here; nothing of the library's analysis.

What the file is
----------------
The lab's newer compression module replaced the old program for oedometer tests. Its
raw export is a ``;``-separated UTF-8 file with a BOM::

    #Dossiernummer: GEO-23/099;;;;;;;;      ← "#<label>: <value>" header,
    #Monsternummer: 24/1036;;;;;;;;            padded with empty cells
    ...
    #Trapnummer;Datum/tijd;tijd sinds begin proef (s);...   ← column header
    #START_METINGEN;;;;;;;;
    1; 01/10/2024 07:22:36.246;0;0;-15,326;0;0;0,3017;0     ← one row per
    ...                                                        dial reading
    #EINDE_METINGEN;;;;;;;;

Every row carries its stage number, so stages are grouped by that column. The
dial is written in mm (the old listing wrote gauge units), deformations in mm,
the hanger load in kg, times in seconds and in minutes.

What the export does NOT carry
------------------------------
* No borehole name and no sampling depth — only the dossier and the lab sample
  number. The import preview asks the user for both (``NO_BOREHOLE_IN_EXPORT``).
* No stage stress and no loading / unloading token: the parser derives
  neither (Strix computes nothing at ingest). The logged hanger load is kept.
* No lab summary table.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_constants import (
    LAB_EXPORT_FORMAT_OED_NEW_RAW,
)
from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_text import (
    blank_to_none,
    parse_lab_number,
    parse_lab_value_unit,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_checks import (
    check_oedometer_readings,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_listing_header import (
    OedometerListingHeader,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_new_constants import (
    OED_NEW_ENCODING,
    OED_NEW_END_MARKER,
    OED_NEW_EXTRA_ELAPSED_STAGE_S,
    OED_NEW_EXTRA_ELAPSED_TEST_S,
    OED_NEW_EXTRA_LOAD_KG,
    OED_NEW_FIELD_COUNT,
    OED_NEW_HEADER_RE,
    OED_NEW_LABEL_DIAMETER,
    OED_NEW_LABEL_HEIGHT,
    OED_NEW_LABEL_JOB_NUMBER,
    OED_NEW_LABEL_LEVER_RATIO,
    OED_NEW_LABEL_MASS,
    OED_NEW_LABEL_SAMPLE_NUMBER,
    OED_NEW_LABEL_WATER_CONTENT,
    OED_NEW_START_MARKER,
    OED_NEW_TIMESTAMP_FORMAT,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_stage import OedometerStage
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class OedometerNewExportParser(GroundModelLogger):
    """Parse the newer oedometer module's raw dump into raw stages + findings."""

    def __init__(self) -> None:
        super().__init__(__name__)

    def parse(self, path: Path) -> OedometerListingResult:
        """Read and parse a raw export file.

        Parameters
        ----------
        path : pathlib.Path
            The ``uit_nieuwemodule.csv``-style file.

        Returns
        -------
        OedometerListingResult
            Header, every stage with every reading, findings. ``lab_summary``
            is empty (the export carries none).

        Raises
        ------
        ParseError
            When the file holds no reading row.
        """
        self.info("oedometer new-module export: reading %s", path)
        text = path.read_bytes().decode(OED_NEW_ENCODING)
        return self.parse_text(text, source_name=path.name)

    def parse_text(self, text: str, *, source_name: str) -> OedometerListingResult:
        """Parse export text already decoded (BOM stripped or not).

        Parameters
        ----------
        text : str
            The export text.
        source_name : str
            The file name, used in messages only.

        Returns
        -------
        OedometerListingResult
            Header, every stage with every reading, findings.

        Raises
        ------
        ParseError
            When the text holds no reading row.
        """
        lines = text.lstrip("﻿").splitlines()
        self.debug("oedometer new-module export %s: %d lines", source_name, len(lines))
        issues: list[ValidationIssue] = []
        raw: dict[str, str] = {}
        stages: dict[int, OedometerStage] = {}
        in_readings = False
        for line_no, line in enumerate(lines, start=1):
            if line.startswith(OED_NEW_START_MARKER):
                in_readings = True
                continue
            if line.startswith(OED_NEW_END_MARKER):
                in_readings = False
                continue
            if line.startswith("#"):
                match = OED_NEW_HEADER_RE.match(line)
                if match:
                    raw.setdefault(match.group(1).strip(), match.group(2).strip())
                continue
            if in_readings and line.strip():
                self._append_row(stages, line, line_no, issues)

        if not stages:
            self.error("oedometer new-module export %s: no reading rows", source_name)
            raise ParseError(f"{source_name}: no oedometer reading rows between the markers")

        result = OedometerListingResult(
            source_name=source_name,
            header=_build_header(raw),
            stages=[stages[k] for k in sorted(stages)],
            issues=issues,
            source_format=LAB_EXPORT_FORMAT_OED_NEW_RAW,
        )
        for stage in result.stages:
            _settle_stage_load(stage, result)
        self._check_identity(result)
        # The dial is already in mm here — one dial unit is one millimetre.
        check_oedometer_readings(result, dial_to_mm=1.0, logger=self)
        n_readings = sum(len(s.elapsed_min) for s in result.stages)
        self.info(
            "oedometer new-module export %s: dossier %s sample %s, %d stages, %d readings, "
            "%d issues",
            source_name,
            result.header.job_number,
            result.header.sample_number,
            len(result.stages),
            n_readings,
            len(issues),
        )
        if not result.has_errors:
            self.success("oedometer new-module export %s parsed", source_name)
        return result

    def _append_row(
        self,
        stages: dict[int, OedometerStage],
        line: str,
        line_no: int,
        issues: list[ValidationIssue],
    ) -> None:
        """Append one reading row to its stage (created on first sight)."""
        cells = line.split(";")
        if len(cells) < OED_NEW_FIELD_COUNT or not cells[0].strip().isdigit():
            issues.append(
                ValidationIssue(
                    ValidationLevel.ERROR,
                    "UNREADABLE_ROW",
                    f"line {line_no}: {len(cells)} cells, expected {OED_NEW_FIELD_COUNT} "
                    "starting with a stage number",
                    rows=[line_no],
                )
            )
            return
        number = int(cells[0].strip())
        stage = stages.get(number)
        if stage is None:
            stage = OedometerStage(
                stage_number=number, direction="", hanger_load_kg=None, stress_kpa=None
            )
            stage.extra_channels = {
                OED_NEW_EXTRA_LOAD_KG: [],
                OED_NEW_EXTRA_ELAPSED_STAGE_S: [],
                OED_NEW_EXTRA_ELAPSED_TEST_S: [],
            }
            stages[number] = stage
        try:
            stamp = datetime.strptime(cells[1].strip(), OED_NEW_TIMESTAMP_FORMAT)
        except ValueError:
            issues.append(
                ValidationIssue(
                    ValidationLevel.ERROR,
                    "UNREADABLE_ROW",
                    f"stage {number}: line {line_no} timestamp {cells[1].strip()!r} "
                    "is not dd/mm/yyyy hh:mm:ss.fff",
                    rows=[line_no],
                )
            )
            return
        values: list[float | None] = []
        for cell in cells[2:OED_NEW_FIELD_COUNT]:
            try:
                values.append(parse_lab_number(cell))
            except ValueError:
                values.append(None)
                issues.append(
                    ValidationIssue(
                        ValidationLevel.ERROR,
                        "UNREADABLE_VALUE",
                        f"stage {number}: line {line_no} value {cell.strip()!r} is not a number",
                        rows=[line_no],
                    )
                )
        elapsed_test_s, elapsed_stage_s, dial, total, settle, load, elapsed_min = values
        stage.timestamps.append(stamp)
        stage.dial_readings.append(dial)
        stage.elapsed_min.append(elapsed_min)
        stage.settlement_mm.append(settle)
        stage.total_settlement_mm.append(total)
        stage.extra_channels[OED_NEW_EXTRA_LOAD_KG].append(load)
        stage.extra_channels[OED_NEW_EXTRA_ELAPSED_STAGE_S].append(elapsed_stage_s)
        stage.extra_channels[OED_NEW_EXTRA_ELAPSED_TEST_S].append(elapsed_test_s)
        self.trace("stage %d reading %s", number, values)

    def _check_identity(self, result: OedometerListingResult) -> None:
        """Flag a missing sample number; say out loud what the export lacks."""
        h = result.header
        if h.sample_number is None:
            found = ", ".join(sorted(h.raw)) or "no labels"
            self.warning("oedometer %s: no sample number; labels: %s", result.source_name, found)
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.ERROR,
                    "MISSING_SAMPLE_IDENTITY",
                    f"sample={h.sample_number!r}; labels found: {found}",
                )
            )
        result.issues.append(
            ValidationIssue(
                ValidationLevel.INFO,
                "NO_BOREHOLE_IN_EXPORT",
                "this export names no borehole and no sampling depth (only the dossier "
                f"{h.job_number!r} and sample {h.sample_number!r}): pick the borehole and "
                "the sample by hand",
            )
        )


# ---------------------------------------------------------------------------
# Module-private pure helpers
# ---------------------------------------------------------------------------


def _settle_stage_load(stage: OedometerStage, result: OedometerListingResult) -> None:
    """Set the stage's hanger load from its logged loads; flag a change."""
    loads = [v for v in stage.extra_channels.get(OED_NEW_EXTRA_LOAD_KG, []) if v is not None]
    if not loads:
        return
    stage.hanger_load_kg = loads[-1]
    distinct = sorted(set(loads))
    if len(distinct) > 1:
        result.issues.append(
            ValidationIssue(
                ValidationLevel.WARNING,
                "LOAD_CHANGES_IN_STAGE",
                f"stage {stage.stage_number}: the logged load takes {len(distinct)} values "
                f"({distinct[0]} to {distinct[-1]} kg) inside one stage; the stage keeps "
                f"the last ({loads[-1]} kg)",
            )
        )


def _build_header(raw: dict[str, str]) -> OedometerListingHeader:
    """Promote the known ``#`` labels of ``raw`` to typed header fields."""
    return OedometerListingHeader(
        job_number=blank_to_none(raw.get(OED_NEW_LABEL_JOB_NUMBER)),
        sample_number=blank_to_none(raw.get(OED_NEW_LABEL_SAMPLE_NUMBER)),
        initial_height_mm=parse_lab_value_unit(raw.get(OED_NEW_LABEL_HEIGHT))[0],
        diameter_mm=parse_lab_value_unit(raw.get(OED_NEW_LABEL_DIAMETER))[0],
        wet_mass_g=parse_lab_value_unit(raw.get(OED_NEW_LABEL_MASS))[0],
        water_content_pct=parse_lab_value_unit(raw.get(OED_NEW_LABEL_WATER_CONTENT))[0],
        lever_ratio=parse_lab_value_unit(raw.get(OED_NEW_LABEL_LEVER_RATIO))[0],
        # The dial is written in mm: one unit is one millimetre.
        dial_coefficient_mm_per_unit=1.0,
        raw=raw,
    )
