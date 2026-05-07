"""DOV XML → GEFParseResult parser.

DOV sonderings are published as XML at:
  https://www.dov.vlaanderen.be/data/sondering/{pkey_id}.xml

All coordinates are in Belgian Lambert 72 (EPSG:31370).
Elevations are in mTAW (Belgian ordnance datum, EPSG:5710).
Tip resistance (qc) and sleeve friction (fs) are in MPa; pore pressure (u) in MPa.

XML structure assumption (namespace http://www.dov.vlaanderen.be/schema/dov/1.0.0):
  dov/sondering/identificatie/proefnummer        (test ID)
  dov/sondering/ligging/xy/{x,y}                (location in Lambert72)
  dov/sondering/ligging/oorspronkelijk_maaiveld/waarde  (ground elevation mTAW)
  dov/sondering/sondering/data/laag/{tot,qc,fs,u,friction_ratio}  (measurements)

DOV XML element names are Dutch (schema-defined); they must appear as string literals
in findall/find calls but must NOT be used as Python identifiers. English equivalents
are noted in comments next to each tag reference.

If the structure does not match, parse() logs the actual root tag and child
element names at DEBUG level so the mismatch is immediately visible.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

import polars as pl

from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_NS = "http://www.dov.vlaanderen.be/schema/dov/1.0.0"
_T = f"{{{_NS}}}"  # '{http://...}' tag prefix shorthand


def _text(elem: ET.Element | None, tag: str) -> str:
    """Return stripped text of *tag* child, or empty string."""
    if elem is None:
        return ""
    child = elem.find(tag)
    return (child.text or "").strip() if child is not None else ""


def _float(elem: ET.Element | None, tag: str) -> float | None:
    """Return float value of *tag* child, or None if missing/non-numeric."""
    raw = _text(elem, tag)
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


class DovParser(GroundModelLogger):
    """Parse a DOV sondering XML document into a GEFParseResult.

    The parser reuses the same result type as GEFParser so the full persist
    pipeline (ImportCpt.persist) can be called without modification.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def parse(self, xml_bytes: bytes, name: str = "") -> GEFParseResult:
        """Parse *xml_bytes* and return a GEFParseResult.

        Parameters
        ----------
        xml_bytes : bytes
            Raw XML from https://www.dov.vlaanderen.be/data/sondering/{id}.xml
        name : str
            Fallback display name when the XML test ID is absent.

        Returns
        -------
        GEFParseResult
            Parsed result with header, data frame, and validation issues.

        Raises
        ------
        ParseError
            When the document is not a valid DOV sondering XML.
        """
        self.debug(f"DOV parser: parsing '{name}' ({len(xml_bytes)} bytes)")

        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            raise ParseError(f"DOV XML parse error for '{name}': {exc}") from exc

        # Log root structure to diagnose namespace or schema mismatches.
        self.trace(f"DOV XML root tag: {root.tag!r}  children: {[c.tag for c in root]}")

        cpt_elem = root.find(f"{_T}sondering")  # sondering = sounding / CPT
        if cpt_elem is None:
            # Log what IS there so the mismatch is immediately visible in the logs.
            self.error(
                f"DOV XML '{name}': expected <sondering> in namespace {_NS!r} "
                f"but root children are: {[c.tag for c in root]}"
            )
            raise ParseError(f"DOV XML for '{name}': missing <sondering> element")

        header = self._parse_header(cpt_elem, name)
        data, issues = self._parse_data(cpt_elem, name)
        cpt_type = self._detect_type(data)

        self.debug(
            f"DOV parser: '{name}' → {cpt_type.value}, "
            f"{len(data)} rows, x={header.x}, y={header.y}, z={header.z}"
        )
        return GEFParseResult(header=header, cpt_type=cpt_type, data=data, issues=issues)

    # ------------------------------------------------------------------
    # Header
    # ------------------------------------------------------------------

    def _parse_header(self, cpt_elem: ET.Element, name: str) -> GEFHeader:
        identification = cpt_elem.find(f"{_T}identificatie")  # identificatie = identification
        location_elem = cpt_elem.find(f"{_T}ligging")  # ligging = location

        if identification is None:
            self.warning(f"DOV XML '{name}': <identificatie> element not found")
        if location_elem is None:
            self.warning(f"DOV XML '{name}': <ligging> element not found — no coordinates")

        probe_id = (
            _text(identification, f"{_T}proefnummer") if identification is not None else ""
        )  # proefnummer = test number
        company = (
            _text(identification, f"{_T}uitvoerder") if identification is not None else ""
        )  # uitvoerder = company/executor
        file_date = (
            _text(identification, f"{_T}datum_aanvang") if identification is not None else ""
        )  # datum_aanvang = start date

        x = y = z = None
        if location_elem is not None:
            xy = location_elem.find(f"{_T}xy")
            if xy is None:
                self.warning(f"DOV XML '{name}': <xy> not found inside <ligging>")
            else:
                x = _float(xy, f"{_T}x")
                y = _float(xy, f"{_T}y")
                if x is None or y is None:
                    self.warning(
                        f"DOV XML '{name}': <x> or <y> missing/non-numeric "
                        f"(x={_text(xy, f'{_T}x')!r}, y={_text(xy, f'{_T}y')!r})"
                    )

            # oorspronkelijk_maaiveld = original ground level
            surface_elem = location_elem.find(f"{_T}oorspronkelijk_maaiveld")
            if surface_elem is None:
                self.debug(f"DOV XML '{name}': <oorspronkelijk_maaiveld> not found — no elevation")
            else:
                z = _float(surface_elem, f"{_T}waarde")  # waarde = value
                if z is None:
                    self.debug(f"DOV XML '{name}': ground level <waarde> is missing/non-numeric")

        return GEFHeader(
            # project_id="DOV" scopes duplicate detection to DOV imports per project
            project_id="DOV",
            test_id=probe_id or name,
            company=company,
            file_date=file_date,
            x=x,
            y=y,
            z=z,
            epsg=31370,  # Belgian Lambert 72
            z_epsg=5710,  # Belgian mTAW (TAW/NGF)
        )

    # ------------------------------------------------------------------
    # Measurement data
    # ------------------------------------------------------------------

    def _parse_data(
        self, cpt_elem: ET.Element, name: str
    ) -> tuple[pl.DataFrame, list[ValidationIssue]]:
        issues: list[ValidationIssue] = []

        # The inner <sondering> element (same tag as the outer container) holds measurements.
        measurements_elem = cpt_elem.find(f"{_T}sondering")  # sondering = sounding
        if measurements_elem is None:
            self.error(
                f"DOV XML '{name}': inner <sondering> not found. "
                f"Outer <sondering> children: {[c.tag for c in cpt_elem]}"
            )
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.ERROR,
                    code="NO_DATA",
                    message=f"DOV XML '{name}': missing inner <sondering> element",
                )
            )
            return pl.DataFrame({"depth_m": [], "qc_mpa": []}), issues

        data_elem = measurements_elem.find(f"{_T}data")
        if data_elem is None:
            self.error(
                f"DOV XML '{name}': <data> not found inside inner <sondering>. "
                f"Inner <sondering> children: {[c.tag for c in measurements_elem]}"
            )
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.ERROR,
                    code="NO_DATA",
                    message=f"DOV XML '{name}': missing <data> element",
                )
            )
            return pl.DataFrame({"depth_m": [], "qc_mpa": []}), issues

        # laag = layer (one measurement depth step)
        layer_elements = data_elem.findall(f"{_T}laag")
        self.trace(f"DOV XML '{name}': found {len(layer_elements)} <laag> (layer) elements")

        if layer_elements:
            # Log field names from the first layer to verify the schema hasn't changed.
            first_fields = [c.tag.replace(f"{_T}", "") for c in layer_elements[0]]
            self.debug(f"DOV XML '{name}': first layer fields: {first_fields}")

        rows: list[dict[str, float | None]] = []
        skipped = 0
        for layer in layer_elements:
            depth = _float(layer, f"{_T}tot")  # tot = bottom of depth interval
            qc = _float(layer, f"{_T}qc")
            if depth is None or qc is None:
                skipped += 1
                continue
            rows.append(
                {
                    "depth_m": depth,
                    "qc_mpa": qc,
                    "fs_mpa": _float(layer, f"{_T}fs"),
                    "u2_mpa": _float(layer, f"{_T}u"),
                    "rf_pct": _float(layer, f"{_T}friction_ratio"),
                }
            )

        if skipped:
            self.warning(f"DOV XML '{name}': skipped {skipped} layers with missing depth or qc")

        if not rows:
            self.error(f"DOV XML '{name}': zero valid measurement layers after parsing")
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.WARNING,
                    code="EMPTY_DATA",
                    message=f"DOV XML '{name}': no measurement rows found",
                )
            )
            return pl.DataFrame({"depth_m": [], "qc_mpa": []}), issues

        df = pl.DataFrame(rows)

        # Drop optional columns that contain only nulls so _to_orm skips them.
        for col in ("fs_mpa", "u2_mpa", "rf_pct"):
            if col in df.columns and df[col].drop_nulls().len() == 0:
                df = df.drop(col)
                self.trace(f"DOV XML '{name}': dropped all-null column '{col}'")

        return df, issues

    # ------------------------------------------------------------------
    # CPT type detection
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_type(df: pl.DataFrame) -> CPTType:
        has_u = "u2_mpa" in df.columns and df["u2_mpa"].drop_nulls().len() > 0
        has_fs = "fs_mpa" in df.columns and df["fs_mpa"].drop_nulls().len() > 0
        if has_u:
            return CPTType.CPTU
        if has_fs:
            return CPTType.CPTE
        return CPTType.CPTM
