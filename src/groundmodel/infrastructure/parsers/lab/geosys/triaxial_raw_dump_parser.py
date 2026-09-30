"""Geosys triaxial per-point dump (``cd.txt`` / ``cu.txt`` / ``advtx*.txt``) → specimens.

What the file is
----------------
The TX module (native ``.TRX``) and the Advanced TX module (native ``.ATT``)
both write this dump; the layout is identical. One dump = ONE sample and all
its sub-specimens ("deelmonsters" a, b, c — a specimen the lab set inactive is
simply absent). Per specimen it prints its metadata and a fixed-width table of
EVERY measuring point of the shear phase: the control and definitive listings
print a rounded ~43-point subsample of this same table (verified: every listed
point matches the dump to the printed precision), so the dump is the raw
source of truth.

Layout (tab-separated header, 18-character fixed-width table)::

    Gegevens van het monster
    Opdrachtnummer:\t\t\t\tGEO-25/022
    Type proef:\t\t\t\tCD
    ...
    Identificatiegegevens deelmonster \ta
    Vervormingssnelheid:\t\t\t0,020 mm/min
    ...
    Meetpunt          Kracht            Verpl.            Stnsp.   ...
    60                0                 0                 595,4404 ...
    ...
    Identificatiegegevens deelmonster \tb
    ...
    ----------------------------------------------------------------

What the dump does NOT hold (reported, not repaired)
----------------------------------------------------
* No time column — the shear phase cannot be put on a time axis
  (``NO_TIME_CHANNEL``); only the set strain rate is known.
* No saturation or consolidation readings — only the consolidation totals.
* Readings before the chosen zero reading (``READINGS_BEFORE_ZERO_NOT_IN_FILE``).
* Force and displacement are ALREADY zero-referenced by the lab.

The parser derives nothing; strain and stresses are carried as the lab's.
"""

from __future__ import annotations

from pathlib import Path

