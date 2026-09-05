"""DOV XML → GEFParseResult parser.

DOV sonderings are published as XML at:
  https://www.dov.vlaanderen.be/data/sondering/{permkey}.xml
which 302-redirects to:
  https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/{permkey}

XML structure (verified against live DOV data 2026-05-07):
  Namespace: http://kern.schemas.dov.vlaanderen.be (root only — children unprefixed)
  GML namespace: http://www.opengis.net/gml/3.2 (used for coordinates)

  dov-schema/sondering/sondeernummer            (test ID, e.g. "GEO-02/079-S3")
  dov-schema/sondering/datum_aanvang            (start date, ISO format)
  dov-schema/sondering/uitvoerder/naam          (company name)
  dov-schema/sondering/ligging/gml:Point/gml:pos (X Y Z space-separated, EPSG:31370)
  dov-schema/sondering/sondeonderzoek/sondeerapparaat/sondeerconus/conustype  (E, U, M1, ...)
  dov-schema/sondering/sondeonderzoek/sondeerapparaat/sondeerconus/net_area_ratio
  dov-schema/sondering/sondeonderzoek/penetratietest/meetdata/{lengte,diepte,qc,fs,u,Qt,i}

UNITS (this is critical):
  qc, Qt: MPa  (no conversion needed)
  fs, u:  kPa  (DOV stores as integers like 10, 20, 90 — divide by 1000 for MPa)
  lengte, diepte: meters
  i:      degrees (inclination)

DEPTH:
  ``<diepte>`` is the vertical depth (already corrected for inclination by DOV
  using the ``<i>`` series) — we trust it and use it directly. Fall back to
  ``<lengte>`` (raw penetration length) only when ``<diepte>`` is missing, which
  happens for some mechanical cones where verticality is assumed.

CONE TYPE detection from <conustype>:
  M*    → CPTM (mechanical: only qc + Qt available)
  E*    → CPTE (electric: qc + fs + i, no pore pressure)
  U*/EU → CPTU (piezocone: qc + fs + u + i)

  The cone type code we store on GEFHeader (0=electric / 1=mechanical) follows the
  GEF MEASUREMENTVAR 12 convention, so it can't distinguish CPTE from CPTU on its
  own — those are both code 0. The CPTU vs CPTE distinction is then made from the
  data: presence of u2 readings → CPTU, otherwise CPTE.

Rf is NOT in the DOV XML — we calculate it as (fs/qc)*100 when fs is available.

DOV XML element names are Dutch (schema-defined); they must appear as string literals
in find/findall calls but must NOT be used as Python identifiers. English equivalents
are noted in comments next to each tag reference. Module-level constants for the
namespace and tag prefixes live in ``dov_constants.py``.

Debugging: parse() logs the actual root tag and child element names at DEBUG level
when expected paths are missing, so schema mismatches are immediately visible.
"""

from __future__ import annotations

# defusedxml — guards against billion-laughs entity expansion +
# external DTD fetches that stdlib ``xml.etree.ElementTree`` is
# vulnerable to. Drop-in API replacement. See debt #12.
import defusedxml.ElementTree as ET
import polars as pl

