from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum

import polars as pl

from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

# GEF quantity number → standard column name
_QUANTITY_TO_COLUMN: dict[int, str] = {
    1: "depth_m",
    2: "qc_mpa",
    3: "fs_mpa",
    4: "rf_pct",
    5: "u1_mpa",
    6: "u2_mpa",
    7: "u3_mpa",
    8: "inclination_deg",
    9: "inclination_ns_deg",
    10: "inclination_ew_deg",
    11: "length_m",   # penetration length — needs inclination correction for true depth
    15: "qt_mpa",
    16: "qn_mpa",
    17: "bq",
    99: "time_s",
}

# Conversion factors to MPa
_UNIT_TO_MPA: dict[str, float] = {
    "mpa": 1.0,
    "n/mm2": 1.0,
    "kpa": 0.001,
    "kn/m2": 0.001,
    "pa": 1e-6,
    "bar": 0.1,
    "tf/m2": 0.009807,
    "kgf/cm2": 0.098067,
}

_PRESSURE_COLUMNS = {"qc_mpa", "fs_mpa", "u1_mpa", "u2_mpa", "u3_mpa", "qt_mpa", "qn_mpa"}

# #MEASUREMENTVAR indices (GEF-CPT-Report standard)
_MVAR_PRE_DRILL = 13        # DIEPTE PUT — pit/pre-drill depth
_MVAR_WATER_DEPTH = 14      # DIEPTE GRONDWATER — groundwater depth
_MVAR_STOP_CRITERION = 17   # Stop criteria
_MVAR_NET_AREA_RATIO = 3    # Net surface area quotient of cone tip (a-value)
_MVAR_CONE_TYPE = 12        # 0 = electric, 1 = mechanical


class CPTType(Enum):
    CPTU = "CPTU"     # piezocone: qc + fs + u2
    CPTE = "CPTE"     # electric: qc + fs, no u2
    CPTM = "CPTM"     # mechanical: qc only
    UNKNOWN = "UNKNOWN"