from groundmodel.infrastructure.parsers.lab.geosys.geosys_constants import GEOSYS_ENCODING
from groundmodel.infrastructure.parsers.lab.geosys.geosys_text import (
    blank_to_none,
    parse_geosys_depth_range,
    parse_geosys_number,
    parse_geosys_value_unit,
)
from groundmodel.infrastructure.parsers.lab.geosys.triaxial_constants import (
    TX_CALIBRATION_RE,
    TX_COLUMN_WIDTH,
    TX_DEVIATOR_OFFSET_TOLERANCE_KPA,
    TX_END_MARKER,
    TX_HEADER_LINE_RE,
    TX_LAB_DERIVED_CHANNELS,
    TX_LABEL_AREA,
    TX_LABEL_BOREHOLE,
    TX_LABEL_CALIBRATION_FILE,
    TX_LABEL_CONSOLIDATION_DV,
    TX_LABEL_CONSOLIDATION_STRESS,
    TX_LABEL_DEPTH,
    TX_LABEL_DESCRIPTION,
    TX_LABEL_DIAMETER,
    TX_LABEL_DRY_MASS,
    TX_LABEL_FAILURE,
    TX_LABEL_FINAL_DV,
    TX_LABEL_FINAL_WET_MASS,
    TX_LABEL_GRAIN_DENSITY,
    TX_LABEL_HEIGHT,
    TX_LABEL_IMPORT_FILE,
    TX_LABEL_JOB_NUMBER,
    TX_LABEL_ORIGIN,
    TX_LABEL_PRESS,
    TX_LABEL_REPORT_FOR,
    TX_LABEL_SAMPLE_NUMBER,
    TX_LABEL_SEQUENCE,
    TX_LABEL_STRAIN_RATE,
    TX_LABEL_TEST_TYPE,
    TX_LABEL_VOLUME,
    TX_LABEL_WET_MASS,
    TX_MEASURED_CHANNELS,
    TX_SPECIMEN_RE,
    TX_STRAIN_OFFSET_TOLERANCE_PCT,
    TX_TABLE_HEADER_LABEL,
    TX_TABLE_ROW_RE,
    TX_VALUE_SPLIT_RE,
)
from groundmodel.infrastructure.parsers.lab.geosys.triaxial_dump_result import (
    TriaxialDumpResult,
)
from groundmodel.infrastructure.parsers.lab.geosys.triaxial_specimen import TriaxialSpecimen
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class TriaxialRawDumpParser(GroundModelLogger):
    """Parse a Geosys triaxial per-point dump into specimens + findings."""

    def __init__(self) -> None:
        super().__init__(__name__)

    def parse(self, path: Path) -> TriaxialDumpResult:
        """Read and parse a triaxial dump file.

        Parameters
        ----------
        path : pathlib.Path
            ``cd.txt`` / ``cu.txt`` / ``advtx*.txt``.

        Returns
        -------
        TriaxialDumpResult
            Sample identity, every specimen with every point, findings.

        Raises
        ------
        ParseError
            When the text holds no specimen block, or no specimen has a
            point table.
        """
        self.info("triaxial dump: reading %s", path)
        text = path.read_bytes().decode(GEOSYS_ENCODING)
        return self.parse_text(text, source_name=path.name)

    def parse_text(self, text: str, *, source_name: str) -> TriaxialDumpResult:
        """Parse dump text already decoded from ISO-8859-1.

        Parameters
        ----------
        text : str
            The dump text (CRLF or LF line ends).
        source_name : str
            The file name, used in messages only.

        Returns
        -------
        TriaxialDumpResult
            Sample identity, every specimen with every point, findings.

        Raises
        ------
        ParseError
            When the text holds no specimen block, or no specimen has a
            point table.
        """
        lines = text.splitlines()
        self.debug("triaxial dump %s: %d lines", source_name, len(lines))
        result = TriaxialDumpResult(source_name=source_name)
        specimen: TriaxialSpecimen | None = None
        columns: list[str | None] | None = None
        warned_blank: set[str] = set()

        for line_no, line in enumerate(lines, start=1):
            start = TX_SPECIMEN_RE.match(line)
            if start:
                specimen = TriaxialSpecimen(specimen_id=start.group(1))
                result.specimens.append(specimen)
                columns = None
                continue
            if line.startswith(TX_END_MARKER) or (columns is not None and not line.strip()):
                columns = None
                continue
            if specimen is not None and line.startswith(TX_TABLE_HEADER_LABEL):
                columns = self._open_table(specimen, line, result)
                continue
            if columns is not None and specimen is not None and TX_TABLE_ROW_RE.match(line):
                self._append_row(specimen, columns, line, line_no, result, warned_blank)
                continue
            self._header_line(line, specimen, result)

        if not result.specimens:
            self.error("triaxial dump %s: no specimen block found", source_name)
            raise ParseError(f"{source_name}: no 'Identificatiegegevens deelmonster' block found")
        if not any(s.point_numbers for s in result.specimens):
            self.error("triaxial dump %s: no specimen has a point table", source_name)
            raise ParseError(
                f"{source_name}: no specimen carries a '{TX_TABLE_HEADER_LABEL}' table"
            )

        _promote_sample_fields(result)
        for s in result.specimens:
            _promote_specimen_fields(s)
        self._check(result)
        self.info(
            "triaxial dump %s: %s sample %s borehole %s, specimens %s, points %s, %d issues",
            source_name,
            result.test_type,
            result.sample_number,
            result.borehole_name,
            [s.specimen_id for s in result.specimens],
            [len(s.point_numbers) for s in result.specimens],
            len(result.issues),
        )
        if not result.has_errors:
            self.success("triaxial dump %s parsed", source_name)
        return result

    # ------------------------------------------------------------- the table

    def _open_table(
        self, specimen: TriaxialSpecimen, line: str, result: TriaxialDumpResult
    ) -> list[str | None]:
        """Slice the table header into per-column keys; create the channels."""
        labels = [
            line[i : i + TX_COLUMN_WIDTH].strip() for i in range(0, len(line), TX_COLUMN_WIDTH)
        ]
        keys: list[str | None] = []
        for index, label in enumerate(labels):
            if index == 0:
                keys.append(None)  # the point-number column, read separately
            elif not label:
                keys.append(None)  # a blank slot: the test type does not fill it
            elif label in TX_MEASURED_CHANNELS:
                keys.append(label)
                specimen.measured[TX_MEASURED_CHANNELS[label]] = []
            elif label in TX_LAB_DERIVED_CHANNELS:
                keys.append(label)
                specimen.lab_derived[TX_LAB_DERIVED_CHANNELS[label]] = []
            else:
                keys.append(label)
                specimen.unclassified[label] = []
                result.issues.append(
                    ValidationIssue(
                        ValidationLevel.INFO,
                        "UNKNOWN_CHANNEL",
                        f"specimen {specimen.specimen_id}: column {label!r} kept unclassified",
                    )
                )
        self.debug("specimen %s table columns %s", specimen.specimen_id, labels)
        return keys

    def _append_row(
        self,
        specimen: TriaxialSpecimen,
        columns: list[str | None],
        line: str,
        line_no: int,
        result: TriaxialDumpResult,
        warned_blank: set[str],
    ) -> None:
        """Append one fixed-width row; every channel gets exactly one value."""
        specimen.point_numbers.append(int(line[:TX_COLUMN_WIDTH].strip()))
        for index, label in enumerate(columns):
            if index == 0:
                continue
            cell = line[index * TX_COLUMN_WIDTH : (index + 1) * TX_COLUMN_WIDTH]
            if label is None:
                if cell.strip() and specimen.specimen_id not in warned_blank:
                    warned_blank.add(specimen.specimen_id)
                    result.issues.append(
                        ValidationIssue(
                            ValidationLevel.WARNING,
                            "VALUE_UNDER_BLANK_HEADER",
                            f"specimen {specimen.specimen_id}: line {line_no} has {cell.strip()!r} "
                            f"in column {index + 1}, which has no header label (value dropped)",
                            rows=[line_no],
                        )
                    )
                continue
            try:
                value = parse_geosys_number(cell)
            except ValueError:
                value = None
                result.issues.append(
                    ValidationIssue(
                        ValidationLevel.ERROR,
                        "UNREADABLE_VALUE",
                        f"specimen {specimen.specimen_id}: line {line_no} column {label!r} "
                        f"value {cell.strip()!r} is not a number",
                        rows=[line_no],
                    )
                )
            _channel(specimen, label).append(value)

    # ------------------------------------------------------------ the header

    def _header_line(
        self, line: str, specimen: TriaxialSpecimen | None, result: TriaxialDumpResult
    ) -> None:
        """Store a ``label<TAB>value`` line on the specimen (or the sample)."""
        match = TX_HEADER_LINE_RE.match(line)
        if match is None:
            return
        label = match.group(1).strip()
        values = [v.strip() for v in TX_VALUE_SPLIT_RE.split(match.group(2)) if v.strip()]
        if specimen is None:
            result.raw.setdefault(label, values)
            return
        specimen.raw.setdefault(label, values)
        calibration = TX_CALIBRATION_RE.match(label)
        if calibration and values:
            a, b = specimen.calibration.get(calibration.group(2), (None, None))
            number = parse_geosys_value_unit(values[0])[0]
            specimen.calibration[calibration.group(2)] = (
                (number, b) if calibration.group(1) == "a" else (a, number)
            )

    # -------------------------------------------------------------- findings

    def _check(self, result: TriaxialDumpResult) -> None:
        """Report what the dump lacks and the offsets it carries."""
        result.issues.append(
            ValidationIssue(
                ValidationLevel.INFO,
                "NO_TIME_CHANNEL",
                "the dump has no time column: the shear phase has no time axis "
                "(only the set strain rate is known)",
            )
        )
        letters = [s.specimen_id for s in result.specimens]
        expected = [chr(ord("a") + i) for i in range(ord(max(letters)) - ord("a") + 1)]
        missing = [x for x in expected if x not in letters]
        if missing and all(len(x) == 1 for x in letters):
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.INFO,
                    "SPECIMEN_LETTER_GAP",
                    f"specimens {letters} present, {missing} absent (set inactive by the lab?)",
                )
            )
        for s in result.specimens:
            self._check_specimen(s, result)

    def _check_specimen(self, s: TriaxialSpecimen, result: TriaxialDumpResult) -> None:
        """Per-specimen checks on the first row and the point sequence."""
        tag = f"specimen {s.specimen_id}"
        if not s.point_numbers:
            result.issues.append(
                ValidationIssue(ValidationLevel.ERROR, "NO_POINT_TABLE", f"{tag}: no point table")
            )
            return
        if s.point_numbers[0] > 1:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.INFO,
                    "READINGS_BEFORE_ZERO_NOT_IN_FILE",
                    f"{tag}: the table starts at point {s.point_numbers[0]} (the zero reading); "
                    f"points 1..{s.point_numbers[0] - 1} are not in the file",
                )
            )
        gaps = sum(
            1 for a, b in zip(s.point_numbers, s.point_numbers[1:], strict=False) if b != a + 1
        )
        if gaps:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "POINT_NUMBER_GAP",
                    f"{tag}: {gaps} breaks in the point-number sequence",
                )
            )
        disp = s.measured.get("displacement_um", [])
        back = [
            i + 1
            for i in range(1, len(disp))
            if disp[i] is not None and disp[i - 1] is not None and disp[i] < disp[i - 1]  # type: ignore[operator]
        ]
        if back:
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "DISPLACEMENT_NOT_MONOTONIC",
                    f"{tag}: displacement steps back at {len(back)} points",
                    rows=back[:20],
                )
            )
        force0 = (s.measured.get("force_n") or [None])[0]
        q0 = (s.lab_derived.get("deviator_stress_kpa") or [None])[0]
        if force0 == 0 and q0 is not None and abs(q0) > TX_DEVIATOR_OFFSET_TOLERANCE_KPA:
            self.warning("%s %s: deviator %.3f kPa at zero force", result.source_name, tag, q0)
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "DEVIATOR_OFFSET_AT_ZERO_FORCE",
                    f"{tag}: sigma1-3 = {q0} kPa at zero force — a correction the lab applied "
                    "from the first point; the stress columns are not force / area",
                )
            )
        for group, channels in (("measured", s.measured), ("lab-derived", s.lab_derived)):
            for key, values in channels.items():
                present = {v for v in values if v is not None}
                if len(values) > 1 and len(present) == 1:
                    (value,) = present
                    result.issues.append(
                        ValidationIssue(
                            ValidationLevel.INFO,
                            "CHANNEL_CONSTANT",
                            f"{tag}: {group} channel {key} is {value} at all {len(values)} "
                            "points; the machine probably did not log it (values kept)",
                        )
                    )
        disp0 = disp[0] if disp else None
        strain0 = (s.lab_derived.get("axial_strain_pct") or [None])[0]
        if disp0 == 0 and strain0 is not None and abs(strain0) > TX_STRAIN_OFFSET_TOLERANCE_PCT:
            self.warning(
                "%s %s: strain %.4f %% at zero displacement", result.source_name, tag, strain0
            )
            result.issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "STRAIN_OFFSET_AT_ZERO_DISPLACEMENT",
                    f"{tag}: axial strain = {strain0} % at zero displacement — the strain "
                    "column is not displacement / height here",
                )
            )