from groundmodel.domain.value_objects.derived_value_source import DerivedValueSource
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.parsers.cpt.dov.dov_constants import (
    DOV_HORIZONTAL_EPSG,
    DOV_VERTICAL_EPSG,
    DOV_XML_NAMESPACE,
)
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.crs_bounds_issue import make_crs_bounds_issue
from groundmodel.infrastructure.parsers.dov.dov_gml_location import (
    parse_gml_point_location,
)
from groundmodel.infrastructure.parsers.dov.dov_xml_helpers import float_value, text
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    make_issue as _issue,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DovParser(GroundModelLogger):
    """Parse a DOV sondering XML document into a GEFParseResult.

    Reuses the GEFParseResult type so the full persist pipeline
    (ImportCpt.persist) can be called without modification.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def parse(self, xml_bytes: bytes, name: str = "") -> GEFParseResult:
        """Parse *xml_bytes* and return a GEFParseResult.

        Parameters
        ----------
        xml_bytes : bytes
            Raw XML body fetched from the DOV sondering endpoint.
        name : str
            Fallback display name when the XML <sondeernummer> is absent.

        Returns
        -------
        GEFParseResult
            Parsed result with header, data frame, and validation issues.

        Raises
        ------
        ParseError
            When the document is not parseable XML or has no <sondering> child.
        """
        self.debug(f"DOV parser: parsing '{name}' ({len(xml_bytes)} bytes)")

        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            raise ParseError(f"DOV XML parse error for '{name}': {exc}") from exc

        # Log root structure so namespace or schema mismatches are immediately visible.
        self.trace(f"DOV XML root tag: {root.tag!r}  children: {[c.tag for c in root]}")

        # The root is <dov-schema>; we want the <sondering> child inside it.
        cpt_elem = root.find("sondering")  # sondering = sounding / CPT
        if cpt_elem is None:
            self.error(
                f"DOV XML '{name}': expected <sondering> in namespace {DOV_XML_NAMESPACE!r} "
                f"but root <{root.tag}> children are: {[c.tag for c in root]}"
            )
            raise ParseError(f"DOV XML for '{name}': missing <sondering> element")

        header = self._parse_header(cpt_elem, name)
        data, issues = self._parse_data(cpt_elem, name, header.cone_type_code)
        cpt_type = self._detect_type(header.cone_type_code, data)

        # DOV positions are Belgian Lambert 72 (EPSG:31370). Flag a position
        # that falls outside Belgium's coverage — a swapped X/Y or a foreign
        # coordinate — as a WARNING, never a refusal. Skip the (0, 0)
        # null-island placeholder: it is its own concern, not an out-of-area
        # coordinate.
        if not (header.x == 0.0 and header.y == 0.0):
            bounds_issue = make_crs_bounds_issue(
                header.epsg, header.x, header.y, prefix=f"DOV XML '{name}'"
            )
            if bounds_issue is not None:
                self.debug(f"DOV XML '{name}': {bounds_issue.message}")
                issues.append(bounds_issue)

        # DOV Rf provenance is fixed by the source schema: Rf is NEVER in the
        # DOV XML, so _parse_data computes it from fs and qc whenever fs is
        # present. The column is dropped when all-null, in which case the
        # source flag stays None to keep the (column present ⇔ flag set)
        # invariant. q_total_mpa and qt_mpa are always source-provided
        # (DOV's <Qt> element), so they carry no provenance flag.
        rf_source = DerivedValueSource.COMPUTED if "rf_pct" in data.columns else None

        self.debug(
            f"DOV parser: '{name}' → {cpt_type.value}, "
            f"{len(data)} rows, x={header.x}, y={header.y}, z={header.z}, "
            f"a={header.net_area_ratio}"
        )
        # Stamp DOV provenance when the row carries a Z; stamp NONE
        # when it doesn't so the refresh-on-duplicate path can later
        # populate an upstream Z without colliding with a "manual"
        # default we never set. Debt #8.
        elevation_source = ElevationSource.DOV if header.z is not None else ElevationSource.NONE
        return GEFParseResult(
            header=header,
            cpt_type=cpt_type,
            data=data,
            issues=issues,
            rf_source=rf_source,
            elevation_source=elevation_source,
        )

    # ------------------------------------------------------------------
    # Header
    # ------------------------------------------------------------------

    def _parse_header(self, cpt_elem: ET.Element, name: str) -> GEFHeader:
        # sondeernummer = test number; uitvoerder = company; datum_aanvang = start date
        test_id = text(cpt_elem, "sondeernummer")
        file_date = text(cpt_elem, "datum_aanvang")

        company = ""
        company_elem = cpt_elem.find("uitvoerder")
        if company_elem is not None:
            company = text(company_elem, "naam")  # naam = name (nested)

        x, y, z = self._parse_location(cpt_elem, name)
        net_area_ratio, cone_type_code = self._parse_cone_metadata(cpt_elem, name)

        return GEFHeader(
            # project_id="DOV" scopes duplicate detection to DOV imports per project
            project_id="DOV",
            test_id=test_id or name,
            company=company,
            file_date=file_date,
            x=x,
            y=y,
            z=z,
            epsg=DOV_HORIZONTAL_EPSG,
            z_epsg=DOV_VERTICAL_EPSG,
            net_area_ratio=net_area_ratio,
            cone_type_code=cone_type_code,
        )

    def _parse_location(
        self, cpt_elem: ET.Element, name: str
    ) -> tuple[float | None, float | None, float | None]:
        """Extract X, Y, Z from the GML Point inside <ligging>.

        DOV stores coordinates as ``<gml:pos>X Y Z</gml:pos>`` (space-separated)
        with srsName urn:ogc:def:crs:EPSG::6190 — but the numeric values match
        Belgian Lambert 72 (EPSG:31370), confirmed against the WFS X_mL72/Y_mL72
        properties. We treat them as 31370.

        Shares the structural GML walk with the boring parser via
        ``parse_gml_point_location``; only the failure channel (warning
        + Nones, no ValidationIssues) is CPT-specific.
        """
        loc = parse_gml_point_location(cpt_elem, "ligging")  # ligging = location
        if loc.failure_detail is not None:
            self.warning(f"DOV XML '{name}': {loc.failure_detail}")
            return None, None, None
        if loc.z_non_numeric is not None:
            self.debug(
                f"DOV XML '{name}': <gml:pos> Z component non-numeric: {loc.z_non_numeric!r}"
            )
        return loc.x, loc.y, loc.z

    def _parse_cone_metadata(
        self, cpt_elem: ET.Element, name: str
    ) -> tuple[float | None, int | None]:
        """Extract net area ratio and cone type code from <sondeerconus>.

        Cone type code mapping (matches GEF MEASUREMENTVAR 12 convention):
          0 = electric (E*, U*, EU)
          1 = mechanical (M*)

        Note: code 0 covers both pure-electric (CPTE) and piezocone (CPTU). The
        CPTE vs CPTU distinction is made later in _detect_type using the data.
        """
        # A (None, None) return leaves cone_type_code unknown, which drives the
        # mechanical-vs-electric routing that decides q_total_mpa (CPTM) vs
        # qt_mpa (CPTU) downstream — physically distinct columns, never derived
        # from each other (see project_qt_vs_qtotal). So log WHAT was found when
        # the expected structure is absent, at DEBUG (cone metadata is
        # legitimately absent on older records — not an error), naming the
        # actual child tags so the mismatch is visible without a re-run.
        # sondeonderzoek = the test data container; sondeerapparaat = sounding apparatus
        test_data_elem = cpt_elem.find("sondeonderzoek")
        if test_data_elem is None:
            self.debug(
                f"DOV XML '{name}': no <sondeonderzoek> for cone metadata — "
                f"cone type unknown. <sondering> children: {[c.tag for c in cpt_elem]}"
            )
            return None, None

        apparatus_elem = test_data_elem.find("sondeerapparaat")
        if apparatus_elem is None:
            self.debug(
                f"DOV XML '{name}': no <sondeerapparaat> for cone metadata — "
                f"cone type unknown. <sondeonderzoek> children: "
                f"{[c.tag for c in test_data_elem]}"
            )
            return None, None

        cone_elem = apparatus_elem.find("sondeerconus")  # sondeerconus = sounding cone
        if cone_elem is None:
            self.debug(
                f"DOV XML '{name}': no <sondeerconus> for cone metadata — "
                f"cone type unknown. <sondeerapparaat> children: "
                f"{[c.tag for c in apparatus_elem]}"
            )
            return None, None

        net_area_ratio = float_value(cone_elem, "net_area_ratio")
        cone_type_str = text(cone_elem, "conustype")

        cone_type_code: int | None
        if cone_type_str.startswith("M"):
            cone_type_code = 1  # mechanical
        elif cone_type_str.startswith(("E", "U")):
            cone_type_code = 0  # electric (E, U, EU)
        else:
            cone_type_code = None
            if cone_type_str:
                self.debug(f"DOV XML '{name}': unknown <conustype>={cone_type_str!r}")
            else:
                # <sondeerconus> present but <conustype> empty — cone type still
                # unknown, so the CPTM/CPTU routing loses its hint. Name the
                # cone children so the missing/empty field is visible.
                self.debug(
                    f"DOV XML '{name}': <conustype> present but empty — cone type "
                    f"unknown. <sondeerconus> children: {[c.tag for c in cone_elem]}"
                )

        return net_area_ratio, cone_type_code

    # ------------------------------------------------------------------
    # Measurement data
    # ------------------------------------------------------------------

    def _parse_data(
        self, cpt_elem: ET.Element, name: str, cone_type_code: int | None
    ) -> tuple[pl.DataFrame, list[ValidationIssue]]:
        issues: list[ValidationIssue] = []
        empty = pl.DataFrame({"depth_m": [], "qc_mpa": []})

        # sondeonderzoek = test data container; penetratietest = penetration test
        test_data_elem = cpt_elem.find("sondeonderzoek")
        if test_data_elem is None:
            self.error(
                f"DOV XML '{name}': <sondeonderzoek> not found. "
                f"<sondering> children: {[c.tag for c in cpt_elem]}"
            )
            issues.append(
                _issue(
                    ValidationLevel.ERROR, "NO_DATA", f"DOV XML '{name}': missing <sondeonderzoek>"
                )
            )
            return empty, issues

        penetration_elem = test_data_elem.find("penetratietest")
        if penetration_elem is None:
            self.error(
                f"DOV XML '{name}': <penetratietest> not found. "
                f"<sondeonderzoek> children: {[c.tag for c in test_data_elem]}"
            )
            issues.append(
                _issue(
                    ValidationLevel.ERROR, "NO_DATA", f"DOV XML '{name}': missing <penetratietest>"
                )
            )
            return empty, issues

        # meetdata = measurement record (one per depth step)
        measurement_elements = penetration_elem.findall("meetdata")
        self.trace(f"DOV XML '{name}': found {len(measurement_elements)} <meetdata> rows")

        if measurement_elements:
            # Log fields in the first row to verify the schema hasn't changed.
            first_fields = [c.tag for c in measurement_elements[0]]
            self.debug(f"DOV XML '{name}': first row fields: {first_fields}")

        # qt is routed to one of two columns by cone type — mirror the key
        # _extract_rows writes so the explicit schema below matches the dicts.
        qt_key = "q_total_mpa" if cone_type_code == 1 else "qt_mpa"

        rows, skipped = self._extract_rows(measurement_elements, name, cone_type_code)

        if skipped:
            self.warning(f"DOV XML '{name}': skipped {skipped} rows with missing depth or qc")

        if not rows:
            self.error(f"DOV XML '{name}': zero valid measurement rows after parsing")
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "EMPTY_DATA",
                    f"DOV XML '{name}': no measurement rows found",
                )
            )
            return empty, issues

        # Explicit schema, NOT inference. Every row dict carries the same five
        # float|None keys, but a column can be None for the first 100+ rows
        # then carry a value deeper down (seen on DOV CPTU files where fs/u/Qt
        # start mid-sounding). Polars' default infer_schema_length=100 would
        # type that column Null and then raise ComputeError ("could not append
        # value 0.247 of type f64 to the builder") on the first real value —
        # silently dropping the whole CPT. Pinning Float64 makes it robust to
        # where the first non-null appears.
        df = pl.DataFrame(
            rows,
            schema={
                "depth_m": pl.Float64,
                "qc_mpa": pl.Float64,
                "fs_mpa": pl.Float64,
                "u2_mpa": pl.Float64,
                qt_key: pl.Float64,
            },
        )

        # Calculate Rf (%) from qc and fs since DOV doesn't store it directly.
        if "fs_mpa" in df.columns:
            df = df.with_columns(
                pl.when(pl.col("qc_mpa") > 0)
                .then((pl.col("fs_mpa") / pl.col("qc_mpa")) * 100.0)
                .otherwise(None)
                .alias("rf_pct")
            )

        # Drop columns that ended up entirely null so _to_orm skips them.
        for col in ("fs_mpa", "u2_mpa", "rf_pct", "qt_mpa", "q_total_mpa"):
            if col in df.columns and df[col].drop_nulls().len() == 0:
                df = df.drop(col)
                self.trace(f"DOV XML '{name}': dropped all-null column '{col}'")

        return df, issues

    def _extract_rows(
        self, measurement_elements: list[ET.Element], name: str, cone_type_code: int | None
    ) -> tuple[list[dict[str, float | None]], int]:
        """Build measurement row dicts from <meetdata> elements.

        Returns (rows, skipped_count). A row is skipped when depth or qc is missing.

        Units conversion:
          qc, Qt: MPa (no conversion)
          fs, u:  kPa → /1000 → MPa to match GEFParser output

        Depth:
          ``<diepte>`` is the vertical depth, already corrected for inclination by
          DOV using the per-row ``<i>`` series. We trust it and use it directly —
          no need to recompute lengte * cos(i). Fall back to ``<lengte>`` (raw
          penetration length) only when ``<diepte>`` is absent, which happens for
          some mechanical cones with no inclination tracking.

        Qt routing:
          DOV's ``<Qt>`` is two physically different quantities depending on cone
          type:

          * Mechanical cone (``cone_type_code == 1``) → totaalweerstand, the
            combined tip + sleeve force a Begemann/CPTM apparatus reads in one
            go. Stored as ``q_total_mpa``.
          * Electric / piezocone (``cone_type_code == 0`` or unknown) → Robertson
            corrected cone resistance qt = qc + u2(1 - a). Stored as ``qt_mpa``.

          When ``cone_type_code`` is ``None`` we default to ``qt_mpa`` because
          most DOV CPTUs ship Qt in this slot, and CPTM rows have a populated
          ``cone_type_code`` in practice.
        """
        qt_key = "q_total_mpa" if cone_type_code == 1 else "qt_mpa"

        rows: list[dict[str, float | None]] = []
        skipped = 0
        for measurement in measurement_elements:
            depth = float_value(measurement, "diepte")  # already inclination-corrected by DOV
            if depth is None:
                depth = float_value(measurement, "lengte")  # mechanical / no-i fallback
            qc_mpa = float_value(measurement, "qc")

            if depth is None or qc_mpa is None:
                skipped += 1
                continue

            fs_kpa = float_value(measurement, "fs")
            u_kpa = float_value(measurement, "u")
            qt_value = float_value(measurement, "Qt")  # capital Q, lowercase t

            rows.append(
                {
                    "depth_m": depth,
                    "qc_mpa": qc_mpa,
                    # DOV stores fs and u in kPa as integers; convert to MPa to match GEF.
                    "fs_mpa": (fs_kpa / 1000.0) if fs_kpa is not None else None,
                    "u2_mpa": (u_kpa / 1000.0) if u_kpa is not None else None,
                    qt_key: qt_value,
                }
            )
        return rows, skipped

    # ------------------------------------------------------------------
    # CPT type detection
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_type(cone_type_code: int | None, df: pl.DataFrame) -> CPTType:
        """Detect CPTU / CPTE / CPTM from the cone type code and column availability.

        Decision order:
          1. cone_type_code 1 (mechanical) → CPTM, regardless of stray fs/u columns.
          2. u2 column has values → CPTU. (CPTU also has fs, but we don't need to
             check for it: presence of u2 alone uniquely identifies a piezocone.)
          3. fs column has values (and no u2) → CPTE — an electric cone *without*
             the piezo sensor. The fs check ISN'T redundant with step 2: it's the
             discriminator that separates CPTE from a CPTM that happens to lack
             a cone_type_code.
          4. Otherwise (only qc/Qt) → CPTM.
        """
        # Step 1 — mechanical cone overrides everything.
        if cone_type_code == 1:
            return CPTType.CPTM

        # Step 2 — piezocone signal: any u2 reading implies CPTU.
        if "u2_mpa" in df.columns and df["u2_mpa"].drop_nulls().len() > 0:
            return CPTType.CPTU

        # Step 3 — electric cone without piezo: has fs but no u2 → CPTE.
        if "fs_mpa" in df.columns and df["fs_mpa"].drop_nulls().len() > 0:
            return CPTType.CPTE

        # Step 4 — bare qc/Qt only → CPTM.
        return CPTType.CPTM
