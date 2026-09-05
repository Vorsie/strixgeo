"""DOV ``/data/observatie/{permkey}.xml`` → ``GrainSizeParseResult`` parser.

DOV publishes lab observations through the unified ``monster:observaties``
WFS layer (~7.5M rows) plus a per-observation XML body. The orchestrator
filters the WFS rows by ``parametergroep = "Onderkenningsproeven-korrelverdeling "``
(note the trailing space — it's in the source) before fetching XMLs, so
this parser only sees grain-size XMLs in normal operation.

Schema (verified live 2026-05-08, real example permkey ``2022-2618228``)
-----------------------------------------------------------------------

::

    <ns4:dov-schema>
      <observatie>                                                # = observation
        <identificator>
          <identificator>2022-2618228</identificator>
          <toegekend_door>DOV</toegekend_door>                    # = assigned by
        </identificator>
        <geobserveerd_object>                                     # = observed object
          <objecttype>monster</objecttype>                        # = sample
          <naam>19</naam>                                          # = name
          <permkey>2017-137886</permkey>
        </geobserveerd_object>
        <diepte_van>18.000</diepte_van>                           # = depth from / top
        <diepte_tot>19.000</diepte_tot>                           # = depth to / base
        <parameter>Korrelverdeling d.m.v. zeefproef</parameter>   # = "grain-size distribution by sieve test"
        <parametergroep>Onderkenningsproeven-korrelverdeling </parametergroep>
                                                                  # = "identification tests - grain distribution"
        <waarde_meetreeks>                                        # = value-series
          <meetpuntparameter>Diameter</meetpuntparameter>         # = measurement-point parameter
          <meetpuntparameter_eenheid>mm</meetpuntparameter_eenheid>
          <meetwaardeparameter>Fractie met grotere diameter</meetwaardeparameter>
                                                                  # = "fraction with larger diameter"
          <meetwaardeparameter_eenheid>%</meetwaardeparameter_eenheid>
          <meetreekswaarde>                                       # = series-value-row
            <meetwaarde_numeriek>95.0</meetwaarde_numeriek>       # measurement value (% larger), counter-intuitive XML order
            <meetpunt_numeriek>0.063</meetpunt_numeriek>          # measurement point (diameter mm)
          </meetreekswaarde>
          ...
        </waarde_meetreeks>
        <methode>Zeving</methode>                                 # = "sieving" — source-vocabulary method
        <fenomeentijd>2002-11-26</fenomeentijd>                   # = phenomenon time / test date
        <herkomst>LABO</herkomst>                                  # = origin (LABO = laboratory)
        <uitvoerder>                                              # = executor / lab
          <organisatie><naam>Aggregate Consultants BVBA</naam></organisatie>
        </uitvoerder>
        <behandeling>                                              # = pre-treatment, repeats
          <behandeling>Kalk verwijderd</behandeling>               # = "lime removed"
          <behandeling_waarde>nee</behandeling_waarde>             # = "no" (treatment value)
        </behandeling>
        <behandeling>
          <behandeling>Organisch materiaal verwijderd</behandeling>  # = "organic matter removed"
          <behandeling_waarde>nee</behandeling_waarde>
        </behandeling>
      </observatie>
    </ns4:dov-schema>

Important schema quirks
-----------------------
1. ``<meetreekswaarde>`` rows ship with ``<meetwaarde_numeriek>`` BEFORE
   ``<meetpunt_numeriek>`` — counter-intuitive but stable. We extract by
   tag name, not position, so XML order is irrelevant.
2. ``parametergroep`` has a trailing space ("Onderkenningsproeven-
   korrelverdeling ") in the source. Real, not a copy-paste error.
3. ``<behandeling>`` is doubly-nested: an outer wrapper with the same
   element name as its inner identifier child. Pattern: outer
   ``<behandeling>`` → inner ``<behandeling>Kalk verwijderd</behandeling>``
   + ``<behandeling_waarde>nee</behandeling_waarde>``.
4. ``<methode>`` carries the source-vocabulary method string verbatim
   ("Zeving", "Hydrometer", "D.m.v. Laserdiffractie", "Pipette",
   "Sedigraaf"). We pass through; translation at presentation.

What the parser does NOT do
---------------------------
* Validate the parameter or parametergroep matches grain-size — the
  orchestrator already filtered. We log a warning if ``parametergroep``
  clearly mismatches (sanity catch for accidentally-passed Atterberg /
  CaCO3 / etc. observations) but still attempt the parse.
* Reorder rows. The domain ``GrainSize`` validates strictly-ascending
  diameters; a malformed source curve emits ``INVALID_CURVE`` and the
  result's ``GrainSize`` has empty arrays so the orchestrator skips it.
* Extract ``<uitvoerder>``, ``<herkomst>``, depth interval — those are
  WFS-row metadata for the parent sample. The Sample entity already
  has them by the time we're called.
"""