# ---------------------------------------------------------------------------
# Module-private pure helpers
# ---------------------------------------------------------------------------


def _channel(specimen: TriaxialSpecimen, label: str) -> list[float | None]:
    """Return the list a header label's values go into."""
    if label in TX_MEASURED_CHANNELS:
        return specimen.measured[TX_MEASURED_CHANNELS[label]]
    if label in TX_LAB_DERIVED_CHANNELS:
        return specimen.lab_derived[TX_LAB_DERIVED_CHANNELS[label]]
    return specimen.unclassified[label]


def _first(raw: dict[str, list[str]], label: str) -> str | None:
    """Return the first value cell of ``label``, or ``None``."""
    cells = raw.get(label)
    return blank_to_none(cells[0]) if cells else None


def _number_at(raw: dict[str, list[str]], label: str, index: int = 0) -> float | None:
    """Return the number in value cell ``index`` of ``label`` (unit dropped)."""
    cells = raw.get(label) or []
    if len(cells) <= index:
        return None
    return parse_geosys_value_unit(cells[index])[0]


def _promote_sample_fields(result: TriaxialDumpResult) -> None:
    """Copy the known sample-level labels to typed fields."""
    raw = result.raw
    result.test_type = _first(raw, TX_LABEL_TEST_TYPE)
    result.job_number = _first(raw, TX_LABEL_JOB_NUMBER)
    result.report_for = _first(raw, TX_LABEL_REPORT_FOR)
    result.origin = _first(raw, TX_LABEL_ORIGIN)
    result.borehole_name = _first(raw, TX_LABEL_BOREHOLE)
    result.sequence_number = _first(raw, TX_LABEL_SEQUENCE)
    result.sample_number = _first(raw, TX_LABEL_SAMPLE_NUMBER)
    result.depth_top_m, result.depth_base_m = parse_geosys_depth_range(_first(raw, TX_LABEL_DEPTH))
    result.visual_description = _first(raw, TX_LABEL_DESCRIPTION)
    if result.borehole_name is None or result.sample_number is None:
        result.issues.append(
            ValidationIssue(
                ValidationLevel.ERROR,
                "MISSING_SAMPLE_IDENTITY",
                f"borehole={result.borehole_name!r} sample={result.sample_number!r}; "
                f"labels found: {', '.join(sorted(raw)) or 'none'}",
            )
        )


