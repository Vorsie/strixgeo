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
from typing import Any
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
    DOV_FILE_OBSERVED_OBJECT_TAG,
    DOV_FILE_OBSERVED_OBJECT_TYPE_TAG,
    DOV_FILE_OBSERVED_SAMPLE_TYPE,
    DOV_FILE_PERMKEY_TAG,
    DOV_FILE_POSITION_META_TAG,
    DOV_FILE_RELIABILITY_TAG,
    DOV_FILE_REMARK_MAX_CHARS,
    DOV_FILE_REMARK_TAG,
    DOV_FILE_REMARK_TEXT_TAG,
    DOV_FILE_SAMPLE_ASSIGNED_BY_TAG,
    DOV_FILE_SAMPLE_COMPOSITION_TAG,
    DOV_FILE_SAMPLE_DATE_TAG,
    DOV_FILE_SAMPLE_DESCRIPTION_TAG,
    DOV_FILE_SAMPLE_DOV_AUTHORITY,
    DOV_FILE_SAMPLE_FROM_TAG,
    DOV_FILE_SAMPLE_IDENTIFIER_TAG,
    DOV_FILE_SAMPLE_INSTRUMENT_TAG,
    DOV_FILE_SAMPLE_METHOD_TAG,
    DOV_FILE_SAMPLE_PLACE_TAG,
    DOV_FILE_SAMPLE_TAG,
    DOV_FILE_SAMPLE_TIME_TAG,
    DOV_FILE_SAMPLE_TO_TAG,
    DOV_FILE_SAMPLE_TYPE_TAG,
    DOV_FILE_SAMPLED_OBJECT_NAME_TAG,
    DOV_FILE_SAMPLED_OBJECT_TAG,
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
    FLAG_INVALID_INTERVAL,
    FLAG_LITHOLOGY_GAPS_OR_OVERLAPS,
    FLAG_MULTIPLE_LITHOLOGICAL_DESCRIPTIONS,
    FLAG_NAME_FROM_ALTERNATIVE,
    FLAG_NO_FIELD_LOG,
    FLAG_NO_LITHOLOGICAL_DESCRIPTION,
    FLAG_PURPOSE_NOT_GEOTECHNICAL,
    FLAG_RELIABILITY_NOT_GOOD,
    FLAG_REMARK_PRESENT,
    FLAG_SAMPLE_OBSERVATIONS_NOT_IMPORTED,
    FLAG_SAMPLE_WITHOUT_BORING,
    FLAG_SAMPLE_WITHOUT_DEPTH,
    FLAG_SAMPLES_PRESENT,
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
from groundmodel.infrastructure.parsers.borehole.dov.dov_file_sample import DovFileSample
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser import (
    DovInterpretationParser,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import last_path_segment
from groundmodel.infrastructure.parsers.dov.dov_xml_helpers import date_iso, float_value, text
from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_OBSERVATIE_PARAMETER_TAG,
    DOV_OBSERVATIE_PARAMETERGROEP_TAG,
    DOV_OBSERVATIE_WRAPPER_TAG,
    DOV_PARAMETERGROEP_GRAIN_SIZE,
)
from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_parser import DovGrainSizeParser
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    interval_params,
    make_issue,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Signature of the per-boring flag callback the flag steps receive:
# (level, code, English message, params for the desktop catalogue).
_FlagFn = Callable[[ValidationLevel, str, str, dict[str, Any]], None]

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
        self._grain_size_parser = DovGrainSizeParser()

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
                    {
                        "file": name,
                        "count": len(orphans),
                        "tags": sorted({o.tag for o in orphans}),
                        "boring": boring_ref,
                    },
                )
            )

        self._attach_samples(root, result, name)

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

        def flag(level: ValidationLevel, code: str, message: str, params: dict[str, Any]) -> None:
            _flag(issues, display, level, code, message, params)

        if n_borings > 1:
            flag(
                ValidationLevel.INFO,
                FLAG_FILE_HOLDS_MANY_BORINGS,
                f"the file holds {n_borings} borings; each is imported as its own borehole",
                {"count": n_borings},
            )
        if alternatives:
            listed = "; ".join(f"{n} ({t or 'no type'})" for n, t in alternatives)
            flag(
                ValidationLevel.INFO,
                FLAG_NAME_FROM_ALTERNATIVE,
                f"named by its alternative name {listed}; DOV identificatie {test_id!r}",
                {
                    "alternatives": [{"name": n, "type": t or None} for n, t in alternatives],
                    "test_id": test_id,
                },
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
                        {"tag": stream.tag},
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
    # Samples
    # ------------------------------------------------------------------

    def _attach_samples(
        self, root: ET.Element, result: DovBoringFileParseResult, name: str
    ) -> None:
        """Attach every ``<monster>`` of the file to the boring it names, and flag.

        A sample names its boring in ``bemonsterdObject`` by permkey and/or
        name; the permkey wins, the name may be the identificatie or the
        alternative name. Lab observations name their sample by permkey; a
        grain-size curve is parsed with the bbox import's grain-size parser,
        any other observation is flagged (no XML parser for it yet).
        """
        sample_elems = root.findall(DOV_FILE_SAMPLE_TAG)
        if not sample_elems:
            return
        observations: dict[str, list[ET.Element]] = {}
        for obs in root.findall(DOV_OBSERVATIE_WRAPPER_TAG):
            target = obs.find(DOV_FILE_OBSERVED_OBJECT_TAG)
            kind = text(target, DOV_FILE_OBSERVED_OBJECT_TYPE_TAG).lower()
            if kind == DOV_FILE_OBSERVED_SAMPLE_TYPE:
                observations.setdefault(text(target, DOV_FILE_PERMKEY_TAG), []).append(obs)
        by_permkey = {e.permkey: e for e in result.borings if e.permkey}
        by_name = {e.test_id: e for e in result.borings} | {e.name: e for e in result.borings}
        self.info(
            f"DOV boring file {name!r}: {len(sample_elems)} sample(s), "
            f"{sum(len(v) for v in observations.values())} sample observation(s)"
        )

        linked: set[int] = set()
        total = len(sample_elems)
        for i, elem in enumerate(sample_elems, 1):
            number, permkey = _sample_identifiers(elem)
            label = number or permkey or "?"
            target = elem.find(DOV_FILE_SAMPLED_OBJECT_TAG)
            boring_permkey = text(target, DOV_FILE_PERMKEY_TAG)
            boring_name = text(target, DOV_FILE_SAMPLED_OBJECT_NAME_TAG)
            entry = by_permkey.get(boring_permkey) or by_name.get(boring_name)
            if entry is None:
                boring_ref = boring_name or boring_permkey or "?"
                self.warning(
                    f"DOV boring file {name!r} [{i}/{total}]: sample {label!r} names boring "
                    f"{boring_ref!r}, which the file does not hold; not imported"
                )
                result.issues.append(
                    make_issue(
                        ValidationLevel.WARNING,
                        FLAG_SAMPLE_WITHOUT_BORING,
                        f"{name}: sample {label!r} belongs to boring {boring_ref!r}, which is "
                        "not in this file; not imported",
                        {"file": name, "sample": label, "boring": boring_ref},
                    )
                )
                continue
            linked.add(id(entry))
            sample = self._parse_sample(elem, entry, number, permkey, label)
            if sample is None:
                continue
            self._attach_observations(
                sample, observations.pop(permkey, []) if permkey else [], entry, label
            )
            entry.samples.append(sample)
            self.debug(
                f"DOV boring file {name!r} [{i}/{total}]: sample {label!r} "
                f"{sample.depth_top_m}-{sample.depth_base_m} m -> {entry.name!r} "
                f"({len(sample.grain_sizes)} grain-size curve(s))"
            )

        for entry in result.borings:
            if id(entry) not in linked or not entry.samples:
                continue
            n_curves = sum(len(s.grain_sizes) for s in entry.samples)
            _flag(
                entry.issues,
                entry.name,
                ValidationLevel.INFO,
                FLAG_SAMPLES_PRESENT,
                f"{len(entry.samples)} sample(s) in the file, imported with the borehole "
                f"({n_curves} grain-size curve(s))",
                {"count": len(entry.samples), "grain_size": n_curves},
            )
        if observations:
            # Observations of a sample the file does not carry (or that was not
            # imported): log what they name so a mismatch is visible.
            self.warning(
                f"DOV boring file {name!r}: {sum(len(v) for v in observations.values())} "
                f"sample observation(s) name no imported sample (permkeys "
                f"{sorted(observations)}); not imported"
            )

    def _parse_sample(
        self,
        elem: ET.Element,
        entry: DovBoringFileEntry,
        number: str | None,
        permkey: str | None,
        label: str,
    ) -> DovFileSample | None:
        """Build one sample, or flag it and return None when it has no usable interval."""
        place = elem.find(DOV_FILE_SAMPLE_PLACE_TAG)
        top = float_value(place, DOV_FILE_SAMPLE_FROM_TAG)
        base = float_value(place, DOV_FILE_SAMPLE_TO_TAG)
        if top is None:
            self.warning(f"DOV boring file: sample {label!r} of {entry.name!r} has no depth")
            _flag(
                entry.issues,
                entry.name,
                ValidationLevel.WARNING,
                FLAG_SAMPLE_WITHOUT_DEPTH,
                f"sample {label!r} has no depth interval (bemonsteringsplaats); not imported",
                {"sample": label},
            )
            return None
        if base is None:
            # A spot sample: DOV writes those as top == base itself.
            base = top
        if base < top:
            self.warning(f"DOV boring file: sample {label!r} interval {top}-{base} m inverted")
            _flag(
                entry.issues,
                entry.name,
                ValidationLevel.WARNING,
                FLAG_INVALID_INTERVAL,
                f"sample {label!r} {top}-{base} m: base above top; not imported",
                interval_params("sample", top, base, "base_not_below_top"),
            )
            return None
        method = elem.find(DOV_FILE_SAMPLE_METHOD_TAG)
        return DovFileSample(
            sample_key=uuid7(),
            permkey=permkey,
            sample_number=number,
            depth_top_m=top,
            depth_base_m=base,
            description=text(elem, DOV_FILE_SAMPLE_DESCRIPTION_TAG),
            sample_type=_codelist_token(text(elem, DOV_FILE_SAMPLE_TYPE_TAG)),
            composition=text(elem, DOV_FILE_SAMPLE_COMPOSITION_TAG) or None,
            instrument=_codelist_token(text(method, DOV_FILE_SAMPLE_INSTRUMENT_TAG)),
            sampling_date=date_iso(elem.find(DOV_FILE_SAMPLE_TIME_TAG), DOV_FILE_SAMPLE_DATE_TAG),
        )

    def _attach_observations(
        self,
        sample: DovFileSample,
        observations: list[ET.Element],
        entry: DovBoringFileEntry,
        label: str,
    ) -> None:
        """Parse the sample's grain-size curves; flag every other observation."""
        skipped: list[str] = []
        for obs in observations:
            group = text(obs, DOV_OBSERVATIE_PARAMETERGROEP_TAG).strip()
            obs_permkey = _dov_identifier(obs)
            if group != DOV_PARAMETERGROEP_GRAIN_SIZE.strip():
                skipped.append(text(obs, DOV_OBSERVATIE_PARAMETER_TAG) or group or "?")
                continue
            parsed = self._grain_size_parser.parse_observation_element(
                obs, sample_id=sample.sample_key, name=f"{entry.name} sample {label}"
            )
            entry.issues.extend(parsed.issues)
            if parsed.grain_size.diameters_mm:
                sample.grain_sizes.append((obs_permkey, parsed))
        if skipped:
            _flag(
                entry.issues,
                entry.name,
                ValidationLevel.INFO,
                FLAG_SAMPLE_OBSERVATIONS_NOT_IMPORTED,
                f"sample {label!r}: {len(skipped)} lab observation(s) not imported "
                f"({', '.join(skipped)}); only grain-size curves are read from a file",
                {"sample": label, "count": len(skipped), "parameters": skipped},
            )

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
                {"purpose": purpose or None, "expected": DOV_FILE_GEOTECHNICAL_PURPOSE},
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
                {"drillmaster": master_name or None},
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
                {"method": text(elevation_meta, DOV_FILE_METHOD_TAG) or None},
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
                    {"subject": what, "reliability": reliability},
                )

        if borehole.start_date is not None and borehole.start_date > today:
            flag(
                ValidationLevel.WARNING,
                FLAG_DATE_IN_FUTURE,
                f"start date (datum_aanvang) {borehole.start_date.isoformat()} is after "
                f"today ({today.isoformat()})",
                {"date": borehole.start_date.isoformat(), "today": today.isoformat()},
            )

        start_depth = float_value(boring_elem, DOV_FILE_START_DEPTH_TAG)
        if start_depth is not None and abs(start_depth) > DOV_FILE_DEPTH_TOLERANCE_M:
            flag(
                ValidationLevel.WARNING,
                FLAG_START_DEPTH_NOT_ZERO,
                f"the boring starts at {start_depth:.2f} m (diepte_van), not at the surface",
                {"depth_m": start_depth},
            )

        if not bh_result.field_log:
            flag(
                ValidationLevel.INFO,
                FLAG_NO_FIELD_LOG,
                "no field log (colour / moisture / consistency) in <details>",
                {},
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
                {"depth_m": depth},
            )

        for remark in boring_elem.findall(DOV_FILE_REMARK_TAG):
            quoted = _WHITESPACE.sub(" ", text(remark, DOV_FILE_REMARK_TEXT_TAG)).strip()
            if not quoted:
                continue
            if len(quoted) > DOV_FILE_REMARK_MAX_CHARS:
                quoted = quoted[: DOV_FILE_REMARK_MAX_CHARS - 1].rstrip() + "…"
            flag(
                ValidationLevel.INFO, FLAG_REMARK_PRESENT, f'remark: "{quoted}"', {"remark": quoted}
            )

        for attachment in boring_elem.findall(DOV_FILE_ATTACHMENT_TAG):
            title = text(attachment, DOV_FILE_ATTACHMENT_TITLE_TAG) or None
            url = text(attachment, DOV_FILE_ATTACHMENT_URL_TAG) or None
            flag(
                ValidationLevel.INFO,
                FLAG_ATTACHMENT_PRESENT,
                f"attachment {title or 'untitled'!r}: {url or 'no url'}",
                {"title": title, "url": url},
            )

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
                {},
            )
        elif len(descriptions) > 1:
            counts = ", ".join(str(d.n_layers) for d in descriptions[1:])
            flag(
                ValidationLevel.INFO,
                FLAG_MULTIPLE_LITHOLOGICAL_DESCRIPTIONS,
                f"{len(descriptions)} lithological descriptions; the one with the most "
                f"layers ({descriptions[0].n_layers}, permkey {descriptions[0].permkey}) is "
                f"used, the others ({counts} layers) are imported as further observations",
                {
                    "count": len(descriptions),
                    "used_layers": descriptions[0].n_layers,
                    "used_permkey": descriptions[0].permkey,
                    "other_layers": [d.n_layers for d in descriptions[1:]],
                },
            )

        for interp in entry.interpretations:
            label = interp.observation_type.value.replace("_", " ")
            if interp.observation_type in DOV_FILE_STRATIGRAPHY_TYPES:
                flag(
                    ValidationLevel.INFO,
                    FLAG_STRATIGRAPHY_PRESENT,
                    f"{label} present ({interp.n_layers} layers, permkey {interp.permkey})",
                    {
                        "stream": interp.observation_type.value,
                        "layers": interp.n_layers,
                        "permkey": interp.permkey,
                    },
                )
            reliability = interp.result.observation.reliability
            if reliability and reliability != DOV_FILE_GOOD_RELIABILITY:
                flag(
                    ValidationLevel.WARNING,
                    FLAG_RELIABILITY_NOT_GOOD,
                    f"{label} (permkey {interp.permkey}) reliability (betrouwbaarheid) is "
                    f"{reliability!r}",
                    {
                        "subject": "interpretation",
                        "stream": interp.observation_type.value,
                        "permkey": interp.permkey,
                        "reliability": reliability,
                    },
                )

        primary = entry.primary_lithology
        if primary is not None:
            places = _gaps_and_overlaps(
                (layer.top_m, layer.base_m) for layer in primary.result.observation.layers
            )
            if places:
                problems = [_describe_place(p) for p in places]
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
                    {
                        "count": len(places),
                        "places": places[:DOV_FILE_MAX_LISTED_GAPS],
                        "more": max(0, len(places) - DOV_FILE_MAX_LISTED_GAPS),
                    },
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
                    {"total_m": total, "end_m": deepest, "against": "drill_segment"},
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
                    {"total_m": total, "end_m": deepest, "against": "lithological_description"},
                )