from __future__ import annotations

from uuid import UUID

# defusedxml — guards against billion-laughs entity expansion +
# external DTD fetches that stdlib ``xml.etree.ElementTree`` is
# vulnerable to. Drop-in API replacement. See debt #12.
import defusedxml.ElementTree as ET

from groundmodel.domain.models.lab.grain_size import GrainSize
from groundmodel.infrastructure.parsers.dov.dov_xml_helpers import date_iso, text
from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_BEHANDELING_LIME_REMOVED,
    DOV_BEHANDELING_NO_LOWER,
    DOV_BEHANDELING_ORGANICS_REMOVED,
    DOV_BEHANDELING_YES_LOWER,
    DOV_OBSERVATIE_BEHANDELING_INNER_TAG,
    DOV_OBSERVATIE_BEHANDELING_TAG,
    DOV_OBSERVATIE_BEHANDELING_VALUE_TAG,
    DOV_OBSERVATIE_DATE_TAG,
    DOV_OBSERVATIE_DIAMETER_TAG,
    DOV_OBSERVATIE_METHODE_TAG,
    DOV_OBSERVATIE_PARAMETERGROEP_TAG,
    DOV_OBSERVATIE_PERCENTAGE_TAG,
    DOV_OBSERVATIE_SERIES_ROW_TAG,
    DOV_OBSERVATIE_SERIES_TAG,
    DOV_OBSERVATIE_WRAPPER_TAG,
    DOV_PARAMETERGROEP_GRAIN_SIZE,
)
from groundmodel.infrastructure.parsers.lab.dov.grain_size_parse_result import (
    GrainSizeParseResult,
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


class DovGrainSizeParser(GroundModelLogger):
    """Parse a DOV grain-size observation XML into a ``GrainSizeParseResult``.

    Single-responsibility: XML bytes + caller-supplied ``sample_id`` →
    structured ``GrainSizeParseResult``. Raises ``ParseError`` only on
    unparseable XML or missing ``<observatie>`` root child; all other
    issues become ``ValidationIssue`` entries on the result so the import
    pipeline can skip a malformed observation without dropping the rest.

    Logging
    -------
    Inherits ``GroundModelLogger`` and emits at:

    * ``trace`` — per-row curve point extraction.
    * ``debug`` — root structure / fallbacks / mismatch warnings.
    * ``info`` — phase boundaries (parse start).
    * ``warning`` — degraded but continuing (mismatched parametergroep,
      malformed curve point, missing method).
    * ``error`` — terminal structural error before raising ``ParseError``.
    * ``success`` — happy-path completion with curve length.
    """

    def __init__(self) -> None:
        """Initialise with the canonical module-name logger."""
        super().__init__(__name__)

    def parse(
        self,
        xml_bytes: bytes,
        *,
        sample_id: UUID,
        name: str = "",
    ) -> GrainSizeParseResult:
        """Parse *xml_bytes* into a ``GrainSizeParseResult``.

        Parameters
        ----------
        xml_bytes : bytes
            Raw XML body fetched from ``/data/observatie/{permkey}.xml``.
        sample_id : UUID
            UUID of the persisted ``Sample`` this observation belongs to.
            Required keyword argument so callers cannot accidentally
            forget it (which would silently link the curve to no sample).
        name : str
            Display name used in log messages (typically the observation's
            permkey or parameter string) for stream-parse traceability.

        Returns
        -------
        GrainSizeParseResult
            ``GrainSize`` entity (curve + metadata + pre-treatment flags)
            plus validation issues. The entity always exists; an empty
            curve + ``INVALID_CURVE`` ERROR issue indicates the source was
            unrecoverable and the orchestrator should skip persistence.

        Raises
        ------
        ParseError
            When *xml_bytes* is not parseable XML, or has no
            ``<observatie>`` child under the root.
        """
        self.debug(f"DOV grain-size parser: parsing {name!r} ({len(xml_bytes)} bytes)")

        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            self.error(f"DOV grain-size '{name}': XML parse error: {exc}")
            raise ParseError(f"DOV grain-size XML parse error for '{name}': {exc}") from exc

        observatie = root.find(DOV_OBSERVATIE_WRAPPER_TAG)
        if observatie is None:
            self.error(
                f"DOV grain-size '{name}': expected <{DOV_OBSERVATIE_WRAPPER_TAG}> "
                f"under root <{root.tag}>; children: {[c.tag for c in root]}"
            )
            raise ParseError(
                f"DOV grain-size XML for '{name}': missing <{DOV_OBSERVATIE_WRAPPER_TAG}> element"
            )

        issues: list[ValidationIssue] = []

        # Sanity: the orchestrator should have filtered by parametergroep
        # before calling us. Log a warning (not an error) if the source's
        # parametergroep doesn't match — caller might have wired the wrong
        # XML to this parser. Trailing-space dance: DOV emits the
        # canonical string with a trailing space, but we strip whitespace
        # on _text so the comparison is space-agnostic.
        observed_pg = text(observatie, DOV_OBSERVATIE_PARAMETERGROEP_TAG)
        if observed_pg and observed_pg.strip() != DOV_PARAMETERGROEP_GRAIN_SIZE.strip():
            self.warning(
                f"DOV grain-size '{name}': parametergroep mismatch — got "
                f"{observed_pg!r}, expected {DOV_PARAMETERGROEP_GRAIN_SIZE!r}"
            )
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "WRONG_PARAMETERGROEP",
                    f"DOV grain-size '{name}': parametergroep "
                    f"{observed_pg!r}, expected {DOV_PARAMETERGROEP_GRAIN_SIZE!r}",
                )
            )

        method = text(observatie, DOV_OBSERVATIE_METHODE_TAG) or None
        if method is None:
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "MISSING_METHOD",
                    f"DOV grain-size '{name}': no <{DOV_OBSERVATIE_METHODE_TAG}> element",
                )
            )

        test_date = date_iso(observatie, DOV_OBSERVATIE_DATE_TAG)
        diameters, pct_larger = self._parse_curve(observatie, name, issues)
        lime_removed, organics_removed = self._parse_treatments(observatie, name)

        # Try to construct the GrainSize entity. The domain validates length
        # parity, percentages in [0, 100], and strictly-ascending diameters;
        # any violation raises ValueError, which we convert to an
        # INVALID_CURVE issue and replace with empty arrays so the result
        # is still constructible.
        try:
            grain_size = GrainSize(
                sample_id=sample_id,
                diameters_mm=diameters,
                pct_larger=pct_larger,
                method=method,
                test_date=test_date,
                lime_removed=lime_removed,
                organics_removed=organics_removed,
            )
        except ValueError as exc:
            self.warning(f"DOV grain-size '{name}': domain validation failed: {exc}")
            issues.append(
                _issue(
                    ValidationLevel.ERROR,
                    "INVALID_CURVE",
                    f"DOV grain-size '{name}': {exc}",
                )
            )
            grain_size = GrainSize(
                sample_id=sample_id,
                diameters_mm=[],
                pct_larger=[],
                method=method,
                test_date=test_date,
                lime_removed=lime_removed,
                organics_removed=organics_removed,
            )

        self.success(
            f"DOV grain-size parsed: '{name}' "
            f"(method={method!r}, {len(grain_size.diameters_mm)} curve points, "
            f"lime_removed={lime_removed}, organics_removed={organics_removed}, "
            f"{len(issues)} issue(s))"
        )
        return GrainSizeParseResult(grain_size=grain_size, issues=issues)

    # ------------------------------------------------------------------
    # Curve extraction
    # ------------------------------------------------------------------

    def _parse_curve(
        self,
        observatie: ET.Element,
        name: str,
        issues: list[ValidationIssue],
    ) -> tuple[list[float], list[float]]:
        """Pull the (diameters_mm, pct_larger) curve out of ``<waarde_meetreeks>``.

        Returns two parallel lists in source order. Rows missing either the
        diameter or the percentage are skipped with an
        ``INCOMPLETE_CURVE_POINT`` warning. An entirely missing or empty
        ``<waarde_meetreeks>`` emits ``NO_CURVE`` and returns
        ``([], [])`` — the domain GrainSize accepts empty arrays so the
        result is still constructible.
        """
        series = observatie.find(DOV_OBSERVATIE_SERIES_TAG)
        if series is None:
            self.warning(f"DOV grain-size '{name}': missing <{DOV_OBSERVATIE_SERIES_TAG}> element")
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "NO_CURVE",
                    f"DOV grain-size '{name}': missing <{DOV_OBSERVATIE_SERIES_TAG}>",
                )
            )
            return [], []

        diameters: list[float] = []
        pct_larger: list[float] = []
        rows = series.findall(DOV_OBSERVATIE_SERIES_ROW_TAG)

        if not rows:
            self.warning(
                f"DOV grain-size '{name}': "
                f"<{DOV_OBSERVATIE_SERIES_TAG}> has no "
                f"<{DOV_OBSERVATIE_SERIES_ROW_TAG}> children"
            )
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "NO_CURVE",
                    f"DOV grain-size '{name}': empty <{DOV_OBSERVATIE_SERIES_TAG}>",
                )
            )
            return [], []

        for row_index, row in enumerate(rows):
            d_raw = text(row, DOV_OBSERVATIE_DIAMETER_TAG)
            p_raw = text(row, DOV_OBSERVATIE_PERCENTAGE_TAG)
            if not d_raw or not p_raw:
                self.warning(
                    f"DOV grain-size '{name}' row {row_index}: "
                    f"missing diameter or percentage (d={d_raw!r}, p={p_raw!r})"
                )
                issues.append(
                    _issue(
                        ValidationLevel.WARNING,
                        "INCOMPLETE_CURVE_POINT",
                        f"DOV grain-size '{name}' row {row_index}: "
                        f"diameter={d_raw!r}, percentage={p_raw!r}",
                    )
                )
                continue
            try:
                diameter = float(d_raw)
                percentage = float(p_raw)
            except ValueError:
                self.warning(
                    f"DOV grain-size '{name}' row {row_index}: "
                    f"non-numeric diameter or percentage "
                    f"(d={d_raw!r}, p={p_raw!r})"
                )
                issues.append(
                    _issue(
                        ValidationLevel.WARNING,
                        "INCOMPLETE_CURVE_POINT",
                        f"DOV grain-size '{name}' row {row_index}: "
                        f"non-numeric (d={d_raw!r}, p={p_raw!r})",
                    )
                )
                continue
            self.trace(
                f"DOV grain-size '{name}' row {row_index}: d={diameter} mm, %larger={percentage}"
            )
            diameters.append(diameter)
            pct_larger.append(percentage)

        return diameters, pct_larger

    # ------------------------------------------------------------------
    # Pre-treatment booleans
    # ------------------------------------------------------------------

    def _parse_treatments(
        self, observatie: ET.Element, name: str
    ) -> tuple[bool | None, bool | None]:
        """Map DOV <behandeling> blocks to (lime_removed, organics_removed).

        DOV's pre-treatment vocabulary is small and stable: "Kalk verwijderd"
        for lime removal, "Organisch materiaal verwijderd" for organic-matter
        removal. Each <behandeling> wrapper carries the identifier in its
        same-named inner child plus a "ja"/"nee" flag in <behandeling_waarde>.

        Unknown behandeling identifiers are logged at debug — DOV could add
        a third pre-treatment kind tomorrow and we don't want to crash, but
        we want it visible in the log for a follow-up codelist update.
        """
        lime_removed: bool | None = None
        organics_removed: bool | None = None

        for beh in observatie.findall(DOV_OBSERVATIE_BEHANDELING_TAG):
            kind = text(beh, DOV_OBSERVATIE_BEHANDELING_INNER_TAG)
            value = text(beh, DOV_OBSERVATIE_BEHANDELING_VALUE_TAG).lower()
            if not kind:
                continue

            if value == DOV_BEHANDELING_YES_LOWER:
                flag: bool | None = True
            elif value == DOV_BEHANDELING_NO_LOWER:
                flag = False
            else:
                # Unknown ja/nee variant — record as None so the consumer
                # knows the source value was unparseable, not just absent.
                self.debug(
                    f"DOV grain-size '{name}': unknown behandeling_waarde {value!r} for {kind!r}"
                )
                flag = None

            if kind == DOV_BEHANDELING_LIME_REMOVED:
                lime_removed = flag
            elif kind == DOV_BEHANDELING_ORGANICS_REMOVED:
                organics_removed = flag
            else:
                self.debug(
                    f"DOV grain-size '{name}': unknown behandeling kind {kind!r} (value={value!r})"
                )

        return lime_removed, organics_removed
