"""GEF-CPT parser — header, data, type detection, unit normalisation, validation."""

from __future__ import annotations

import re

import polars as pl

from groundmodel.domain.value_objects.derived_value_source import DerivedValueSource
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_constants import (
    DEFAULT_COLUMN_SEPARATORS,
    MAX_GEF_COLUMNS,
    MVAR_CONE_TYPE,
    MVAR_NET_AREA_RATIO,
    MVAR_PRE_DRILL,
    MVAR_STOP_CRITERION,
    MVAR_WATER_DEPTH,
    NUMERIC_CHARACTERS,
    PRESSURE_COLUMNS,
    QUANTITY_TO_COLUMN,
    UNIT_TO_MPA,
)
from groundmodel.infrastructure.parsers.cpt.gef.gef_crs_codes import (
    horizontal_epsg_from_gef_code,
    vertical_epsg_from_gef_code,
)
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.crs_bounds_issue import make_crs_bounds_issue
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_SEPARATOR_KEYS = ("#COLUMNSEPARATOR", "#RECORDSEPARATOR")


def _declares_separator(line: str) -> bool:
    """Return whether *line* is a ``#COLUMNSEPARATOR=``/``#RECORDSEPARATOR=`` header.

    Parameters
    ----------
    line : str
        A stripped header line, including its leading ``#``.

    Returns
    -------
    bool
        ``True`` for the two separator declarations. They are the only header
        lines where a ``;`` must be read as the declared value rather than as
        the start of an inline comment.
    """
    upper = line.upper()
    return any(upper.startswith(key) for key in _SEPARATOR_KEYS)


def _value_split_pattern(column_separator: str | None) -> re.Pattern[str]:
    """Build the regex that splits a data line into values.

    Parameters
    ----------
    column_separator : str | None
        The character declared by ``#COLUMNSEPARATOR=``, or ``None`` when the
        file declared none.

    Returns
    -------
    re.Pattern[str]
        A character-class split on the declared separator plus the historic
        defaults (semicolon and whitespace). The defaults stay in even when a
        separator is declared: real files declare ``;`` and then also pad with
        spaces, and widening the split can only merge separators that were
        never data. Characters that can occur inside a number are dropped —
        see :data:`NUMERIC_CHARACTERS`.
    """
    escaped = "".join(re.escape(c) for c in sorted(_effective_column_separators(column_separator)))
    return re.compile(f"[{escaped}\\s]+")


def _effective_column_separators(column_separator: str | None) -> set[str]:
    """Return every character that actually splits a data line into values.

    The historic defaults always apply; a declared separator adds to them,
    minus any character that can occur inside a number.

    Parameters
    ----------
    column_separator : str | None
        The character declared by ``#COLUMNSEPARATOR=``, or ``None``.

    Returns
    -------
    set[str]
        The value-splitting characters (whitespace is handled separately by
        the regex's ``\\s`` class and is therefore not listed here).
    """
    chars = set(DEFAULT_COLUMN_SEPARATORS)
    if column_separator:
        chars.update(c for c in column_separator if c not in NUMERIC_CHARACTERS)
    return chars


