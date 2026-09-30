"""Geosys oedometer control listing (``*-LstSMControleListing``) → raw stages.

What the file is
----------------
Geosys (the owner's lab software) keeps each oedometer test in a native
``.OCT`` file and renders this "control listing" from it; the footer names the
``.OCT`` and the program version. The listing is the RAWEST oedometer export we
receive: per load step ("TRAP") it prints every reading the lab kept, with

* the absolute timestamp (``dd/mm/yyyy hh:mm:ss,fff``),
* the raw dial-gauge reading ("Afgelezen verplaatsing"),
* the elapsed time in minutes ("Tijd"),
* the stage settlement and the cumulative settlement, mm.

The ``.DAT`` next to it holds the SAME readings without timestamp and dial
value (verified: identical time and settlement on all 1648 readings of the two
real files), so the listing is the source of truth for raw data.

Layout (``;``-delimited in both the ``.csv`` and the ``.txt``; a tab-delimited
variant exists for other listings, so the delimiter is sniffed)::

    ControlelistingSamendrukkingsproef - 20/0568-B7A/N002Antwerpen,
    Opdrachtnummer :;GEO-19/122           ← "<label> :;<value>" header lines
    ...
    TRAP : 01 Belasting : 3,05 kg op het apparaat    93,568 kPa op het monster
    Afgelezen tijd;;Afgelezen;Tijd;Zetting;Totale zetting   ← 6 header cells
    ;;verplaatsing;(min);(mm);(mm)
    03/06/2020 07:58:47,282;-8,742;0,00;0,000;0,000        ← 5 data cells
    ...
    hi,0= 19,960 mm  Zetting= 0,751 mm                    ← stage footer
    ...
    Trap;Druk;Dhi;h;volumemassa;e;C (A);av;mv;Cc           ← lab summary
    ...
    Algemene gegevens / CreationMark / Filename / Version
    Controlegrafiek …                                       ← chart axis junk,
                                                              then the tables
                                                              AGAIN (ignored)

What the parser does NOT do
---------------------------
* Derive anything. Strain, void ratio, cv, Cc stay the lab's (``lab_summary``)
  or the downstream analysis's business.
* Repair a gauge re-zero. The settlement column already bridges it; the dial
  jump is reported (``DIAL_REZERO``) and the raw dial values are kept as read.
"""

from __future__ import annotations

import math
import re
from datetime import date, datetime
from pathlib import Path

