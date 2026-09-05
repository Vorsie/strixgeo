"""DOV ``/data/boring/{permkey}.xml`` → BoreholeParseResult parser.

DOV boreholes are published as XML at::

    https://www.dov.vlaanderen.be/data/boring/{permkey}.xml

which 302-redirects to::

    https://www.dov.vlaanderen.be/xdov/proxy/export/boring/{permkey}

The proxy URL is hit directly by the Phase C client to save one round-trip
per download (see ``DOV_BORING_PROXY_URL_PREFIX`` in ``dov_constants``).

Schema (verified live 2026-05-08, real example permkey ``2025-232644``)
----------------------------------------------------------------------

::

    <ns4:dov-schema>
      <boring>
        <identificatie>1411-GEO-25/022-B4</identificatie>          # bore number
        <dataidentifier>
          <permkey>2025-232644</permkey>
          <uri>https://www.dov.vlaanderen.be/data/boring/...</uri>
        </dataidentifier>
        <ligging>
          <gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
            <gml:pos>107804.72 188493.50 7.84</gml:pos>            # X Y Z (Lambert 72)
          </gml:Point>
        </ligging>
        <gemeente>44088</gemeente>                                  # NIS code OR name
        <diepte_tot>8.50</diepte_tot>                               # total depth m
        <datum_aanvang>2025-06-13</datum_aanvang>
        <doel>Geotechnisch onderzoek</doel>                         # purpose
        <boringtype>Geotechnische boring - (dis)continue monstername</boringtype>
        <uitvoerder><naam>Geolab</naam></uitvoerder>
        <details>
          <boormethode>                                              # repeated, drill segments
            <van>0.00</van><tot>0.50</tot><methode>spade</methode>
          </boormethode>
          ...
          <kleur>                                                    # repeated, field log: color
            <van>0.00</van><tot>1.50</tot><kleur>groenbruin</kleur>
          </kleur>
          ...
          <vochtgehalte>                                             # repeated, field log: moisture
            <van>0.00</van><tot>2.50</tot><vochtgehalte>weinig vochtig</vochtgehalte>
          </vochtgehalte>
          ...
          <consistentie>                                             # repeated, field log: consistency
            <van>6.00</van><tot>7.00</tot><consistentie>plastisch</consistentie>
          </consistentie>
          ...
          <grondwaterstand>
            <diepte_grondwater>4.30</diepte_grondwater>
          </grondwaterstand>
        </details>
      </boring>
    </ns4:dov-schema>

Important schema quirks
-----------------------
1. The DOV namespace is set ONLY on the ``<dov-schema>`` root; all children
   (``<boring>``, ``<identificatie>``, etc.) are unprefixed. GML elements
   inside ``<ligging>`` keep their gml: prefix.
2. Each field-log wrapper (``<kleur>``, ``<vochtgehalte>``, ``<consistentie>``)
   contains a same-named child for the value: ``<kleur><kleur>groenbruin</kleur></kleur>``.
3. Coordinates: the gml:Point's ``srsName`` advertises EPSG:6190 (a Belgian-
   specific code) but the numeric values match Lambert 72 (EPSG:31370) one
   decimal at a time. We treat them as 31370 — confirmed against the
   matching WFS row's ``X_mL72`` / ``Y_mL72``.

What the parser does NOT extract
--------------------------------
* The WFS-level ``methode`` summary ("Meerdere technieken", etc.) is not in
  the XML — the orchestrator fills ``Borehole.drill_method`` from the WFS
  feature row.
* Observations live in separate interpretation XMLs (Phase B2).
* Samples and lab tests come from grondmonsters / observaties WFS layers and
  separate XMLs (Phase B3 / Phase C).
"""

from __future__ import annotations

# defusedxml — guards against billion-laughs entity expansion +
# external DTD fetches that stdlib ``xml.etree.ElementTree`` is
# vulnerable to. Drop-in API replacement. See debt #12.
import defusedxml.ElementTree as ET