def _promote_specimen_fields(s: TriaxialSpecimen) -> None:
    """Copy the known specimen-level labels to typed fields."""
    raw = s.raw
    s.strain_rate_mm_per_min = _number_at(raw, TX_LABEL_STRAIN_RATE)
    s.grain_density_t_m3 = _number_at(raw, TX_LABEL_GRAIN_DENSITY)
    s.initial_height_mm = _number_at(raw, TX_LABEL_HEIGHT)
    s.initial_diameter_mm = _number_at(raw, TX_LABEL_DIAMETER)
    s.initial_wet_mass_g = _number_at(raw, TX_LABEL_WET_MASS)
    s.consolidation_stress_kpa = _number_at(raw, TX_LABEL_CONSOLIDATION_STRESS)
    s.consolidation_volume_change_cm3 = _number_at(raw, TX_LABEL_CONSOLIDATION_DV)
    s.final_wet_mass_g = _number_at(raw, TX_LABEL_FINAL_WET_MASS)
    s.dry_mass_g = _number_at(raw, TX_LABEL_DRY_MASS)
    s.final_volume_change_cm3 = _number_at(raw, TX_LABEL_FINAL_DV)
    s.failure_description = _first(raw, TX_LABEL_FAILURE)
    s.area_before_mm2 = _number_at(raw, TX_LABEL_AREA)
    s.volume_before_mm3 = _number_at(raw, TX_LABEL_VOLUME, 0)
    s.volume_after_mm3 = _number_at(raw, TX_LABEL_VOLUME, 1)
    s.import_file = _first(raw, TX_LABEL_IMPORT_FILE)
    s.calibration_file = _first(raw, TX_LABEL_CALIBRATION_FILE)
    s.press_id = _first(raw, TX_LABEL_PRESS)