from groundmodel.infrastructure.parsers.lab.geosys.geosys_constants import GEOSYS_ENCODING
from groundmodel.infrastructure.parsers.lab.geosys.geosys_text import (
    blank_to_none,
    parse_geosys_depth_range,
    parse_geosys_number,
    parse_geosys_value_unit,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_checks import (
    check_oedometer_readings,
    check_stage_counts,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_constants import (
    OED_CHART_MARKER,
    OED_FILENAME_RE,
    OED_GRAVITY_M_S2,
    OED_HEIGHT_CHAIN_TOLERANCE_MM,
    OED_LABEL_APPARATUS,
    OED_LABEL_BOREHOLE,
    OED_LABEL_BULK_DENSITY,
    OED_LABEL_CREATED,
    OED_LABEL_DEPTH,
    OED_LABEL_DESCRIPTION,
    OED_LABEL_DIAL_COEFFICIENT,
    OED_LABEL_DIAMETER,
    OED_LABEL_FILENAME,
    OED_LABEL_GRAIN_DENSITY,
    OED_LABEL_HEIGHT,
    OED_LABEL_JOB_NUMBER,
    OED_LABEL_LEVER_RATIO,
    OED_LABEL_MODIFIED,
    OED_LABEL_MOUNTING_DATE,
    OED_LABEL_ORIGIN,
    OED_LABEL_REMARKS,
    OED_LABEL_SAMPLE_NUMBER,
    OED_LABEL_SEQUENCE,
    OED_LABEL_VERSION,
    OED_LABEL_WATER_CONTENT,
    OED_LABEL_WET_MASS,
    OED_MOUNTING_DATE_FORMAT,
    OED_READING_FIELD_COUNT,
    OED_READING_RE,
    OED_STAGE_FOOTER_RE,
    OED_STAGE_HEADER_RE,
    OED_STRESS_REL_TOLERANCE,
    OED_SUMMARY_FIELD_COUNT,
    OED_SUMMARY_HEADER_CELLS,
    OED_TIMESTAMP_FORMAT,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_lab_summary_row import (
    OedometerLabSummaryRow,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_listing_header import (
    OedometerListingHeader,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_stage import OedometerStage
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_NOTE_RE = re.compile(r"\((.*)\)")


class OedometerControlListingParser(GroundModelLogger):
    """Parse a Geosys oedometer control listing into raw stages + findings."""

    def __init__(self) -> None:
        super().__init__(__name__)

    def parse(self, path: Path) -> OedometerListingResult:
        """Read and parse a control listing file.

        Parameters
        ----------
        path : pathlib.Path
            The ``*-LstSMControleListing.txt`` / ``.csv`` file.

        Returns
        -------
        OedometerListingResult
            Header, stages with every reading, the lab summary, findings.

        Raises
        ------
        ParseError
            When the text holds no ``TRAP`` stage block.
        """
        self.info("oedometer listing: reading %s", path)
        text = path.read_bytes().decode(GEOSYS_ENCODING)
        return self.parse_text(text, source_name=path.name)

    def parse_text(self, text: str, *, source_name: str) -> OedometerListingResult:
        """Parse control-listing text already decoded from ISO-8859-1.

        Parameters
        ----------
        text : str
            The listing text (CRLF or LF line ends).
        source_name : str
            The file name, used in messages only.

        Returns
        -------
        OedometerListingResult
            Header, stages with every reading, the lab summary, findings.

        Raises
        ------
        ParseError
            When the text holds no ``TRAP`` stage block.
        """
        lines = text.splitlines()
        delimiter = _sniff_delimiter(lines)
        self.debug(
            "oedometer listing %s: %d lines, delimiter %r", source_name, len(lines), delimiter
        )
        issues: list[ValidationIssue] = []
        raw: dict[str, str] = {}
        stages: list[OedometerStage] = []
        summary: list[OedometerLabSummaryRow] = []
        stage: OedometerStage | None = None
        in_summary = False
        summary_done = False
        after_chart = False

        for line_no, line in enumerate(lines, start=1):
            if line.startswith(OED_CHART_MARKER):
                # The chart axis dump is followed by a second copy of the
                # tables; reading on would double the summary rows.
                after_chart = True
                in_summary = False
                continue
            header = OED_STAGE_HEADER_RE.match(line)
            if header:
                stage = OedometerStage(
                    stage_number=int(header.group(1)),
                    direction=header.group(2),
                    hanger_load_kg=_number(header.group(3)),
                    stress_kpa=_number(header.group(4)),
                )
                stages.append(stage)
                continue
            reading = OED_READING_RE.match(line)
            if reading:
                if stage is not None:
                    self._append_reading(stage, reading, delimiter, line_no, issues)
                continue
            footer = OED_STAGE_FOOTER_RE.match(line)
            if footer:
                if stage is not None:
                    stage.height_at_start_mm = _number(footer.group(1))
                    stage.stage_settlement_mm = _number(footer.group(2))
                    stage.lab_coefficient_label = footer.group(3)
                    stage.lab_coefficient = _number(footer.group(4))
                stage = None
                continue
            cells = line.split(delimiter)
            if (
                not after_chart
                and not summary_done
                and tuple(c.strip() for c in cells[:3]) == OED_SUMMARY_HEADER_CELLS
            ):
                in_summary = True
                continue
            if in_summary:
                if len(cells) > 1 and cells[0] == "" and cells[1].strip().isdigit():
                    summary.append(_summary_row(cells[1:], line_no, issues))
                elif not line.strip() and summary:
                    in_summary = False
                    summary_done = True
                continue
            if stage is None and delimiter in line and not line.startswith(delimiter):
                key, _, value = line.partition(delimiter)
                label = key.strip().rstrip(":").strip()
                # The general section is printed twice; the first copy wins.
                raw.setdefault(label, value.strip())

        if not stages:
            self.error("oedometer listing %s: no TRAP stage block found", source_name)
            raise ParseError(f"{source_name}: no oedometer stage ('TRAP :') block found")

        result = OedometerListingResult(
            source_name=source_name,
            header=_build_header(raw, issues),
            stages=stages,
            lab_summary=summary,
            issues=issues,
        )
        self._check_identity(result)
        check_oedometer_readings(
            result,
            dial_to_mm=abs(result.header.dial_coefficient_mm_per_unit or 1.0),
            logger=self,
        )
        check_stage_counts(result)
        self._check_stress(result)
        self._check_height_chain(result)
        n_readings = sum(len(s.elapsed_min) for s in stages)
        self.info(
            "oedometer listing %s: sample %s borehole %s, %d stages, %d readings, "
            "%d summary rows, %d issues",
            source_name,
            result.header.sample_number,
            result.header.borehole_name,
            len(stages),
            n_readings,
            len(summary),
            len(issues),
        )
        if not result.has_errors:
            self.success("oedometer listing %s parsed", source_name)
        return result

    # ------------------------------------------------------------------ rows

    def _append_reading(
        self,
        stage: OedometerStage,
        match: re.Match[str],
        delimiter: str,
        line_no: int,
        issues: list[ValidationIssue],
    ) -> None:
        """Append one reading row to ``stage`` (parallel lists stay aligned)."""
        fields = match.group(2).split(delimiter)
        if len(fields) < OED_READING_FIELD_COUNT:
            issues.append(
                ValidationIssue(
                    ValidationLevel.ERROR,
                    "UNREADABLE_ROW",
                    f"stage {stage.stage_number}: line {line_no} has {len(fields)} reading "
                    f"cells, expected {OED_READING_FIELD_COUNT}",
                    rows=[line_no],
                )
            )
            return
        values: list[float | None] = []
        for cell in fields[:OED_READING_FIELD_COUNT]:
            try:
                values.append(parse_geosys_number(cell))
            except ValueError:
                values.append(None)
                issues.append(
                    ValidationIssue(
                        ValidationLevel.ERROR,
                        "UNREADABLE_VALUE",
                        f"stage {stage.stage_number}: line {line_no} value {cell!r} "
                        "is not a number",
                        rows=[line_no],
                    )
                )
        stage.timestamps.append(
            datetime.strptime(match.group(1).replace(",", "."), OED_TIMESTAMP_FORMAT)
        )
        stage.dial_readings.append(values[0])
        stage.elapsed_min.append(values[1])
        stage.settlement_mm.append(values[2])
        stage.total_settlement_mm.append(values[3])
        self.trace("stage %d reading %s", stage.stage_number, values)

    # ---------------------------------------------------------------- checks

    def _check_identity(self, result: OedometerListingResult) -> None:
        """Flag a listing that cannot be attached to a sample."""
        h = result.header
        if h.borehole_name is None or h.sample_number is None:
            found = ", ".join(sorted(h.raw)) or "no labels"
            self.warning(
                "oedometer %s: missing identity; labels found: %s", result.source_name, found
            )
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.ERROR,
                    "MISSING_SAMPLE_IDENTITY",
                    f"borehole={h.borehole_name!r} sample={h.sample_number!r}; "
                    f"labels found: {found}",
                )
            )
        if h.depth_top_m is None or h.depth_base_m is None:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "MISSING_SAMPLING_DEPTH",
                    f"sampling depth not readable: {h.raw.get(OED_LABEL_DEPTH)!r}",
                )
            )

    def _check_stress(self, result: OedometerListingResult) -> None:
        """Recompute each stage stress from hanger load, lever ratio and area."""
        h = result.header
        if h.lever_ratio is None or h.diameter_mm is None or h.diameter_mm <= 0:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.INFO,
                    "STRESS_NOT_CHECKED",
                    "lever ratio or diameter missing; stage stresses not cross-checked",
                )
            )
            return
        area_m2 = math.pi * (h.diameter_mm / 1000.0) ** 2 / 4.0
        for stage in result.stages:
            if stage.hanger_load_kg is None or not stage.stress_kpa:
                continue
            computed = stage.hanger_load_kg * h.lever_ratio * OED_GRAVITY_M_S2 / area_m2 / 1000.0
            if abs(computed - stage.stress_kpa) > OED_STRESS_REL_TOLERANCE * stage.stress_kpa:
                result.issues.append(
                    ValidationIssue(
                        ValidationLevel.WARNING,
                        "STRESS_NOT_REPRODUCED",
                        f"stage {stage.stage_number}: listed {stage.stress_kpa} kPa, "
                        f"{stage.hanger_load_kg} kg × {h.lever_ratio} × g / area "
                        f"= {computed:.3f} kPa",
                    )
                )

    def _check_height_chain(self, result: OedometerListingResult) -> None:
        """Stage n+1 must start at stage n's start height minus its settlement."""
        for prev, cur in zip(result.stages, result.stages[1:], strict=False):
            if None in (prev.height_at_start_mm, prev.stage_settlement_mm, cur.height_at_start_mm):
                continue
            expected = prev.height_at_start_mm - prev.stage_settlement_mm  # type: ignore[operator]
            if abs(expected - cur.height_at_start_mm) > OED_HEIGHT_CHAIN_TOLERANCE_MM:  # type: ignore[operator]
                result.issues.append(
                    ValidationIssue(
                        ValidationLevel.WARNING,
                        "HEIGHT_CHAIN_BROKEN",
                        f"stage {cur.stage_number} starts at {cur.height_at_start_mm} mm, "
                        f"stage {prev.stage_number} ended at {expected:.3f} mm",
                    )
                )