class ValidationLevel(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class ValidationIssue:
    level: ValidationLevel
    code: str
    message: str
    rows: list[int] = field(default_factory=list)


@dataclass
class GEFHeader:
    project_id: str = ""
    test_id: str = ""
    file_date: str = ""
    company: str = ""
    report_code: str = ""

    x: float | None = None
    y: float | None = None
    z: float | None = None
    epsg: int | None = None    # horizontal CRS from #XYID (e.g. 32000 = Belgian Lambert 72)
    z_epsg: int | None = None  # vertical datum from #ZID (e.g. 32001 = Belgian mTAW/NGF)

    pre_drill_m: float = 0.0
    water_depth_m: float | None = None #TODO: water depth in a CPT hole is not reliable, we can use it if there is no other data but piezometer data is preferred we need to keep this in mind when normalizing
    net_area_ratio: float | None = None
    stop_criterion: int | None = None
    cone_type_code: int | None = None   # 0=electric, 1=mechanical

    # 1-based column number → GEF quantity number
    column_map: dict[int, int] = field(default_factory=dict)
    # 1-based column number → unit string (lower-cased)
    unit_map: dict[int, str] = field(default_factory=dict)
    # 1-based column number → void value
    void_map: dict[int, float] = field(default_factory=dict)

    n_columns: int = 0


@dataclass
class GEFParseResult:
    header: GEFHeader
    cpt_type: CPTType
    data: pl.DataFrame
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        return any(i.level == ValidationLevel.ERROR for i in self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.level == ValidationLevel.WARNING]


class GEFParser:
    def parse(self, content: str) -> GEFParseResult:
        lines = content.splitlines()
        header, eoh_index = self._parse_header(lines)
        raw_df = self._parse_data(lines[eoh_index + 1:], header)
        cpt_type = self._detect_cpt_type(header)

        df = self._apply_void_values(raw_df, header)
        df = self._rename_columns(df, header)
        df = self._normalise_units(df, header)
        df = self._ensure_depth_column(df)

        if "qc_mpa" in df.columns and "fs_mpa" in df.columns and "rf_pct" not in df.columns:
            df = self._calculate_rf(df)

        issues = self._validate(header, df, cpt_type)
        result = GEFParseResult(header=header, cpt_type=cpt_type, data=df, issues=issues)

        n_issues = len(issues)
        logger.success(f"GEF parsed: {len(df)} rows, type={cpt_type.value}, {n_issues} issue(s)")
        return result

    def parse_bytes(self, content: bytes) -> GEFParseResult:
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
                logger.debug(f"GEF header: {header.n_columns} columns, EPSG={header.epsg}, z={header.z}")
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
            logger.warning(f"Could not parse GEF header field {key}={value!r}: {exc}")

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
            case _ if var_num == _MVAR_NET_AREA_RATIO:
                header.net_area_ratio = float(val)
            case _ if var_num == _MVAR_PRE_DRILL:
                header.pre_drill_m = float(val)
            case _ if var_num == _MVAR_WATER_DEPTH:
                header.water_depth_m = float(val)
            case _ if var_num == _MVAR_STOP_CRITERION:
                header.stop_criterion = int(float(val))
            case _ if var_num == _MVAR_CONE_TYPE:
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
                logger.trace(f"Skipping unparseable data line: {raw_line!r}")

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
            dst = _QUANTITY_TO_COLUMN.get(qty_num)
            if src in df.columns and dst:
                rename[src] = dst
        return df.rename(rename)

    def _normalise_units(self, df: pl.DataFrame, header: GEFHeader) -> pl.DataFrame:
        for col_num, unit in header.unit_map.items():
            qty_num = header.column_map.get(col_num)
            if qty_num is None:
                continue
            std_col = _QUANTITY_TO_COLUMN.get(qty_num, "")
            if std_col not in _PRESSURE_COLUMNS or std_col not in df.columns:
                continue
            factor = _UNIT_TO_MPA.get(unit.lower())
            if factor is None or factor == 1.0:
                continue
            df = df.with_columns((pl.col(std_col) * factor).alias(std_col))
            logger.debug(f"Normalised {std_col}: {unit} → MPa (×{factor})")
        return df

    def _ensure_depth_column(self, df: pl.DataFrame) -> pl.DataFrame:
        if "depth_m" not in df.columns and "length_m" in df.columns:
            df = df.rename({"length_m": "depth_m"})
            logger.warning("GEF uses penetration length (qty 11) — inclination correction not applied") #TODO: shouldn't we check if there are inclination columns and try to calculate depth if the columns are present and default after that check to length?
        return df

    def _calculate_rf(self, df: pl.DataFrame) -> pl.DataFrame:
        df = df.with_columns(
            pl.when(pl.col("qc_mpa") > 0)
            .then((pl.col("fs_mpa") / pl.col("qc_mpa")) * 100.0)
            .otherwise(None)
            .alias("rf_pct")
        )
        logger.debug("Calculated Rf(%) from qc and fs")
        return df

    # ------------------------------------------------------------------
    # CPT type detection
    # ------------------------------------------------------------------

    def _detect_cpt_type(self, header: GEFHeader) -> CPTType:
        if header.cone_type_code == 1:
            return CPTType.CPTM
        qty_nums = set(header.column_map.values())
        if 6 in qty_nums: #TODO: won't this logic break if there are more or less columns in a different .gef file, maybe check for u measurement and if not present default to CPTE?
            return CPTType.CPTU
        if 3 in qty_nums: #TODO: won't this logic break if there are more or less columns in a different .gef file?
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
        ]
        issues = [issue for group in checks for issue in group]
        for issue in issues:
            logger.trace(f"[{issue.level.upper()}] {issue.code}: {issue.message}")
        return issues

    def _check_coordinates(self, header: GEFHeader) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        if header.x is None or header.y is None:
            issues.append(ValidationIssue(ValidationLevel.WARNING, "NO_COORDINATES",
                "No XY coordinates — test cannot be placed on map"))
        elif header.x == 0.0 and header.y == 0.0:
            issues.append(ValidationIssue(ValidationLevel.WARNING, "ZERO_COORDINATES",
                "Coordinates are (0, 0) — likely not recorded, not a real origin"))
        if header.x is not None and header.epsg is None:
            issues.append(ValidationIssue(ValidationLevel.WARNING, "NO_EPSG",
                "Coordinates present but no EPSG code — coordinate system unknown"))
        if header.z is None:
            issues.append(ValidationIssue(ValidationLevel.INFO, "NO_ELEVATION",
                "No elevation (Z) — depth series will be relative only"))
        return issues

    def _check_required_columns( #TODO: we should also check for the presence of fs (and thus rf) for CPTE and CPTU
        self, df: pl.DataFrame, cpt_type: CPTType
    ) -> list[ValidationIssue]:
        required = {"depth_m", "qc_mpa"}
        if cpt_type == CPTType.CPTU:
            required.add("u2_mpa")
        return [
            ValidationIssue(ValidationLevel.ERROR, "MISSING_COLUMN",
                f"Required column '{col}' missing for {cpt_type.value}")
            for col in required - set(df.columns)
        ]

    def _check_depth_monotonic(self, df: pl.DataFrame) -> list[ValidationIssue]: #TODO: test if makeing a second array with 1 shifted position and deducting both to find negative values is more performant
        if "depth_m" not in df.columns:
            return []
        depths = df["depth_m"].to_list()
        bad = [i for i in range(1, len(depths))
               if depths[i] is not None and depths[i - 1] is not None and depths[i] <= depths[i - 1]]
        if bad:
            return [ValidationIssue(ValidationLevel.ERROR, "DEPTH_NOT_MONOTONIC",
                f"Depth not strictly increasing at {len(bad)} row(s)", rows=bad[:10])]
        return []

    def _check_negative_values(self, df: pl.DataFrame) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        for col in ("qc_mpa", "fs_mpa"):
            if col in df.columns:
                n = df.filter(pl.col(col) < 0).height #TODO: explain this .height call, it's not clear what it does'
                if n:
                    issues.append(ValidationIssue(ValidationLevel.WARNING, "NEGATIVE_VALUES",
                        f"{n} negative value(s) in '{col}' — possible sensor calibration issue"))
        return issues

    def _check_null_values(self, df: pl.DataFrame) -> list[ValidationIssue]:
        return [
            ValidationIssue(ValidationLevel.INFO, "NULL_VALUES",
                f"{df[col].null_count()} null/void value(s) in '{col}'")
            for col in df.columns
            if df[col].null_count() > 0
        ]

    def _check_pre_drill(self, header: GEFHeader, df: pl.DataFrame) -> list[ValidationIssue]:
        if "depth_m" not in df.columns:
            return []
        if header.pre_drill_m > 0:
            n = df.filter(pl.col("depth_m") <= header.pre_drill_m).height #todo: explain this .height call, it's not clear what it does'
            if n:
                return [ValidationIssue(ValidationLevel.INFO, "PRE_DRILL",
                    f"{n} row(s) within pre-drill zone (≤{header.pre_drill_m} m) — exclude from interpretation")]
        else:
            first_depth = df["depth_m"].drop_nulls().first()
            if first_depth is not None and first_depth > 0.5:
                return [ValidationIssue(ValidationLevel.INFO, "PRE_DRILL",
                    f"Data starts at {first_depth:.2f} m — likely pre-drilled but MVAR 13 not set")]
        return []

    def _check_net_area_ratio(
        self, header: GEFHeader, cpt_type: CPTType
    ) -> list[ValidationIssue]:
        if cpt_type == CPTType.CPTU and header.net_area_ratio is None:
            return [ValidationIssue(ValidationLevel.WARNING, "NO_NET_AREA_RATIO",
                "CPTU missing net area ratio (a-value) — Qt correction not possible")] #TODO: can we add a fallback based on standard area ratio's for standard surfaces of cone?
        return []

    def _check_rf_range(self, df: pl.DataFrame) -> list[ValidationIssue]:
        if "rf_pct" not in df.columns: #TODO: for CPTM we will not have an rf_column, will this check be executed on those?
            return []
        n = df.filter((pl.col("rf_pct") < 0.05) | (pl.col("rf_pct") > 15.0)).height
        if n:
            return [ValidationIssue(ValidationLevel.WARNING, "RF_OUT_OF_RANGE",
                f"{n} row(s) with Rf outside 0.05–15% — review for sensor errors")]
        return []

    def _check_qc_spikes(self, df: pl.DataFrame) -> list[ValidationIssue]:
        if "qc_mpa" not in df.columns:
            return []
        qc = df["qc_mpa"].to_list()
        spikes = [
            i for i in range(1, len(qc) - 1)
            if None not in (qc[i - 1], qc[i], qc[i + 1])
            and qc[i - 1] > 0 and qc[i + 1] > 0
            and qc[i] / qc[i - 1] > 5  # type: ignore[operator]
            and qc[i] / qc[i + 1] > 5  # type: ignore[operator]
        ]
        if spikes:
            return [ValidationIssue(ValidationLevel.WARNING, "QC_SPIKES",
                f"{len(spikes)} possible qc spike(s) (>5× neighbouring values)", rows=spikes[:10])]
        return []