from groundmodel.domain.models.borehole.borehole import Borehole
from groundmodel.domain.models.borehole.drill_segment import DrillSegment
from groundmodel.domain.models.borehole.field_log_interval import FieldLogInterval
from groundmodel.domain.value_objects.field_log_kind import FieldLogKind
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_BORING_DETAILS_TAG,
    DOV_BORING_DRILL_METHOD_TAG,
    DOV_BORING_DRILL_SEGMENT_TAG,
    DOV_BORING_EXECUTOR_PARENT_TAG,
    DOV_BORING_FIELD_LOG_TAGS,
    DOV_BORING_GROUNDWATER_DEPTH_TAG,
    DOV_BORING_GROUNDWATER_TAG,
    DOV_BORING_LOCATION_TAG,
    DOV_BORING_MUNICIPALITY_TAG,
    DOV_BORING_NAME_TAG,
    DOV_BORING_PURPOSE_TAG,
    DOV_BORING_START_DATE_TAG,
    DOV_BORING_TOT_TAG,
    DOV_BORING_TOTAL_DEPTH_TAG,
    DOV_BORING_TYPE_TAG,
    DOV_BORING_VAN_TAG,
    DOV_HORIZONTAL_EPSG,
    DOV_VERTICAL_EPSG,
    DOV_XML_NAMESPACE,
)
from groundmodel.infrastructure.parsers.crs_bounds_issue import make_crs_bounds_issue
from groundmodel.infrastructure.parsers.dov.dov_gml_location import (
    parse_gml_point_location,
)
from groundmodel.infrastructure.parsers.dov.dov_xml_helpers import (
    date_iso,
    float_value,
    text,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    make_issue as _issue,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DovBoringParser(GroundModelLogger):
    """Parse a DOV ``boring`` XML document into a ``BoreholeParseResult``.

    The parser is single-responsibility: it converts XML bytes to a
    structured ``BoreholeParseResult`` and emits ``ValidationIssue``s for
    structural problems. It never raises on borehole-level data quality
    issues (missing depth, malformed segment) — those become validation
    findings so the import pipeline can continue with the rest of the bbox.

    The only fatal outcome is unparseable XML or a missing ``<boring>``
    root child, both of which raise ``ParseError`` (the orchestrator
    converts that into a per-borehole skip).

    Logging
    -------
    The parser inherits ``GroundModelLogger`` and emits at:

    * ``trace`` — per-interval extraction (drill segment / field-log row).
    * ``debug`` — high-cardinality structural detail (root-tag mismatches,
      child element listings on missing-element fallbacks).
    * ``info`` — phase boundaries (parse start).
    * ``warning`` — degraded but continuing (skipped malformed interval).
    * ``error`` — terminal structural error before raising ``ParseError``.
    * ``success`` — happy-path completion with row counts.
    """

    def __init__(self) -> None:
        """Initialise with the canonical module-name logger."""
        super().__init__(__name__)

    def parse(self, xml_bytes: bytes, name: str = "") -> BoreholeParseResult:
        """Parse *xml_bytes* into a ``BoreholeParseResult``.

        Parameters
        ----------
        xml_bytes : bytes
            Raw XML body fetched from the DOV boring endpoint.
        name : str
            Display name used as fallback when the XML's ``<identificatie>``
            element is empty, and in log messages so a failing borehole is
            identifiable in stream-parse output.

        Returns
        -------
        BoreholeParseResult
            Borehole header + drill segments + field log + validation issues.

        Raises
        ------
        ParseError
            When *xml_bytes* is not parseable XML or the document has no
            ``<boring>`` child under the root.
        """
        self.debug(f"DOV boring parser: parsing {name!r} ({len(xml_bytes)} bytes)")

        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            self.error(f"DOV boring '{name}': XML parse error: {exc}")
            raise ParseError(f"DOV boring XML parse error for '{name}': {exc}") from exc

        # Log root structure so namespace or schema mismatches are immediately
        # visible without re-running with a debugger.
        self.trace(f"DOV boring '{name}' root tag={root.tag!r} children={[c.tag for c in root]}")

        # The root is <ns4:dov-schema> with the <boring> child unprefixed.
        boring_elem = root.find("boring")
        if boring_elem is None:
            self.error(
                f"DOV boring '{name}': expected <boring> child of root "
                f"(namespace {DOV_XML_NAMESPACE!r}); root <{root.tag}> children: "
                f"{[c.tag for c in root]}"
            )
            raise ParseError(f"DOV boring XML for '{name}': missing <boring> element")

        issues: list[ValidationIssue] = []

        borehole = self._parse_header(boring_elem, name, issues)

        details_elem = boring_elem.find(DOV_BORING_DETAILS_TAG)
        drill_segments = self._parse_drill_segments(details_elem, name, issues)
        field_log = self._parse_field_log(details_elem, name, issues)

        # Pull water-table depth from inside <details><grondwaterstand>.
        if details_elem is not None:
            gw_elem = details_elem.find(DOV_BORING_GROUNDWATER_TAG)
            water_depth = float_value(gw_elem, DOV_BORING_GROUNDWATER_DEPTH_TAG)
            if water_depth is not None:
                borehole.water_table_depth_m = water_depth

        self.success(
            f"DOV boring parsed: '{borehole.name}' "
            f"({len(drill_segments)} drill segments, {len(field_log)} field-log rows, "
            f"{len(issues)} issue(s))"
        )
        return BoreholeParseResult(
            borehole=borehole,
            drill_segments=drill_segments,
            field_log=field_log,
            issues=issues,
        )

    # ------------------------------------------------------------------
    # Header
    # ------------------------------------------------------------------

    def _parse_header(
        self, boring_elem: ET.Element, name: str, issues: list[ValidationIssue]
    ) -> Borehole:
        """Build a Borehole entity from the XML header (no <details> children).

        Coordinates and elevation come from ``<ligging>/<gml:Point>/<gml:pos>``;
        when missing or unparseable, an ``ERROR`` ``NO_COORDINATES`` issue is
        emitted and we substitute zeros so the entity can still be constructed
        — the orchestrator will refuse to persist a row whose coordinates are
        invalid, mirroring the CPT NO_COORDINATES rejection path.
        """
        bore_name = text(boring_elem, DOV_BORING_NAME_TAG) or name

        x, y, z = self._parse_location(boring_elem, name, issues)

        municipality = text(boring_elem, DOV_BORING_MUNICIPALITY_TAG) or None
        total_depth = float_value(boring_elem, DOV_BORING_TOTAL_DEPTH_TAG)
        if total_depth is None:
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "NO_TOTAL_DEPTH",
                    f"DOV boring '{name}': missing <{DOV_BORING_TOTAL_DEPTH_TAG}>",
                )
            )

        start_date = date_iso(boring_elem, DOV_BORING_START_DATE_TAG)
        # `doel` = drilling purpose. Free-text source-vocabulary string passed
        # through unchanged. DOV examples: "Geotechnisch onderzoek" =
        # geotechnical investigation, "Geologisch onderzoek" = geological,
        # "Hydrogeologisch onderzoek" = hydrogeological. Translation to
        # English happens at the API/UI boundary, never at ingest
        # (CLAUDE.md "Data Integrity Rules" + reference_dov_codelists memory).
        purpose = text(boring_elem, DOV_BORING_PURPOSE_TAG) or None
        borehole_type = text(boring_elem, DOV_BORING_TYPE_TAG) or None
        executor = text(boring_elem.find(DOV_BORING_EXECUTOR_PARENT_TAG), "naam") or None

        # x and y are always non-None when we reach this line — _parse_location
        # substitutes zeros and issues NO_COORDINATES when the source omits
        # them, so Borehole's NOT-NULL coords contract is upheld.
        return Borehole(
            name=bore_name,
            location_x=x or 0.0,
            location_y=y or 0.0,
            epsg=DOV_HORIZONTAL_EPSG,
            elevation_m=z,
            z_epsg=DOV_VERTICAL_EPSG if z is not None else None,
            total_depth_m=total_depth,
            start_date=start_date,
            purpose=purpose,
            borehole_type=borehole_type,
            municipality=municipality,
            executor=executor,
        )

    def _parse_location(
        self, boring_elem: ET.Element, name: str, issues: list[ValidationIssue]
    ) -> tuple[float | None, float | None, float | None]:
        """Extract X, Y, Z from ``<ligging>/<gml:Point>/<gml:pos>``.

        Five different ways to fail the X/Y parse — missing ``<ligging>``,
        missing ``<gml:Point>``, empty ``<gml:pos>``, fewer than two
        components, non-numeric components — all share the same outcome (log
        WARNING + emit NO_COORDINATES ERROR issue + return ``(None, None, None)``)
        so they're funneled through the ``_no_coords`` helper.

        Z (surface elevation) handling
        ------------------------------
        Z is **not optional** for a unified ground model. Borehole depths are
        measured from the ground surface, so two boreholes' "5 m" layers can
        only be related to each other in absolute elevation if both have a
        surface Z. Without it, cross-borehole layer correlation, profile
        sections, and the eventual auto-soil-profiling pass cannot operate on
        the row.

        We still allow Z to be ``None`` at the entity layer because legacy
        and partial sources do omit it — but we emit a WARNING ``NO_ELEVATION``
        validation issue so the gap is visible in the import report. The
        orchestrator (Phase C) gets one chance to fill Z from a fallback
        source (Boringen WFS row's ``Z_mTAW`` column, project default,
        manual entry) before deciding whether to persist the row.

        Two failure modes for Z, both flagged the same way:
        * ``<gml:pos>`` has only two components — Z absent.
        * ``<gml:pos>`` has three components but the third isn't numeric.

        DOV's gml:Point advertises EPSG:6190 (Belgian-specific code) but the
        numeric values match Lambert 72 (EPSG:31370). We treat them as 31370 —
        confirmed via the matching WFS Boringen row's X_mL72 / Y_mL72 columns.
        """
        loc = parse_gml_point_location(boring_elem, DOV_BORING_LOCATION_TAG)
        if loc.failure_detail is not None:
            return self._no_coords(name, loc.failure_detail, issues)
        x, y = loc.x, loc.y
        # parse_gml_point_location guarantees x/y non-None on success;
        # these assertions document the invariant for mypy + the reader.
        assert x is not None and y is not None  # noqa: S101

        z = loc.z
        if loc.z_non_numeric is not None:
            self.warning(
                f"DOV boring '{name}': <gml:pos> Z component non-numeric: {loc.z_non_numeric!r}"
            )
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "NO_ELEVATION",
                    f"DOV boring '{name}': <gml:pos> Z component non-numeric: "
                    f"{loc.z_non_numeric!r}",
                )
            )
        elif z is None:
            # X/Y only — surface elevation absent. Cross-borehole layer
            # correlation needs Z, so flag it for the import report. The
            # orchestrator (Phase C) can fill from the WFS Z_mTAW column.
            self.warning(f"DOV boring '{name}': <gml:pos> has no Z component")
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "NO_ELEVATION",
                    f"DOV boring '{name}': <gml:pos> has no Z component "
                    f"({loc.n_components} component(s))",
                )
            )

        if x == 0.0 and y == 0.0:
            issues.append(
                _issue(
                    ValidationLevel.ERROR,
                    "ZERO_COORDINATES",
                    f"DOV boring '{name}': X and Y both 0.0 — null-island artefact",
                )
            )
        else:
            # DOV positions are Belgian Lambert 72 (EPSG:31370). Flag a position
            # that falls outside Belgium's coverage — a swapped X/Y or a foreign
            # coordinate — as a WARNING, never a refusal.
            bounds_issue = make_crs_bounds_issue(
                DOV_HORIZONTAL_EPSG, x, y, prefix=f"DOV boring '{name}'"
            )
            if bounds_issue is not None:
                self.debug(f"DOV boring '{name}': {bounds_issue.message}")
                issues.append(bounds_issue)
        return x, y, z

    def _no_coords(
        self, name: str, detail: str, issues: list[ValidationIssue]
    ) -> tuple[None, None, None]:
        """Emit a NO_COORDINATES error issue and return all-None coords.

        Helper for ``_parse_location`` — every coord-extraction failure mode
        emits the same WARNING log + NO_COORDINATES ERROR issue + returns
        ``(None, None, None)``, so collapsing the 4-line repeat into a named
        helper kills the original copy-paste smell and lets each early-return
        read as a single intent line at the call site.

        Parameters
        ----------
        name : str
            Borehole identifier used in log + issue messages.
        detail : str
            Failure-specific tail of the message (e.g. "missing <gml:pos>").
        issues : list[ValidationIssue]
            The active issue list — appended to in place so the caller's
            collection picks up the new entry.
        """
        full_msg = f"DOV boring '{name}': {detail}"
        self.warning(full_msg)
        issues.append(_issue(ValidationLevel.ERROR, "NO_COORDINATES", full_msg))
        return None, None, None

    # ------------------------------------------------------------------
    # Drill segments
    # ------------------------------------------------------------------

    def _parse_drill_segments(
        self,
        details_elem: ET.Element | None,
        name: str,
        issues: list[ValidationIssue],
    ) -> list[DrillSegment]:
        """Build the per-interval drill-method list from ``<details>/<boormethode>``.

        Each ``<boormethode>`` element carries ``<van>`` (top), ``<tot>``
        (base), and ``<methode>`` (the source-vocabulary technique token —
        "spade", "edelmanboring", "kerboor", ...). Malformed intervals
        (top >= base, top < 0, or empty method) are skipped with a
        ``WARNING`` ``INVALID_INTERVAL`` issue rather than rejected — keeps
        the borehole importable even when one row of the source is suspect.
        """
        if details_elem is None:
            issues.append(
                _issue(
                    ValidationLevel.INFO,
                    "NO_DETAILS",
                    f"DOV boring '{name}': missing <{DOV_BORING_DETAILS_TAG}> element",
                )
            )
            return []

        segments: list[DrillSegment] = []
        for elem in details_elem.findall(DOV_BORING_DRILL_SEGMENT_TAG):
            top = float_value(elem, DOV_BORING_VAN_TAG)
            base = float_value(elem, DOV_BORING_TOT_TAG)
            method = text(elem, DOV_BORING_DRILL_METHOD_TAG)
            if top is None or base is None or not method:
                self.warning(
                    f"DOV boring '{name}': skipping incomplete <{DOV_BORING_DRILL_SEGMENT_TAG}> "
                    f"top={top} base={base} method={method!r}"
                )
                issues.append(
                    _issue(
                        ValidationLevel.WARNING,
                        "INCOMPLETE_DRILL_SEGMENT",
                        f"DOV boring '{name}': drill segment with missing field "
                        f"(van={top}, tot={base}, methode={method!r})",
                    )
                )
                continue
            # Cross-field pre-check (debt #15 — invariant lives in the
            # parser per Data Integrity §5, not in the dataclass).
            if base <= top:
                self.warning(
                    f"DOV boring '{name}': drill segment with inverted "
                    f"interval base={base} <= top={top} — skipping"
                )
                issues.append(
                    _issue(
                        ValidationLevel.WARNING,
                        "INVALID_INTERVAL",
                        f"DOV boring '{name}': drill segment {top}–{base}m: "
                        f"base must be greater than top",
                    )
                )
                continue
            try:
                segments.append(DrillSegment(top_m=top, base_m=base, method=method))
                self.trace(f"DOV boring '{name}': drill segment {top}–{base} m method={method!r}")
            except ValueError as exc:
                # Remaining single-field guards (negativity, empty
                # method) still raise from the dataclass; catch those.
                self.warning(
                    f"DOV boring '{name}': invalid drill segment {top}–{base} {method!r}: {exc}"
                )
                issues.append(
                    _issue(
                        ValidationLevel.WARNING,
                        "INVALID_INTERVAL",
                        f"DOV boring '{name}': drill segment {top}–{base}m: {exc}",
                    )
                )
        return segments

    # ------------------------------------------------------------------
    # Field log — color, moisture, consistency intervals
    # ------------------------------------------------------------------

    def _parse_field_log(
        self,
        details_elem: ET.Element | None,
        name: str,
        issues: list[ValidationIssue],
    ) -> list[FieldLogInterval]:
        """Build the field-log interval list from ``<details>``.

        Iterates ``<kleur>``, ``<vochtgehalte>``, and ``<consistentie>``
        (each repeated) and converts them to ``FieldLogInterval``. The wrapper
        and value tags share the same name in DOV's schema —
        ``<kleur><kleur>groenbruin</kleur></kleur>`` — so we look the value up
        with the same string we used for the wrapper.

        Mixed kinds in one return list — discriminated by ``kind``. Empty
        return for a valid borehole with no field log is fine and not flagged.
        """
        if details_elem is None:
            return []

        intervals: list[FieldLogInterval] = []
        for tag, kind in DOV_BORING_FIELD_LOG_TAGS.items():
            for elem in details_elem.findall(tag):
                top = float_value(elem, DOV_BORING_VAN_TAG)
                base = float_value(elem, DOV_BORING_TOT_TAG)
                # The value child shares the wrapper's name (DOV schema quirk).
                value = text(elem, tag)
                if top is None or base is None or not value:
                    self.warning(
                        f"DOV boring '{name}': skipping incomplete <{tag}> "
                        f"top={top} base={base} value={value!r}"
                    )
                    issues.append(
                        _issue(
                            ValidationLevel.WARNING,
                            "INCOMPLETE_FIELD_LOG",
                            f"DOV boring '{name}': {kind.value} interval with "
                            f"missing field (van={top}, tot={base}, value={value!r})",
                        )
                    )
                    continue
                # Cross-field pre-check (debt #15).
                if base <= top:
                    self.warning(
                        f"DOV boring '{name}': {kind.value} interval with "
                        f"inverted bounds base={base} <= top={top} — skipping"
                    )
                    issues.append(
                        _issue(
                            ValidationLevel.WARNING,
                            "INVALID_INTERVAL",
                            f"DOV boring '{name}': {kind.value} {top}–{base}m: "
                            f"base must be greater than top",
                        )
                    )
                    continue
                try:
                    intervals.append(
                        FieldLogInterval(top_m=top, base_m=base, kind=kind, value=value)
                    )
                    self.trace(f"DOV boring '{name}': {kind.value} {top}–{base} m = {value!r}")
                except ValueError as exc:
                    self.warning(
                        f"DOV boring '{name}': invalid {kind.value} interval {top}–{base}: {exc}"
                    )
                    issues.append(
                        _issue(
                            ValidationLevel.WARNING,
                            "INVALID_INTERVAL",
                            f"DOV boring '{name}': {kind.value} {top}–{base}m: {exc}",
                        )
                    )
        return intervals


# Re-export for static analysis / type checkers — FieldLogKind is referenced
# only via DOV_BORING_FIELD_LOG_TAGS values.
__all__ = ["DovBoringParser", "FieldLogKind"]