def _effective_record_separator(
    record_separator: str | None, column_separator: str | None
) -> tuple[str | None, str | None]:
    """Decide whether a declared record separator may be applied to data lines.

    The mirror image of the guard :func:`_value_split_pattern` already applies
    to the COLUMN separator. A record separator is used to cut each data line
    (``line.split(sep)[0]``), so a declaration the file should not have made is
    far more destructive than a bad column separator: every line is truncated
    to whatever precedes the first occurrence, the frame still comes back with
    its full set of correctly-named columns padded with ``None``, no row is
    counted as skipped, and the parser reports success on a file it silently
    emptied.

    Two declarations are refused:

    * a character that can occur inside a number (see
      :data:`NUMERIC_CHARACTERS`) — ``-`` would cut every line at its first
      negative value, including the ``-9999.0`` void marker;
    * a character that also splits values apart — a file declaring
      ``#RECORDSEPARATOR=;`` names the same character DOV declares as its
      column separator, so honouring it keeps only the first value of each row.

    Parameters
    ----------
    record_separator : str | None
        The value declared by ``#RECORDSEPARATOR=``, or ``None``.
    column_separator : str | None
        The value declared by ``#COLUMNSEPARATOR=``, or ``None``.

    Returns
    -------
    tuple[str | None, str | None]
        ``(separator to apply, refusal reason)``. Exactly one is ever
        non-``None``; both are ``None`` when the file declared no record
        separator. The reason is a sentence fragment for the caller's WARNING.
    """
    if not record_separator:
        return None, None
    splitters = _effective_column_separators(column_separator)
    for char in record_separator:
        if char in NUMERIC_CHARACTERS:
            return None, "it can occur inside a number"
        if char in splitters or char.isspace():
            return None, "it also separates values within a record"
    return record_separator, None


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
            If the file has no #EOH= marker, contains no data rows, or no
            data row carries a cone resistance value.
        """
        lines = content.splitlines()
        header, eoh_index = self._parse_header(lines)
        raw_df, skipped_rows = self._parse_data(lines[eoh_index + 1 :], header)
        cpt_type = self._detect_cpt_type(header)

        df = self._apply_void_values(raw_df, header)
        df = self._rename_columns(df, header)
        df = self._normalise_units(df, header)
        df, depth_from_length = self._ensure_depth_column(df)

        # Null out any NaN/inf a GEF line carried BEFORE Rf is derived (an inf qc
        # would otherwise feed the fs/qc ratio) and before validation, so the
        # frame the checks see is already finite. A non-finite depth becomes a
        # null anchor + an ERROR issue (see ``_check_non_finite``).
        df, non_finite_counts = self._replace_non_finite(df)

        # A row whose cone resistance is the void marker (or was non-finite)
        # has nothing to interpret, and every reader of the stored series —
        # the Ic chart, the litho segmenter, the SBT profile, the geotech
        # subdivision — takes qc as a number. The DOV parser skips such a
        # row at parse time; this does the same, so the stored qc array never
        # carries a null (issue #55: a null qc reached the unit-weight estimate
        # and the chart request answered 500).
        df, rows_without_qc = self._drop_rows_without_qc(df)

        # Provenance: capture rf source BEFORE we maybe compute Rf, so we can
        # tell "the GEF file gave us Rf directly" (qty 4 → MEASURED) apart from
        # "we derived Rf from qc and fs" (COMPUTED). qt_mpa (CPTU corrected qc)
        # and q_total_mpa (CPTM totaalweerstand) are always source-provided in
        # our pipeline — no parser computes them — so they need no flag.
        rf_source: DerivedValueSource | None = None
        if "rf_pct" in df.columns:
            rf_source = DerivedValueSource.MEASURED
        elif "qc_mpa" in df.columns and "fs_mpa" in df.columns:
            df = self._calculate_rf(df)
            rf_source = DerivedValueSource.COMPUTED

        issues = self._validate(
            header,
            df,
            cpt_type,
            depth_from_length,
            skipped_rows,
            non_finite_counts,
            rows_without_qc,
        )
        # When the GEF file's ``#ZID=`` header provided an elevation we
        # stamp ``GEF``; when it didn't, we stamp ``NONE`` so the row
        # surfaces as "no Z known" through the same code path used by
        # DOV imports that lack Z_mTAW. Debt #8.
        elevation_source = ElevationSource.GEF if header.z is not None else ElevationSource.NONE
        result = GEFParseResult(
            header=header,
            cpt_type=cpt_type,
            data=df,
            issues=issues,
            rf_source=rf_source,
            elevation_source=elevation_source,
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
                text = content.decode(encoding)
            except UnicodeDecodeError:
                continue
            # Log a successful FALLBACK decode (not clean UTF-8). The file
            # parsed fine, but non-ASCII header text (company / project name)
            # may show mojibake, so surface the encoding used at INFO — it is
            # the breadcrumb for a later "why is this name garbled" report.
            # decode(str)→parse never raises UnicodeDecodeError, so moving
            # parse outside the try is behaviour-preserving.
            if encoding != "utf-8":
                self.info(f"GEF decoded with fallback encoding {encoding!r} (not UTF-8)")
            return self.parse(text)
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
            # A ';' normally opens an inline comment — except on the two
            # separator declarations, where ';' is the most common declared
            # VALUE. ``#COLUMNSEPARATOR=;`` truncated as a comment would
            # silently leave the file's own separator undeclared.
            if ";" in line and not _declares_separator(line):
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
                case "COLUMNSEPARATOR":
                    header.column_separator = value
                case "RECORDSEPARATOR":
                    header.record_separator = value
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
            # Keep the raw GEF code, then translate. The two are separate
            # fields because they are separate things — the raw code is what
            # the file said, ``epsg`` is what it means.
            header.xy_code = int(parts[0]) if parts[0] else None
            header.epsg = horizontal_epsg_from_gef_code(header.xy_code)
            if header.xy_code is not None and header.epsg is None:
                self.warning(
                    f"GEF #XYID declares coordinate-system code {header.xy_code}, "
                    "which is neither a known GEF code nor a supported EPSG — "
                    "no CRS assigned"
                )
            header.x = float(parts[1]) if parts[1] else None
            header.y = float(parts[2]) if parts[2] else None

    def _parse_zid(self, header: GEFHeader, value: str) -> None:
        parts = [p.strip() for p in value.split(",")]
        if len(parts) >= 1 and parts[0]:
            header.z_code = int(parts[0])
            header.z_epsg = vertical_epsg_from_gef_code(header.z_code)
            if header.z_epsg is None:
                self.warning(
                    f"GEF #ZID declares vertical-datum code {header.z_code}, "
                    "which is neither a known GEF code nor a labelled vertical "
                    "EPSG — elevations stay datum-less"
                )
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

    def _parse_data(self, lines: list[str], header: GEFHeader) -> tuple[pl.DataFrame, int]:
        """Parse the data block into a raw ``col_N`` frame.

        Parameters
        ----------
        lines : list[str]
            Every line after ``#EOH=``.
        header : GEFHeader
            Supplies the declared column/record separators and column count.

        Returns
        -------
        tuple[pl.DataFrame, int]
            The raw frame and the number of data lines that could not be read
            as numbers. The count is returned rather than swallowed so the
            caller can surface it — a silently dropped row is a hole in the
            depth series nobody sees.

        Raises
        ------
        ParseError
            If no row parsed. The message distinguishes "the file has no data
            block" from "the data block is there but unreadable", and in the
            latter case quotes the first offending line.
        """
        split_pattern = _value_split_pattern(header.column_separator)
        record_separator, refusal = _effective_record_separator(
            header.record_separator, header.column_separator
        )
        if refusal is not None:
            self.warning(
                f"GEF: ignoring #RECORDSEPARATOR= {header.record_separator!r} — {refusal}; "
                "applying it would truncate every data line and the frame would still "
                "come back full-width (padded with nulls). Records are read to the end "
                "of the line."
            )
        rows: list[list[float | None]] = []
        skipped: list[str] = []
        for raw_line in lines:
            line = raw_line.strip()
            if not line or line.startswith("#") or line.startswith("!"):
                continue
            # A declared record separator terminates the record — everything
            # from it onwards belongs to the file's framing, not the data.
            if record_separator:
                line = line.split(record_separator)[0].strip()
                if not line:
                    continue
            parts = split_pattern.split(line)
            try:
                row: list[float | None] = [float(p) for p in parts if p]
                if row:
                    rows.append(row)
            except ValueError:
                skipped.append(line)
                self.trace(f"Skipping unparseable data line: {raw_line!r}")

        if not rows:
            if skipped:
                raise ParseError(
                    f"GEF data block has {len(skipped)} line(s); none could be "
                    f"parsed as numbers — first: {skipped[0]!r}. "
                    "Check the #COLUMNSEPARATOR= / #RECORDSEPARATOR= declarations."
                )
            raise ParseError("GEF file contains no data rows")
        if skipped:
            self.warning(
                f"GEF: {len(skipped)} of {len(rows) + len(skipped)} data line(s) "
                f"could not be parsed and were dropped — first: {skipped[0]!r}"
            )

        observed = max(len(r) for r in rows)
        # A hostile/broken ``#COLUMN=`` can declare an absurd column count and
        # drive the padded-frame allocation below into tens of GB from a
        # ~200-byte file. When the declared count is over the cap we do not
        # trust it: build the frame from the columns the data actually has, so
        # the allocation is bounded by the file's real content. The parse is
        # separately refused with an ERROR issue (``_check_column_count``) —
        # ``header.n_columns`` is left untouched so that check still sees the
        # declared value.
        if header.n_columns and header.n_columns > MAX_GEF_COLUMNS:
            self.warning(
                f"GEF #COLUMN= declares {header.n_columns} columns, over the "
                f"{MAX_GEF_COLUMNS} cap; frame built from the {observed} observed "
                "data column(s) instead. The parse will be refused."
            )
            n_cols = observed
        else:
            n_cols = header.n_columns or observed
        col_names = [f"col_{i + 1}" for i in range(n_cols)]
        padded = [r[:n_cols] + [None] * max(0, n_cols - len(r)) for r in rows]
        frame = pl.DataFrame(padded, schema={c: pl.Float64 for c in col_names}, orient="row")
        return frame, len(skipped)

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
        """Rename ``col_N`` to the standard column for its declared quantity.

        Parameters
        ----------
        df : pl.DataFrame
            Raw frame with positional ``col_N`` names.
        header : GEFHeader
            Supplies ``column_map`` (column number → GEF quantity number).

        Returns
        -------
        pl.DataFrame
            The frame with standard column names.

        Raises
        ------
        ParseError
            If two columns declare the same quantity. Two channels claiming
            to be the same measurement means the file does not say which is
            which — a refusal naming the quantity is the only honest answer,
            and it keeps the failure inside the ``ParseError`` contract every
            caller already handles instead of a Polars ``DuplicateError``
            escaping to a 500.
        """
        rename: dict[str, str] = {}
        columns_by_quantity: dict[int, list[int]] = {}
        for col_num, qty_num in sorted(header.column_map.items()):
            src = f"col_{col_num}"
            dst = QUANTITY_TO_COLUMN.get(qty_num)
            if src in df.columns and dst:
                rename[src] = dst
                columns_by_quantity.setdefault(qty_num, []).append(col_num)

        duplicates = {q: cols for q, cols in columns_by_quantity.items() if len(cols) > 1}
        if duplicates:
            detail = "; ".join(
                f"quantity {qty} ({QUANTITY_TO_COLUMN[qty]}) on columns "
                f"{', '.join(str(c) for c in cols)}"
                for qty, cols in sorted(duplicates.items())
            )
            raise ParseError(
                f"GEF declares the same quantity on more than one column — {detail}. "
                "The file does not say which column holds which measurement."
            )
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

    def _ensure_depth_column(self, df: pl.DataFrame) -> tuple[pl.DataFrame, bool]:
        """Guarantee a ``depth_m`` column, falling back to penetration length.

        Parameters
        ----------
        df : pl.DataFrame
            Frame with standard column names.

        Returns
        -------
        tuple[pl.DataFrame, bool]
            The frame, and whether ``depth_m`` is really the penetration
            length (GEF qty 1) standing in for a corrected depth the file
            never supplied. The flag is returned rather than only logged so
            the substitution reaches the engineer as a validation issue —
            an uncorrected depth is systematically too deep.
        """
        if "depth_m" not in df.columns and "length_m" in df.columns:
            df = df.rename({"length_m": "depth_m"})
            self.warning(
                "GEF supplies only penetration length (qty 1), no corrected "
                "depth (qty 11) — depths are along-rod, not inclination-corrected"
            )
            return df, True
        return df, False

    def _replace_non_finite(self, df: pl.DataFrame) -> tuple[pl.DataFrame, dict[str, int]]:
        """Replace non-finite (NaN / ±inf) values in float columns with null.

        A GEF data line can carry a bare ``nan`` / ``inf`` / ``-inf`` token, and
        ``float()`` reads each straight into an IEEE-754 non-finite double
        (``_parse_data`` does not special-case them). Left in the frame they
        poison every consumer — a NaN depth sorts undefined, an inf coordinate
        breaks spatial queries, and neither round-trips through strict JSON — so
        each is set to null here, at the parse boundary.

        The per-column count of non-finite values is returned rather than
        swallowed so ``_validate`` can raise the right issue: an ERROR for a
        non-finite ``depth_m`` (the row's anchor is unusable) and a WARNING for
        the measurement columns (a missing reading, not a corrupt anchor).

        Parameters
        ----------
        df : pl.DataFrame
            The post-rename, post-normalise, depth-ensured frame.

        Returns
        -------
        tuple[pl.DataFrame, dict[str, int]]
            The cleaned frame, and ``{column: non_finite_count}`` for every
            column that carried at least one non-finite value (empty when the
            frame was all-finite).
        """
        counts: dict[str, int] = {}
        exprs = []
        for col, dtype in zip(df.columns, df.dtypes, strict=True):
            if not dtype.is_float():
                continue
            # A non-finite value is one that is not finite AND not null — null
            # is a legitimately-missing reading, already handled elsewhere.
            n = df.select((pl.col(col).is_finite().not_() & pl.col(col).is_not_null()).sum()).item()
            if n:
                counts[col] = int(n)
                exprs.append(
                    pl.when(pl.col(col).is_finite()).then(pl.col(col)).otherwise(None).alias(col)
                )
        if exprs:
            df = df.with_columns(exprs)
            self.warning(
                f"GEF: replaced non-finite (NaN/inf) values with null in "
                f"{', '.join(f'{c}={n}' for c, n in sorted(counts.items()))}"
            )
        return df, counts

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

    def _drop_rows_without_qc(self, df: pl.DataFrame) -> tuple[pl.DataFrame, int]:
        """Drop every data row whose cone resistance is null.

        Runs after void masking and non-finite replacement, so a qc that was
        the file's void marker or NaN/inf is null here. A file without a qc
        column is left to ``_check_required_columns`` to report.

        Parameters
        ----------
        df : pl.DataFrame
            The frame after void masking, renaming and unit normalisation.

        Returns
        -------
        tuple[pl.DataFrame, int]
            The frame without those rows, and how many were dropped.

        Raises
        ------
        ParseError
            When no row at all carries a cone resistance value — there is
            nothing to import, and a silent empty series would look like a
            successful import.
        """
        if "qc_mpa" not in df.columns:
            return df, 0
        kept = df.filter(pl.col("qc_mpa").is_not_null())
        dropped = df.height - kept.height
        if dropped == 0:
            return df, 0
        if kept.height == 0:
            raise ParseError(
                f"GEF file has {dropped} data row(s) but none carries a cone "
                "resistance value — every qc is the file's void marker"
            )
        self.warning(
            f"GEF: {dropped} of {df.height} data row(s) carry no cone resistance "
            "(void marker) — dropped; the depth series has gaps there"
        )
        return kept, dropped

    def _validate(
        self,
        header: GEFHeader,
        df: pl.DataFrame,
        cpt_type: CPTType,
        depth_from_length: bool,
        skipped_rows: int,
        non_finite_counts: dict[str, int],
        rows_without_qc: int = 0,
    ) -> list[ValidationIssue]:
        checks = [
            self._check_column_count(header),
            self._check_coordinates(header),
            self._check_crs_codes(header),
            self._check_uncorrected_depth(depth_from_length),
            self._check_skipped_rows(skipped_rows, df.height),
            self._check_rows_without_qc(rows_without_qc, df.height),
            self._check_non_finite(non_finite_counts),
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

    def _check_non_finite(self, non_finite_counts: dict[str, int]) -> list[ValidationIssue]:
        """Report GEF columns whose data carried non-finite (NaN / ±inf) values.

        The values themselves are already nulled by ``_replace_non_finite``;
        this turns that fact into a validation finding the engineer sees. A
        non-finite ``depth_m`` is an ERROR — the row lost its depth anchor and
        cannot be placed — while a non-finite measurement (qc / fs / u2 / …) is
        a WARNING, the same class as any other missing reading.

        Parameters
        ----------
        non_finite_counts : dict[str, int]
            ``{column: count}`` of non-finite values found, from
            ``_replace_non_finite``.

        Returns
        -------
        list[ValidationIssue]
            An ERROR when ``depth_m`` had non-finite values, plus one WARNING
            listing the affected measurement columns; empty when the frame was
            all-finite.
        """
        issues: list[ValidationIssue] = []
        depth_n = non_finite_counts.get("depth_m", 0)
        if depth_n:
            issues.append(
                ValidationIssue(
                    ValidationLevel.ERROR,
                    "NON_FINITE_DEPTH",
                    f"{depth_n} depth value(s) were NaN or infinite and have been set to "
                    "null — those rows have no usable depth anchor",
                )
            )
        other = {col: n for col, n in non_finite_counts.items() if col != "depth_m"}
        if other:
            detail = ", ".join(f"{col}={n}" for col, n in sorted(other.items()))
            issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "NON_FINITE_VALUES",
                    f"non-finite (NaN/infinite) measurement value(s) replaced with null: {detail}",
                )
            )
        return issues

    def _check_column_count(self, header: GEFHeader) -> list[ValidationIssue]:
        """Refuse a ``#COLUMN=`` that declares more columns than any real GEF.

        Parameters
        ----------
        header : GEFHeader
            Carries ``n_columns`` — the value declared by ``#COLUMN=``.

        Returns
        -------
        list[ValidationIssue]
            A single ERROR ``TOO_MANY_COLUMNS`` issue when the declared count
            exceeds ``MAX_GEF_COLUMNS``, which refuses the import downstream
            (``has_errors``); empty otherwise. The paired guard in
            ``_parse_data`` has already stopped the oversized allocation — this
            is the honest "why it was refused" the caller surfaces.
        """
        if header.n_columns and header.n_columns > MAX_GEF_COLUMNS:
            return [
                ValidationIssue(
                    ValidationLevel.ERROR,
                    "TOO_MANY_COLUMNS",
                    f"#COLUMN= declares {header.n_columns} columns, over the "
                    f"{MAX_GEF_COLUMNS} cap for a real GEF — file refused",
                )
            ]
        return []

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
        else:
            # Coordinates present and not the (0, 0) placeholder: check they
            # actually fall inside the declared system's area. A swapped X/Y, a
            # wrong EPSG, or a foreign position is a WARNING here, never a
            # refusal. Skipped when the CRS is unknown (make_crs_bounds_issue
            # returns None) so it never doubles NO_EPSG / UNKNOWN_CRS_CODE.
            bounds_issue = make_crs_bounds_issue(header.epsg, header.x, header.y)
            if bounds_issue is not None:
                self.debug(
                    f"GEF coordinates ({header.x:g}, {header.y:g}) outside EPSG:"
                    f"{header.epsg} area — flagging {bounds_issue.code}"
                )
                issues.append(bounds_issue)
        # Only "no code at all" belongs here. A code that was written but not
        # recognised is a different, more specific story told by
        # ``_check_crs_codes`` — saying "no EPSG code" about a file that
        # declares one would send the reader looking for the wrong thing.
        if header.x is not None and header.xy_code is None:
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

    def _check_crs_codes(self, header: GEFHeader) -> list[ValidationIssue]:
        """Report GEF coordinate-system codes we could not translate to EPSG.

        Parameters
        ----------
        header : GEFHeader
            Carries the raw ``#XYID``/``#ZID`` codes and their translations.

        Returns
        -------
        list[ValidationIssue]
            ``UNKNOWN_CRS_CODE`` (WARNING) when a horizontal code was written
            but not recognised — the import will be refused downstream, and
            this says why. ``UNKNOWN_VERTICAL_CRS_CODE`` (INFO) for the same
            on the vertical datum, which only costs the datum label.
        """
        issues: list[ValidationIssue] = []
        if header.xy_code is not None and header.epsg is None:
            issues.append(
                ValidationIssue(
                    ValidationLevel.WARNING,
                    "UNKNOWN_CRS_CODE",
                    f"#XYID coordinate-system code {header.xy_code} is not a known "
                    "GEF code or supported EPSG — coordinates cannot be placed",
                )
            )
        if header.z_code is not None and header.z_epsg is None:
            issues.append(
                ValidationIssue(
                    ValidationLevel.INFO,
                    "UNKNOWN_VERTICAL_CRS_CODE",
                    f"#ZID vertical-datum code {header.z_code} is not a known GEF "
                    "code — elevations are stored without a named datum",
                )
            )
        return issues

    def _check_uncorrected_depth(self, depth_from_length: bool) -> list[ValidationIssue]:
        """Flag a depth series that is really an uncorrected penetration length.

        Parameters
        ----------
        depth_from_length : bool
            ``True`` when the file supplied only GEF qty 1 (sondeerlengte)
            and the parser used it as ``depth_m``.

        Returns
        -------
        list[ValidationIssue]
            One ``UNCORRECTED_DEPTH`` WARNING, or empty. The measurement is
            usable, but it is length along a rod that deviates from vertical,
            so every depth is biased deep — the engineer has to know that
            before a contact drawn on it goes into a model.
        """
        if not depth_from_length:
            return []
        return [
            ValidationIssue(
                ValidationLevel.WARNING,
                "UNCORRECTED_DEPTH",
                "File supplies penetration length (qty 1) but no corrected depth "
                "(qty 11) — depths are measured along the rod and are deeper than "
                "true vertical depth by the rod's deviation",
            )
        ]

    def _check_skipped_rows(self, skipped_rows: int, kept_rows: int) -> list[ValidationIssue]:
        """Report data lines dropped because they did not parse as numbers.

        Parameters
        ----------
        skipped_rows : int
            Count of unparseable data lines.
        kept_rows : int
            Count of rows that made it into the frame.

        Returns
        -------
        list[ValidationIssue]
            One ``SKIPPED_ROWS`` WARNING, or empty. A dropped row is a hole in
            the depth series; without this the import reports success and the
            hole only shows up as an unexplained gap in a chart.
        """
        if skipped_rows <= 0:
            return []
        return [
            ValidationIssue(
                ValidationLevel.WARNING,
                "SKIPPED_ROWS",
                f"{skipped_rows} of {skipped_rows + kept_rows} data line(s) could not "
                "be read as numbers and were dropped — the depth series has gaps",
            )
        ]

    def _check_rows_without_qc(self, rows_without_qc: int, kept_rows: int) -> list[ValidationIssue]:
        """Report data rows dropped because their cone resistance was null.

        Parameters
        ----------
        rows_without_qc : int
            Count of rows ``_drop_rows_without_qc`` removed.
        kept_rows : int
            Count of rows that made it into the frame.

        Returns
        -------
        list[ValidationIssue]
            One ``ROWS_WITHOUT_QC`` INFO, or empty. INFO, not WARNING: a
            pre-drilled stretch is routinely written as void rows, so the
            file is not degraded — the engineer just sees where the gap is.
        """
        if rows_without_qc <= 0:
            return []
        return [
            ValidationIssue(
                ValidationLevel.INFO,
                "ROWS_WITHOUT_QC",
                f"{rows_without_qc} of {rows_without_qc + kept_rows} data row(s) carried "
                "no cone resistance (void marker) and were dropped — the depth "
                "series has gaps there",
            )
        ]

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
