"""GEF-CPT parser — header, data, type detection, unit normalisation, validation."""

from __future__ import annotations

import re

import polars as pl

from groundmodel.domain.value_objects.derived_value_source import DerivedValueSource
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_constants import (
    MVAR_CONE_TYPE,
    MVAR_NET_AREA_RATIO,
    MVAR_PRE_DRILL,
    MVAR_STOP_CRITERION,
    MVAR_WATER_DEPTH,
    PRESSURE_COLUMNS,
    QUANTITY_TO_COLUMN,
    UNIT_TO_MPA,
)
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class GEFParser(GroundModelLogger):
    """Parses GEF-CPT files into a validated GEFParseResult with a Polars DataFrame."""

    def __init__(self) -> None:
        super().__init__(__name__)

    def parse(self, content: str) -> GEFParseResult:
        """Parse a GEF file string into a validated result.

        Parameters
        ----------
        content : str
            Full GEF file content as a string.

        Returns
        -------
        GEFParseResult
            Parsed header, CPT type, data frame, and validation issues.

        Raises
        ------
        ParseError
            If the file has no #EOH= marker or contains no data rows.
        """
        lines = content.splitlines()
        header, eoh_index = self._parse_header(lines)
        raw_df = self._parse_data(lines[eoh_index + 1 :], header)
        cpt_type = self._detect_cpt_type(header)

        df = self._apply_void_values(raw_df, header)
        df = self._rename_columns(df, header)
        df = self._normalise_units(df, header)
        df = self._ensure_depth_column(df)

        # Provenance: capture rf/qt source BEFORE we maybe compute Rf, so we can
        # tell "the GEF file gave us Rf directly" (qty 4 → MEASURED) apart from
        # "we derived Rf from qc and fs" (COMPUTED). qt is never computed by us
        # today; if it's in df it came from qty 15 (CPTU) or qty 128 (CPTM).
        rf_source: DerivedValueSource | None = None
        qt_source: DerivedValueSource | None = None
        if "rf_pct" in df.columns:
            rf_source = DerivedValueSource.MEASURED
        elif "qc_mpa" in df.columns and "fs_mpa" in df.columns:
            df = self._calculate_rf(df)
            rf_source = DerivedValueSource.COMPUTED
        if "qt_mpa" in df.columns:
            qt_source = DerivedValueSource.MEASURED

        issues = self._validate(header, df, cpt_type)
        result = GEFParseResult(
            header=header,
            cpt_type=cpt_type,
            data=df,
            issues=issues,
            rf_source=rf_source,
            qt_source=qt_source,
        )

        n_issues = len(issues)
        self.success(f"GEF parsed: {len(df)} rows, type={cpt_type.value}, {n_issues} issue(s)")
        return result

    def parse_bytes(self, content: bytes) -> GEFParseResult:
        """Decode raw bytes and parse, trying UTF-8, Windows-1252, then Latin-1.

        Parameters
        ----------
        content : bytes
            Raw GEF file bytes.

        Returns
        -------
        GEFParseResult
            Parsed header, CPT type, data frame, and validation issues.

        Raises
        ------
        ParseError
            If the bytes cannot be decoded with any supported encoding.
        """
        for encoding in ("utf-8", "windows-1252", "latin-1"):
            try:
                return self.parse(content.decode(encoding))
            except UnicodeDecodeError:
                continue
        raise ParseError("Cannot decode GEF file — tried UTF-8, Windows-1252, Latin-1")

    # ------------------------------------------------------------------
    # Header
    # ------------------------------------------------------------------

    def _parse_header(self, lines: list[str]) -> tuple[GEFHeader, int]:
        header = GEFHeader()
        for i, raw_line in enumerate(lines):
            line = raw_line.strip()
            if not line.startswith("#"):
                continue
            if ";" in line:
                line = line[: line.index(";")].strip()
            if line.upper().startswith("#EOH"):
                self.debug(
                    f"GEF header: {header.n_columns} columns, EPSG={header.epsg}, z={header.z}"
                )
                return header, i
            key, _, value = line.partition("=")
            key = key.strip().upper().lstrip("#")
            value = value.strip()
            if value:
                self._apply_header_field(header, key, value)
        raise ParseError("GEF file has no #EOH= marker")

    def _apply_header_field(self, header: GEFHeader, key: str, value: str) -> None:
        try:
            match key:
                case "PROJECTID":
                    header.project_id = value.strip(", ")
                case "TESTID":
                    header.test_id = value.strip(", ")
                case "FILEDATE":
                    header.file_date = value
                case "COMPANYID":
                    header.company = value
                case "REPORTCODE":
                    header.report_code = value
                case "COLUMN":
                    header.n_columns = int(value.split(",")[0].strip())
                case "COLUMNINFO":
                    self._parse_columninfo(header, value)
                case "COLUMNVOID":
                    self._parse_columnvoid(header, value)
                case "XYID":
                    self._parse_xyid(header, value)
                case "ZID":
                    self._parse_zid(header, value)
                case "MEASUREMENTVAR":
                    self._parse_measurementvar(header, value)
        except (ValueError, IndexError) as exc:
            self.warning(f"Could not parse GEF header field {key}={value!r}: {exc}")

    def _parse_columninfo(self, header: GEFHeader, value: str) -> None:
        parts = [p.strip() for p in value.split(",")]
        if len(parts) < 3:
            return
        col_num = int(parts[0])
        unit = parts[1].lower()
        # Format: col, unit, name, qty_num  OR (old) col, unit, qty_num
        if len(parts) >= 4:
            qty_num = int(parts[3])
        else:
            try:
                qty_num = int(parts[2])
            except ValueError:
                return
        header.column_map[col_num] = qty_num
        header.unit_map[col_num] = unit

    def _parse_columnvoid(self, header: GEFHeader, value: str) -> None:
        parts = [p.strip() for p in value.split(",")]
        if len(parts) >= 2:
            header.void_map[int(parts[0])] = float(parts[1])

    def _parse_xyid(self, header: GEFHeader, value: str) -> None:
        parts = [p.strip() for p in value.split(",")]
        if len(parts) >= 3:
            header.epsg = int(parts[0]) if parts[0] else None
            header.x = float(parts[1]) if parts[1] else None
            header.y = float(parts[2]) if parts[2] else None

    def _parse_zid(self, header: GEFHeader, value: str) -> None:
        parts = [p.strip() for p in value.split(",")]
        if len(parts) >= 1 and parts[0]:
            header.z_epsg = int(parts[0])
        if len(parts) >= 2 and parts[1]:
            header.z = float(parts[1])

    def _parse_measurementvar(self, header: GEFHeader, value: str) -> None:
        parts = [p.strip() for p in value.split(",")]
        if len(parts) < 2:
            return
        var_num = int(parts[0])
        val = parts[1]
        match var_num:
            case _ if var_num == MVAR_NET_AREA_RATIO:
                header.net_area_ratio = float(val)
            case _ if var_num == MVAR_PRE_DRILL:
                header.pre_drill_m = float(val)
            case _ if var_num == MVAR_WATER_DEPTH:
                header.water_depth_m = float(val)
            case _ if var_num == MVAR_STOP_CRITERION:
                header.stop_criterion = int(float(val))
            case _ if var_num == MVAR_CONE_TYPE:
                header.cone_type_code = int(float(val))

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------

    def _parse_data(self, lines: list[str], header: GEFHeader) -> pl.DataFrame:
        rows: list[list[float | None]] = []
        for raw_line in lines:
            line = raw_line.strip()
            if not line or line.startswith("#") or line.startswith("!"):
                continue
            parts = re.split(r"[;\s]+", line)
            try:
                row: list[float | None] = [float(p) for p in parts if p]
                if row:
                    rows.append(row)
            except ValueError:
                self.trace(f"Skipping unparseable data line: {raw_line!r}")

        if not rows:
            raise ParseError("GEF file contains no data rows")

        n_cols = header.n_columns or max(len(r) for r in rows)
        col_names = [f"col_{i + 1}" for i in range(n_cols)]
        padded = [r[:n_cols] + [None] * max(0, n_cols - len(r)) for r in rows]
        return pl.DataFrame(padded, schema={c: pl.Float64 for c in col_names}, orient="row")

    # ------------------------------------------------------------------
    # Post-processing
    # ------------------------------------------------------------------

    def _apply_void_values(self, df: pl.DataFrame, header: GEFHeader) -> pl.DataFrame:
        for col_num, void_val in header.void_map.items():
            col = f"col_{col_num}"
            if col in df.columns:
                df = df.with_columns(
                    pl.when(pl.col(col) == void_val).then(None).otherwise(pl.col(col)).alias(col)
                )
        return df

    def _rename_columns(self, df: pl.DataFrame, header: GEFHeader) -> pl.DataFrame:
        rename: dict[str, str] = {}
        for col_num, qty_num in header.column_map.items():
            src = f"col_{col_num}"
            dst = QUANTITY_TO_COLUMN.get(qty_num)
            if src in df.columns and dst:
                rename[src] = dst
        return df.rename(rename)

    def _normalise_units(self, df: pl.DataFrame, header: GEFHeader) -> pl.DataFrame:
        for col_num, unit in header.unit_map.items():
            qty_num = header.column_map.get(col_num)
            if qty_num is None:
                continue
            std_col = QUANTITY_TO_COLUMN.get(qty_num, "")
            if std_col not in PRESSURE_COLUMNS or std_col not in df.columns:
                continue
            factor = UNIT_TO_MPA.get(unit.lower())
            if factor is None or factor == 1.0:
                continue
            df = df.with_columns((pl.col(std_col) * factor).alias(std_col))
            self.debug(f"Normalised {std_col}: {unit} → MPa (×{factor})")
        return df

    def _ensure_depth_column(self, df: pl.DataFrame) -> pl.DataFrame:
        if "depth_m" not in df.columns and "length_m" in df.columns:
            df = df.rename({"length_m": "depth_m"})
            self.warning(
                "GEF uses penetration length (qty 11) — inclination correction not applied"
            )
        return df

    def _calculate_rf(self, df: pl.DataFrame) -> pl.DataFrame:
        df = df.with_columns(
            pl.when(pl.col("qc_mpa") > 0)
            .then((pl.col("fs_mpa") / pl.col("qc_mpa")) * 100.0)
            .otherwise(None)
            .alias("rf_pct")
        )
        self.debug("Calculated Rf(%) from qc and fs")
        return df

    # ------------------------------------------------------------------
    # CPT type detection
    # ------------------------------------------------------------------

    def _detect_cpt_type(self, header: GEFHeader) -> CPTType:
        if header.cone_type_code == 1:
            return CPTType.CPTM
        qty_nums = set(header.column_map.values())
        if 6 in qty_nums:  # qty 6 = u2 (pore water pressure) in GEF-CPT-Report standard
            return CPTType.CPTU
        if 3 in qty_nums:
            return CPTType.CPTE
        return CPTType.CPTM

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate(
        self, header: GEFHeader, df: pl.DataFrame, cpt_type: CPTType
    ) -> list[ValidationIssue]:
        checks = [
            self._check_coordinates(header),
            self._check_required_columns(df, cpt_type),
            self._check_depth_monotonic(df),
            self._check_negative_values(df),
            self._check_null_values(df),
            self._check_pre_drill(header, df),
            self._check_net_area_ratio(header, cpt_type),
            self._check_rf_range(df),
            self._check_qc_spikes(df),
            self._check_hybrid_method(df),
            self._check_partial_u2(header, df, cpt_type),
        ]
        issues = [issue for group in checks for issue in group]
        for issue in issues:
            self.trace(f"[{issue.level.upper()}] {issue.code}: {issue.message}")
        return issues

    def _check_coordinates(self, header: GEFHeader) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        if header.x is None or header.y is None:
            issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "NO_COORDINATES",
                    "No XY coordinates — test cannot be placed on map",
                )
            )
        elif header.x == 0.0 and header.y == 0.0:
            issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "ZERO_COORDINATES",
                    "Coordinates are (0, 0) — likely not recorded, not a real origin",
                )
            )
        if header.x is not None and header.epsg is None:
            issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "NO_EPSG",
                    "Coordinates present but no EPSG code — coordinate system unknown",
                )
            )
        if header.z is None:
            issues.append(
                ValidationIssue(
                    ValidationLevel.INFO,
                    "NO_ELEVATION",
                    "No elevation (Z) — depth series will be relative only",
                )
            )
        return issues

    def _check_required_columns(self, df: pl.DataFrame, cpt_type: CPTType) -> list[ValidationIssue]:
        required = {"depth_m", "qc_mpa"}
        if cpt_type in (CPTType.CPTU, CPTType.CPTE):
            required.add("fs_mpa")
        if cpt_type == CPTType.CPTU:
            required.add("u2_mpa")
        return [
            ValidationIssue(
                ValidationLevel.ERROR,
                "MISSING_COLUMN",
                f"Required column '{col}' missing for {cpt_type.value}",
            )
            for col in required - set(df.columns)
        ]

    def _check_depth_monotonic(self, df: pl.DataFrame) -> list[ValidationIssue]:
        if "depth_m" not in df.columns:
            return []
        depths = df["depth_m"].to_list()
        bad = [
            i
            for i in range(1, len(depths))
            if depths[i] is not None and depths[i - 1] is not None and depths[i] <= depths[i - 1]
        ]
        if bad:
            return [
                ValidationIssue(
                    ValidationLevel.ERROR,
                    "DEPTH_NOT_MONOTONIC",
                    f"Depth not strictly increasing at {len(bad)} row(s)",
                    rows=bad[:10],
                )
            ]
        return []

    def _check_negative_values(self, df: pl.DataFrame) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        for col in ("qc_mpa", "fs_mpa"):
            if col in df.columns:
                n = df.filter(pl.col(col) < 0).height
                if n:
                    issues.append(
                        ValidationIssue(
                            ValidationLevel.WARNING,
                            "NEGATIVE_VALUES",
                            f"{n} negative value(s) in '{col}' — possible sensor calibration issue",
                        )
                    )
        return issues

    def _check_null_values(self, df: pl.DataFrame) -> list[ValidationIssue]:
        return [
            ValidationIssue(
                ValidationLevel.INFO,
                "NULL_VALUES",
                f"{df[col].null_count()} null/void value(s) in '{col}'",
            )
            for col in df.columns
            if df[col].null_count() > 0
        ]

    def _check_pre_drill(self, header: GEFHeader, df: pl.DataFrame) -> list[ValidationIssue]:
        if "depth_m" not in df.columns:
            return []
        if header.pre_drill_m > 0:
            n = df.filter(pl.col("depth_m") <= header.pre_drill_m).height
            if n:
                return [
                    ValidationIssue(
                        ValidationLevel.INFO,
                        "PRE_DRILL",
                        f"{n} row(s) within pre-drill zone (≤{header.pre_drill_m} m)"
                        " — exclude from interpretation",
                    )
                ]
        else:
            first_depth = df["depth_m"].drop_nulls().first()
            if first_depth is not None and first_depth > 0.5:
                return [
                    ValidationIssue(
                        ValidationLevel.INFO,
                        "PRE_DRILL",
                        f"Data starts at {first_depth:.2f} m"
                        " — likely pre-drilled but MVAR 13 not set",
                    )
                ]
        return []

    def _check_net_area_ratio(self, header: GEFHeader, cpt_type: CPTType) -> list[ValidationIssue]:
        if cpt_type == CPTType.CPTU and header.net_area_ratio is None:
            return [
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "NO_NET_AREA_RATIO",
                    "CPTU missing net area ratio (a-value) — Qt correction not possible",
                )
            ]
        return []

    def _check_rf_range(self, df: pl.DataFrame) -> list[ValidationIssue]:
        if "rf_pct" not in df.columns:
            return []
        n = df.filter((pl.col("rf_pct") < 0.05) | (pl.col("rf_pct") > 15.0)).height
        if n:
            return [
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "RF_OUT_OF_RANGE",
                    f"{n} row(s) with Rf outside 0.05–15% — review for sensor errors",
                )
            ]
        return []

    def _check_qc_spikes(self, df: pl.DataFrame) -> list[ValidationIssue]:
        if "qc_mpa" not in df.columns:
            return []
        qc = df["qc_mpa"].to_list()
        spikes = [
            i
            for i in range(1, len(qc) - 1)
            if None not in (qc[i - 1], qc[i], qc[i + 1])
            and qc[i - 1] > 0
            and qc[i + 1] > 0
            and qc[i] / qc[i - 1] > 5  # type: ignore[operator]
            and qc[i] / qc[i + 1] > 5  # type: ignore[operator]
        ]
        if spikes:
            return [
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "QC_SPIKES",
                    f"{len(spikes)} possible qc spike(s) (>5× neighbouring values)",
                    rows=spikes[:10],
                )
            ]
        return []

    def _check_hybrid_method(self, df: pl.DataFrame) -> list[ValidationIssue]:
        if "depth_m" not in df.columns:
            return []
        depths = df["depth_m"].drop_nulls()
        if len(depths) < 20:
            return []
        diffs = depths.diff().drop_nulls()
        pos_diffs = diffs.filter(diffs > 0)
        if len(pos_diffs) < 10:
            return []
        p10 = pos_diffs.quantile(0.10)
        p90 = pos_diffs.quantile(0.90)
        if p10 is None or p10 <= 0 or p90 is None or p90 / p10 <= 10:
            return []
        step_threshold = p10 * 5
        depths_list = depths.to_list()
        diffs_list = diffs.to_list()
        transition_depth: float | None = None
        for i, d in enumerate(diffs_list):
            if d is not None and d > step_threshold:
                transition_depth = depths_list[i + 1] if i + 1 < len(depths_list) else None
                break
        depth_str = f" near {transition_depth:.2f} m" if transition_depth is not None else ""
        return [
            ValidationIssue(
                ValidationLevel.WARNING,
                "HYBRID_METHOD",
                f"Depth increment changes significantly{depth_str} — likely combines multiple test "
                "methods (e.g. electric then mechanical); interpret segments separately",
            )
        ]

    def _check_partial_u2(
        self, header: GEFHeader, df: pl.DataFrame, cpt_type: CPTType
    ) -> list[ValidationIssue]:
        if cpt_type != CPTType.CPTU or "u2_mpa" not in df.columns or "depth_m" not in df.columns:
            return []
        non_null_indices = df["u2_mpa"].is_not_null().arg_true()
        if len(non_null_indices) == 0 or int(non_null_indices[0]) == 0:
            return []
        first_u2_depth = df["depth_m"][int(non_null_indices[0])]
        if first_u2_depth is None or first_u2_depth <= header.pre_drill_m + 0.5:
            return []
        return [
            ValidationIssue(
                ValidationLevel.WARNING,
                "PARTIAL_U2",
                f"u2 pore pressure only available from {first_u2_depth:.2f} m — "
                "test likely combines CPTE (dry filter) and CPTU (saturated filter) methods",
            )
        ]