# ---------------------------------------------------------------------------
# Module-private pure helpers
# ---------------------------------------------------------------------------


def _sniff_delimiter(lines: list[str]) -> str:
    """Return ``";"`` or tab — whichever follows the job-number label first."""
    for line in lines:
        if line.startswith(OED_LABEL_JOB_NUMBER):
            semi, tab = line.find(";"), line.find("\t")
            if tab != -1 and (semi == -1 or tab < semi):
                return "\t"
            return ";"
    return ";"


def _number(raw: str | None) -> float | None:
    """Parse a regex-captured Geosys number; ``None`` when absent."""
    if raw is None:
        return None
    return parse_geosys_number(raw)


def _summary_row(
    cells: list[str], line_no: int, issues: list[ValidationIssue]
) -> OedometerLabSummaryRow:
    """Build one lab summary row from its cells (leading empty cell dropped)."""
    padded = (cells + [""] * OED_SUMMARY_FIELD_COUNT)[:OED_SUMMARY_FIELD_COUNT]
    values: list[float | None] = []
    for cell in padded[1:]:
        try:
            values.append(parse_geosys_number(cell))
        except ValueError:
            values.append(None)
            issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "UNREADABLE_SUMMARY_VALUE",
                    f"summary line {line_no}: {cell!r} is not a number",
                    rows=[line_no],
                )
            )
    return OedometerLabSummaryRow(int(padded[0].strip()), *values)


