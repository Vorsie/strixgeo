"""Local DOV borehole XML file → one ``DovBoringFileEntry`` per ``<boring>``.

The DOV bbox import fetches ONE boring per request (``/data/boring/{permkey}``)
and ONE interpretation per request. A file an engineer saved from DOV (or got
from a contractor) has a different shape — same ``dov-schema`` vocabulary, but:

::

    <ns4:dov-schema>
      <boring> … </boring>                  # ONE OR SEVERAL
      <boring> … </boring>
      <interpretaties>                      # optional
        <informelestratigrafie><boring>IDENT-B1</boring> <laag>…</laag> …
        <lithologischebeschrijving><boring>IDENT-B1</boring> …
        <lithologischebeschrijving><boring>IDENT-B1</boring> …   # can repeat
      </interpretaties>
    </ns4:dov-schema>

This parser splits the file per boring, parses each ``<boring>`` with the SAME
``DovBoringParser`` the bbox import uses (``parse_boring_element``), parses
every interpretation whose ``<boring>`` names that boring with the SAME
``DovInterpretationParser`` (``parse_stream_element``), and raises a flag for
everything an engineer should look at before he trusts the boring (owner
2026-09-28: "flag everything that is weird"). Flags are ``ValidationIssue``s —
the importer NEVER refuses a boring for a flag; they are there to be read.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from datetime import date
from uuid import UUID

# defusedxml — guards against billion-laughs entity expansion + external DTD
# fetches (debt #12). A local file is as untrusted as a download.
import defusedxml.ElementTree as ET
from uuid6 import uuid7

from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_constants import (
    DOV_FILE_ALT_NAME_NAME_TAG,
    DOV_FILE_ALT_NAME_TAG,
    DOV_FILE_ALT_NAME_TYPE_TAG,
    DOV_FILE_ASSUMED_GROUNDWATER_TAG,
    DOV_FILE_ATTACHMENT_TAG,
    DOV_FILE_ATTACHMENT_TITLE_TAG,
    DOV_FILE_ATTACHMENT_URL_TAG,
    DOV_FILE_DATAIDENTIFIER_TAG,
    DOV_FILE_DEPTH_TOLERANCE_M,
    DOV_FILE_DRILLMASTER_TAG,
    DOV_FILE_ELEVATION_META_TAG,
    DOV_FILE_GEOTECHNICAL_PURPOSE,
    DOV_FILE_GOOD_RELIABILITY,
    DOV_FILE_INTERP_BORING_TAG,
    DOV_FILE_LOCATION_TAG,
    DOV_FILE_MAX_LISTED_GAPS,
    DOV_FILE_METHOD_TAG,
    DOV_FILE_NAME_TAG,
    DOV_FILE_PERMKEY_TAG,
    DOV_FILE_POSITION_META_TAG,
    DOV_FILE_RELIABILITY_TAG,
    DOV_FILE_REMARK_MAX_CHARS,
    DOV_FILE_REMARK_TAG,
    DOV_FILE_REMARK_TEXT_TAG,
    DOV_FILE_START_DEPTH_TAG,
    DOV_FILE_STRATIGRAPHY_TYPES,
    DOV_FILE_STREAM_TAGS,
    DOV_FILE_UNKNOWN_DRILLMASTER,
    FLAG_ATTACHMENT_PRESENT,
    FLAG_DATE_IN_FUTURE,
    FLAG_DEPTH_MISMATCH,
    FLAG_DRILLMASTER_UNKNOWN,
    FLAG_ELEVATION_ZERO,
    FLAG_FILE_HOLDS_MANY_BORINGS,
    FLAG_GROUNDWATER_ASSUMED,
    FLAG_INTERPRETATION_WITHOUT_BORING,
    FLAG_LITHOLOGY_GAPS_OR_OVERLAPS,
    FLAG_MULTIPLE_LITHOLOGICAL_DESCRIPTIONS,
    FLAG_NAME_FROM_ALTERNATIVE,
    FLAG_NO_FIELD_LOG,
    FLAG_NO_LITHOLOGICAL_DESCRIPTION,
    FLAG_PURPOSE_NOT_GEOTECHNICAL,
    FLAG_RELIABILITY_NOT_GOOD,
    FLAG_REMARK_PRESENT,
    FLAG_START_DEPTH_NOT_ZERO,
    FLAG_STRATIGRAPHY_PRESENT,
    FLAG_UNKNOWN_INTERPRETATION_STREAM,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_entry import (
    DovBoringFileEntry,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_parse_result import (
    DovBoringFileParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser import DovBoringParser
from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_BORING_DETAILS_TAG,
    DOV_BORING_GROUNDWATER_DEPTH_TAG,
    DOV_BORING_NAME_TAG,
    DOV_BORING_PURPOSE_TAG,
    DOV_INTERP_WRAPPER_TAG,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_file_interpretation import (
    DovFileInterpretation,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser import (
    DovInterpretationParser,
)
from groundmodel.infrastructure.parsers.dov.dov_xml_helpers import float_value, text
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    make_issue,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Signature of the per-boring flag callback the flag steps receive.
_FlagFn = Callable[[ValidationLevel, str, str], None]

# Runs of whitespace (incl. the non-breaking space DOV dossier remarks carry)
# collapse to one space when a remark is quoted.
_WHITESPACE = re.compile(r"\s+")


class DovBoringFileParser(GroundModelLogger):
    """Parse a local DOV ``dov-schema`` file into per-boring entries + flags.

    Logging
    -------
    ``info`` at the file boundary (boring / interpretation counts), ``debug``
    per boring (``[i/total]``, flag codes), ``warning`` for an interpretation
    that names no boring in the file, ``error`` before raising ``ParseError``,
    ``success`` with the totals.
    """

    def __init__(self) -> None:
        """Initialise with the canonical module-name logger and the two sub-parsers."""
        super().__init__(__name__)
        self._boring_parser = DovBoringParser()
        self._interpretation_parser = DovInterpretationParser()

    def parse(
        self, xml_bytes: bytes, name: str = "", *, today: date | None = None
    ) -> DovBoringFileParseResult:
        """Parse *xml_bytes* into one entry per ``<boring>``.

        Parameters
        ----------
        xml_bytes : bytes
            The file's raw bytes.
        name : str
            File name, for log lines and error messages.
        today : date | None
            Reference date for DATE_IN_FUTURE; ``date.today()`` when None
            (tests pin it).

        Returns
        -------
        DovBoringFileParseResult
            Per-boring entries (file order) plus file-level findings.

        Raises
        ------
        ParseError
            When the bytes are not XML or the document holds no ``<boring>``.
        """
        reference_day = today or date.today()
        self.info(f"DOV boring file: parsing {name!r} ({len(xml_bytes)} bytes)")
        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            self.error(f"DOV boring file {name!r}: XML parse error: {exc}")
            raise ParseError(f"'{name}' is not a readable XML file: {exc}") from exc

        boring_elems = root.findall("boring")
        if not boring_elems:
            self.error(
                f"DOV boring file {name!r}: no <boring> under root <{root.tag}> "
                f"(children: {[c.tag for c in root]})"
            )
            raise ParseError(
                f"'{name}' holds no DOV <boring> element; is it a DOV borehole export?"
            )

        # Interpretation stream elements grouped by the boring they name.
        wrapper = root.find(DOV_INTERP_WRAPPER_TAG)
        streams = list(wrapper) if wrapper is not None else []
        by_boring: dict[str, list[ET.Element]] = {}
        for stream in streams:
            by_boring.setdefault(text(stream, DOV_FILE_INTERP_BORING_TAG), []).append(stream)
        self.info(
            f"DOV boring file {name!r}: {len(boring_elems)} boring(s), "
            f"{len(streams)} interpretation element(s)"
        )

        result = DovBoringFileParseResult()
        total = len(boring_elems)
        for i, boring_elem in enumerate(boring_elems, 1):
            entry = self._parse_boring(
                boring_elem,
                by_boring.pop(text(boring_elem, DOV_BORING_NAME_TAG), []),
                n_borings=total,
                today=reference_day,
            )
            self.debug(
                f"DOV boring file {name!r} [{i}/{total}]: {entry.name!r} "
                f"({len(entry.interpretations)} interpretation(s)) flags="
                f"{sorted({iss.code for iss in entry.issues})}"
            )
            result.borings.append(entry)

        # Whatever is left names a boring the file does not hold — report it,
        # never drop it silently.
        for boring_ref, orphans in by_boring.items():
            tags = ", ".join(sorted({o.tag for o in orphans}))
            self.warning(
                f"DOV boring file {name!r}: {len(orphans)} interpretation(s) ({tags}) name "
                f"boring {boring_ref!r}, which the file does not hold; not imported"
            )
            result.issues.append(
                make_issue(
                    ValidationLevel.WARNING,
                    FLAG_INTERPRETATION_WITHOUT_BORING,
                    f"{name}: {len(orphans)} interpretation(s) ({tags}) belong to boring "
                    f"{boring_ref!r}, which is not in this file; not imported",
                )
            )

        n_flags = sum(len(e.issues) for e in result.borings) + len(result.issues)
        self.success(
            f"DOV boring file {name!r} parsed: {len(result.borings)} boring(s), "
            f"{n_flags} finding(s)"
        )
        return result

    # ------------------------------------------------------------------
    # One boring
    # ------------------------------------------------------------------

    def _parse_boring(
        self,
        boring_elem: ET.Element,
        stream_elems: list[ET.Element],
        *,
        n_borings: int,
        today: date,
    ) -> DovBoringFileEntry:
        """Parse one ``<boring>`` and its interpretations, then flag it."""
        test_id = text(boring_elem, DOV_BORING_NAME_TAG)
        alternatives = [
            (text(alt, DOV_FILE_ALT_NAME_NAME_TAG), text(alt, DOV_FILE_ALT_NAME_TYPE_TAG))
            for alt in boring_elem.findall(DOV_FILE_ALT_NAME_TAG)
            if text(alt, DOV_FILE_ALT_NAME_NAME_TAG)
        ]
        display = alternatives[0][0] if alternatives else test_id
        permkey = text(boring_elem.find(DOV_FILE_DATAIDENTIFIER_TAG), DOV_FILE_PERMKEY_TAG)
        borehole_key: UUID = uuid7()

        bh_result = self._boring_parser.parse_boring_element(boring_elem, display)
        # The boring parser names the borehole by identificatie; the engineer
        # knows it by the alternative name (e.g. the VO survey number).
        bh_result.borehole.name = display

        issues: list[ValidationIssue] = list(bh_result.issues)
        interpretations = self._parse_interpretations(stream_elems, display, borehole_key, issues)

        entry = DovBoringFileEntry(
            test_id=test_id,
            name=display,
            permkey=permkey or None,
            borehole_key=borehole_key,
            borehole=bh_result,
            interpretations=interpretations,
            issues=issues,
        )

        def flag(level: ValidationLevel, code: str, message: str) -> None:
            _flag(issues, display, level, code, message)

        if n_borings > 1:
            flag(
                ValidationLevel.INFO,
                FLAG_FILE_HOLDS_MANY_BORINGS,
                f"the file holds {n_borings} borings; each is imported as its own borehole",
            )
        if alternatives:
            listed = "; ".join(f"{n} ({t or 'no type'})" for n, t in alternatives)
            flag(
                ValidationLevel.INFO,
                FLAG_NAME_FROM_ALTERNATIVE,
                f"named by its alternative name {listed}; DOV identificatie {test_id!r}",
            )
        self._flag_header(boring_elem, bh_result, flag, today)
        self._flag_interpretations(entry, flag)
        self._flag_depths(entry, flag)
        return entry

    def _parse_interpretations(
        self,
        stream_elems: list[ET.Element],
        display: str,
        borehole_key: UUID,
        issues: list[ValidationIssue],
    ) -> list[DovFileInterpretation]:
        """Parse every stream element of one boring; primary description first."""
        parsed: list[DovFileInterpretation] = []
        for stream in stream_elems:
            observation_type = DOV_FILE_STREAM_TAGS.get(stream.tag)
            if observation_type is None:
                self.warning(f"DOV boring file: {display!r} unknown stream <{stream.tag}>")
                issues.append(
                    make_issue(
                        ValidationLevel.WARNING,
                        FLAG_UNKNOWN_INTERPRETATION_STREAM,
                        f"{display}: interpretation <{stream.tag}> is not a stream this "
                        "importer knows; not imported",
                    )
                )
                continue
            permkey = text(stream.find(DOV_FILE_DATAIDENTIFIER_TAG), DOV_FILE_PERMKEY_TAG)
            parse_result = self._interpretation_parser.parse_stream_element(
                stream,
                borehole_id=borehole_key,
                observation_type=observation_type,
                name=f"{display} {stream.tag} {permkey}".strip(),
            )
            issues.extend(parse_result.issues)
            parsed.append(
                DovFileInterpretation(
                    observation_type=observation_type,
                    permkey=permkey or None,
                    result=parse_result,
                )
            )

        descriptions = [
            p for p in parsed if p.observation_type == ObservationType.LITHOLOGICAL_DESCRIPTION
        ]
        if descriptions:
            # Most layers wins; on a tie the first in the file (max is stable).
            primary = max(descriptions, key=lambda d: d.n_layers)
            primary.is_primary = True
            parsed.remove(primary)
            parsed.insert(0, primary)
        return parsed

    # ------------------------------------------------------------------
    # Flags
    # ------------------------------------------------------------------

    @staticmethod
    def _flag_header(
        boring_elem: ET.Element,
        bh_result: BoreholeParseResult,
        flag: _FlagFn,
        today: date,
    ) -> None:
        """Flag the boring header: purpose, drill master, elevation, date, remarks, ..."""
        borehole = bh_result.borehole
        purpose = text(boring_elem, DOV_BORING_PURPOSE_TAG)
        if purpose != DOV_FILE_GEOTECHNICAL_PURPOSE:
            flag(
                ValidationLevel.INFO,
                FLAG_PURPOSE_NOT_GEOTECHNICAL,
                f"purpose (doel) is {purpose!r}, not {DOV_FILE_GEOTECHNICAL_PURPOSE!r}"
                if purpose
                else "no purpose (doel) given",
            )

        master = boring_elem.find(DOV_FILE_DRILLMASTER_TAG)
        master_name = text(master, DOV_FILE_NAME_TAG)
        if not master_name or master_name.lower() == DOV_FILE_UNKNOWN_DRILLMASTER:
            flag(
                ValidationLevel.INFO,
                FLAG_DRILLMASTER_UNKNOWN,
                f"drill master (boormeester) is {master_name!r}"
                if master_name
                else "no drill master (boormeester) given",
            )

        location = boring_elem.find(DOV_FILE_LOCATION_TAG)
        elevation_meta = (
            location.find(DOV_FILE_ELEVATION_META_TAG) if location is not None else None
        )
        if borehole.elevation_m == 0.0:
            method = text(elevation_meta, DOV_FILE_METHOD_TAG) or "not given"
            flag(
                ValidationLevel.WARNING,
                FLAG_ELEVATION_ZERO,
                f"ground elevation is 0.00 m TAW (method: {method!r}); kept as a real "
                "value; check it is not a placeholder",
            )
        for meta_tag, what in (
            (DOV_FILE_POSITION_META_TAG, "position"),
            (DOV_FILE_ELEVATION_META_TAG, "elevation"),
        ):
            meta = location.find(meta_tag) if location is not None else None
            reliability = text(meta, DOV_FILE_RELIABILITY_TAG)
            if reliability and reliability != DOV_FILE_GOOD_RELIABILITY:
                flag(
                    ValidationLevel.WARNING,
                    FLAG_RELIABILITY_NOT_GOOD,
                    f"{what} reliability (betrouwbaarheid) is {reliability!r}",
                )

        if borehole.start_date is not None and borehole.start_date > today:
            flag(
                ValidationLevel.WARNING,
                FLAG_DATE_IN_FUTURE,
                f"start date (datum_aanvang) {borehole.start_date.isoformat()} is after "
                f"today ({today.isoformat()})",
            )

        start_depth = float_value(boring_elem, DOV_FILE_START_DEPTH_TAG)
        if start_depth is not None and abs(start_depth) > DOV_FILE_DEPTH_TOLERANCE_M:
            flag(
                ValidationLevel.WARNING,
                FLAG_START_DEPTH_NOT_ZERO,
                f"the boring starts at {start_depth:.2f} m (diepte_van), not at the surface",
            )

        if not bh_result.field_log:
            flag(
                ValidationLevel.INFO,
                FLAG_NO_FIELD_LOG,
                "no field log (colour / moisture / consistency) in <details>",
            )

        details = boring_elem.find(DOV_BORING_DETAILS_TAG)
        for assumed in (
            details.findall(DOV_FILE_ASSUMED_GROUNDWATER_TAG) if details is not None else []
        ):
            depth = float_value(assumed, DOV_BORING_GROUNDWATER_DEPTH_TAG)
            flag(
                ValidationLevel.INFO,
                FLAG_GROUNDWATER_ASSUMED,
                f"assumed groundwater depth (aangenomengrondwaterstand) "
                f"{'not given' if depth is None else f'{depth:.2f} m'}; not imported as "
                "the water table (an assumption, not a reading)",
            )

        for remark in boring_elem.findall(DOV_FILE_REMARK_TAG):
            quoted = _WHITESPACE.sub(" ", text(remark, DOV_FILE_REMARK_TEXT_TAG)).strip()
            if not quoted:
                continue
            if len(quoted) > DOV_FILE_REMARK_MAX_CHARS:
                quoted = quoted[: DOV_FILE_REMARK_MAX_CHARS - 1].rstrip() + "…"
            flag(ValidationLevel.INFO, FLAG_REMARK_PRESENT, f'remark: "{quoted}"')

        for attachment in boring_elem.findall(DOV_FILE_ATTACHMENT_TAG):
            title = text(attachment, DOV_FILE_ATTACHMENT_TITLE_TAG) or "untitled"
            url = text(attachment, DOV_FILE_ATTACHMENT_URL_TAG) or "no url"
            flag(ValidationLevel.INFO, FLAG_ATTACHMENT_PRESENT, f"attachment {title!r}: {url}")

    @staticmethod
    def _flag_interpretations(entry: DovBoringFileEntry, flag: _FlagFn) -> None:
        """Flag the interpretations: description count, stratigraphy, reliability, gaps."""
        descriptions = [
            i
            for i in entry.interpretations
            if i.observation_type == ObservationType.LITHOLOGICAL_DESCRIPTION
        ]
        if not descriptions:
            flag(
                ValidationLevel.WARNING,
                FLAG_NO_LITHOLOGICAL_DESCRIPTION,
                "no lithological description in the file; the borehole has no layers "
                "to show or segment",
            )
        elif len(descriptions) > 1:
            counts = ", ".join(str(d.n_layers) for d in descriptions[1:])
            flag(
                ValidationLevel.INFO,
                FLAG_MULTIPLE_LITHOLOGICAL_DESCRIPTIONS,
                f"{len(descriptions)} lithological descriptions; the one with the most "
                f"layers ({descriptions[0].n_layers}, permkey {descriptions[0].permkey}) is "
                f"used, the others ({counts} layers) are imported as further observations",
            )

        for interp in entry.interpretations:
            label = interp.observation_type.value.replace("_", " ")
            if interp.observation_type in DOV_FILE_STRATIGRAPHY_TYPES:
                flag(
                    ValidationLevel.INFO,
                    FLAG_STRATIGRAPHY_PRESENT,
                    f"{label} present ({interp.n_layers} layers, permkey {interp.permkey})",
                )
            reliability = interp.result.observation.reliability
            if reliability and reliability != DOV_FILE_GOOD_RELIABILITY:
                flag(
                    ValidationLevel.WARNING,
                    FLAG_RELIABILITY_NOT_GOOD,
                    f"{label} (permkey {interp.permkey}) reliability (betrouwbaarheid) is "
                    f"{reliability!r}",
                )

        primary = entry.primary_lithology
        if primary is not None:
            problems = _gaps_and_overlaps(
                (layer.top_m, layer.base_m) for layer in primary.result.observation.layers
            )
            if problems:
                listed = "; ".join(problems[:DOV_FILE_MAX_LISTED_GAPS])
                more = (
                    f" (+{len(problems) - DOV_FILE_MAX_LISTED_GAPS} more)"
                    if len(problems) > DOV_FILE_MAX_LISTED_GAPS
                    else ""
                )
                flag(
                    ValidationLevel.WARNING,
                    FLAG_LITHOLOGY_GAPS_OR_OVERLAPS,
                    f"the used lithological description is not continuous; "
                    f"{len(problems)} place(s): {listed}{more}",
                )

    @staticmethod
    def _flag_depths(entry: DovBoringFileEntry, flag: _FlagFn) -> None:
        """Flag a total depth that disagrees with the drill segments or the description."""
        total = entry.borehole.borehole.total_depth_m
        if total is None:
            return
        segments = entry.borehole.drill_segments
        if segments:
            deepest = max(s.base_m for s in segments)
            if abs(deepest - total) > DOV_FILE_DEPTH_TOLERANCE_M:
                flag(
                    ValidationLevel.WARNING,
                    FLAG_DEPTH_MISMATCH,
                    f"total depth (diepte_tot) {total:.2f} m but the deepest drill segment "
                    f"ends at {deepest:.2f} m",
                )
        primary = entry.primary_lithology
        if primary is not None and primary.result.observation.layers:
            deepest = max(layer.base_m for layer in primary.result.observation.layers)
            if abs(deepest - total) > DOV_FILE_DEPTH_TOLERANCE_M:
                flag(
                    ValidationLevel.WARNING,
                    FLAG_DEPTH_MISMATCH,
                    f"total depth (diepte_tot) {total:.2f} m but the lithological "
                    f"description ends at {deepest:.2f} m",
                )


def _flag(
    issues: list[ValidationIssue],
    display: str,
    level: ValidationLevel,
    code: str,
    message: str,
) -> None:
    """Append one file-import flag, its message prefixed with the boring's name.

    Parameters
    ----------
    issues : list[ValidationIssue]
        The boring's issue list (appended in place).
    display : str
        The boring's display name — every flag names its boring so a flag
        list reads on its own.
    level : ValidationLevel
        INFO for "worth knowing", WARNING for "check before trusting".
    code, message : str
        Flag code and its human-readable tail.
    """
    issues.append(make_issue(level, code, f"{display}: {message}"))


def _gaps_and_overlaps(intervals: Iterable[tuple[float, float]]) -> list[str]:
    """Describe where a layer list is not continuous from the surface down.

    Parameters
    ----------
    intervals : Iterable[tuple[float, float]]
        ``(top_m, base_m)`` per layer, any order.

    Returns
    -------
    list[str]
        One human-readable entry per gap / overlap (and one when the first
        layer does not start at the surface); empty when continuous.
    """
    ordered = sorted(intervals)
    problems: list[str] = []
    if ordered and ordered[0][0] > DOV_FILE_DEPTH_TOLERANCE_M:
        problems.append(f"starts at {ordered[0][0]:.2f} m, not at the surface")
    for (_, base), (top, _) in zip(ordered, ordered[1:], strict=False):
        if top - base > DOV_FILE_DEPTH_TOLERANCE_M:
            problems.append(f"gap {base:.2f} to {top:.2f} m")
        elif base - top > DOV_FILE_DEPTH_TOLERANCE_M:
            problems.append(f"overlap {top:.2f} to {base:.2f} m")
    return problems