def _flag(
    issues: list[ValidationIssue],
    display: str,
    level: ValidationLevel,
    code: str,
    message: str,
    params: dict[str, Any],
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
    params : dict[str, Any]
        The message's variable parts for the desktop catalogue (the boring's
        name is NOT repeated here: the report groups flags under it).
    """
    issues.append(make_issue(level, code, f"{display}: {message}", params))


def _dov_identifier(elem: ET.Element) -> str | None:
    """Return the ``identificator`` DOV itself assigned (the permkey), or None."""
    return _sample_identifiers(elem)[1]


def _sample_identifiers(elem: ET.Element) -> tuple[str | None, str | None]:
    """Split a sample's ``identificator`` list into (own number, DOV permkey).

    DOV writes one ``identificator`` per authority: the one ``toegekend_door``
    ``DOV`` is the permkey, the first other one (``DATABEHEERDER``, a lab, ...)
    is the sample number the engineer knows.
    """
    number: str | None = None
    permkey: str | None = None
    for ident in elem.findall(DOV_FILE_SAMPLE_IDENTIFIER_TAG):
        value = text(ident, DOV_FILE_SAMPLE_IDENTIFIER_TAG)
        if not value:
            continue
        if text(ident, DOV_FILE_SAMPLE_ASSIGNED_BY_TAG) == DOV_FILE_SAMPLE_DOV_AUTHORITY:
            permkey = permkey or value
        else:
            number = number or value
    return number, permkey


def _codelist_token(value: str) -> str | None:
    """Reduce a DOV codelist URI to its token (``…/bemonsteringstype/geroerd`` -> ``geroerd``)."""
    if not value:
        return None
    return last_path_segment(value) if "/" in value else value


def _gaps_and_overlaps(intervals: Iterable[tuple[float, float]]) -> list[dict[str, Any]]:
    """List where a layer list is not continuous from the surface down.

    Parameters
    ----------
    intervals : Iterable[tuple[float, float]]
        ``(top_m, base_m)`` per layer, any order.

    Returns
    -------
    list[dict[str, Any]]
        One ``{"kind", "from_m", "to_m"}`` per place, ``kind`` one of
        ``"start"`` (the first layer starts below the surface; ``to_m`` is
        None), ``"gap"`` or ``"overlap"``; empty when continuous. Structured
        so the desktop can say it in the user's language.
    """
    ordered = sorted(intervals)
    places: list[dict[str, Any]] = []
    if ordered and ordered[0][0] > DOV_FILE_DEPTH_TOLERANCE_M:
        places.append({"kind": "start", "from_m": ordered[0][0], "to_m": None})
    for (_, base), (top, _) in zip(ordered, ordered[1:], strict=False):
        if top - base > DOV_FILE_DEPTH_TOLERANCE_M:
            places.append({"kind": "gap", "from_m": base, "to_m": top})
        elif base - top > DOV_FILE_DEPTH_TOLERANCE_M:
            places.append({"kind": "overlap", "from_m": top, "to_m": base})
    return places


def _describe_place(place: dict[str, Any]) -> str:
    """Render one ``_gaps_and_overlaps`` place as the English log / tooltip text."""
    if place["kind"] == "start":
        return f"starts at {place['from_m']:.2f} m, not at the surface"
    return f"{place['kind']} {place['from_m']:.2f} to {place['to_m']:.2f} m"