def _build_header(raw: dict[str, str], issues: list[ValidationIssue]) -> OedometerListingHeader:
    """Promote the known labels of ``raw`` to typed header fields."""
    top, base = parse_geosys_depth_range(raw.get(OED_LABEL_DEPTH))
    grain_value, grain_unit = parse_geosys_value_unit(raw.get(OED_LABEL_GRAIN_DENSITY))
    note = _NOTE_RE.search(grain_unit or "")
    filename_line = blank_to_none(raw.get(OED_LABEL_FILENAME))
    source_filename, saved_at = filename_line, None
    if filename_line:
        split = OED_FILENAME_RE.match(filename_line)
        if split:
            source_filename, saved_at = split.group(1), split.group(2)
    return OedometerListingHeader(
        job_number=blank_to_none(raw.get(OED_LABEL_JOB_NUMBER)),
        origin=blank_to_none(raw.get(OED_LABEL_ORIGIN)),
        borehole_name=blank_to_none(raw.get(OED_LABEL_BOREHOLE)),
        sequence_number=blank_to_none(raw.get(OED_LABEL_SEQUENCE)),
        sample_number=blank_to_none(raw.get(OED_LABEL_SAMPLE_NUMBER)),
        depth_top_m=top,
        depth_base_m=base,
        visual_description=blank_to_none(raw.get(OED_LABEL_DESCRIPTION)),
        initial_height_mm=parse_geosys_value_unit(raw.get(OED_LABEL_HEIGHT))[0],
        diameter_mm=parse_geosys_value_unit(raw.get(OED_LABEL_DIAMETER))[0],
        wet_mass_g=parse_geosys_value_unit(raw.get(OED_LABEL_WET_MASS))[0],
        water_content_pct=parse_geosys_value_unit(raw.get(OED_LABEL_WATER_CONTENT))[0],
        grain_density_t_m3=grain_value,
        grain_density_note=note.group(1) if note else None,
        bulk_density_t_m3=parse_geosys_value_unit(raw.get(OED_LABEL_BULK_DENSITY))[0],
        apparatus_number=blank_to_none(raw.get(OED_LABEL_APPARATUS)),
        lever_ratio=parse_geosys_value_unit(raw.get(OED_LABEL_LEVER_RATIO))[0],
        dial_coefficient_mm_per_unit=parse_geosys_value_unit(raw.get(OED_LABEL_DIAL_COEFFICIENT))[
            0
        ],
        mounting_date=_mounting_date(raw.get(OED_LABEL_MOUNTING_DATE), issues),
        remarks=blank_to_none(raw.get(OED_LABEL_REMARKS)),
        source_filename=source_filename,
        source_saved_at=saved_at,
        program_version=blank_to_none(raw.get(OED_LABEL_VERSION)),
        created_mark=blank_to_none(raw.get(OED_LABEL_CREATED)),
        modified_mark=blank_to_none(raw.get(OED_LABEL_MODIFIED)),
        raw=raw,
    )


def _mounting_date(raw: str | None, issues: list[ValidationIssue]) -> date | None:
    """Parse the two-digit-year mounting date; flag an unreadable one."""
    text = blank_to_none(raw)
    if text is None:
        return None
    try:
        return datetime.strptime(text, OED_MOUNTING_DATE_FORMAT).date()
    except ValueError:
        issues.append(
            ValidationIssue(
                ValidationLevel.WARNING,
                "UNREADABLE_DATE",
                f"mounting date {text!r} is not dd/mm/yy",
            )
        )
        return None
