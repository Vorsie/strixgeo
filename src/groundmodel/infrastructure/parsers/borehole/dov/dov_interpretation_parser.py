"""DOV ``/data/interpretatie/{permkey}.xml`` → ``InterpretationParseResult``.

DOV publishes one XML body per interpretation, regardless of which of the
eight interpretation streams it belongs to (gecodeerde_lithologie,
geotechnische_codering, lithologische_beschrijving, informele_stratigrafie,
formele_stratigrafie, quartaire_stratigrafie, hydrogeologische_stratigrafie,
informele_hydrogeologische_stratigrafie). The wrapper element is always
``<interpretaties>`` and inside it sits exactly one stream-typed element
(e.g. ``<gecodeerdelithologie>``, ``<formelestratigrafie>``,
``<lithologischebeschrijving>``). The parser doesn't hardcode which inner
tag belongs to which stream — it grabs the first element child of
``<interpretaties>`` so a future ninth stream type can be added without code
changes here.

Three layer sub-shapes (verified live 2026-05-08)
-------------------------------------------------

1. **Lithology** — ``gecodeerde_lithologie``, ``geotechnische_codering``::

    <laag>
      <van>0.00</van><tot>4.00</tot>
      <kleur>onbekend</kleur>
      <hoofdnaam><grondsoort>LE</grondsoort></hoofdnaam>   <!-- can repeat -->
      <bijmenging>                                          <!-- can repeat -->
        <plaatselijk>false</plaatselijk>
        <hoeveelheid>M</hoeveelheid>
        <grondsoort>GL</grondsoort>
      </bijmenging>
    </laag>

2. **Free-text** — ``lithologische_beschrijving``::

    <laag>
      <van>0.00</van><tot>1.00</tot>
      <beschrijving>Donker bruin humeus zand</beschrijving>
    </laag>

3. **Stratigraphy** — ``formele/informele/quartaire/hydrogeologische_stratigrafie``::

    <laag>
      <van>0.00</van><tot>2.25</tot>
      <lid1>Q</lid1>
      <relatie_lid1_lid2>T</relatie_lid1_lid2>
      <lid2>Q</lid2>
      <betrouwbaarheid>goed</betrouwbaarheid>     <!-- per-layer reliability -->
    </laag>

How the three sub-shapes map onto the unified ObservationLayer
--------------------------------------------------------------
The domain ``ObservationLayer`` was deliberately built as a single wide
shape (CLAUDE.md "Data Integrity Rules" §5; observation_layer_orm docstring
"Single-table layout for two sub-shapes"). The parser fills whichever
fields the source provides:

* lithology layer → ``color`` + ``main_soil_codes`` (one per ``<hoofdnaam>``)
  + ``admixtures``; ``description`` empty.
* free-text layer → ``description`` only; lithology fields empty.
* stratigraphy layer → ``description`` only, built from ``lid1 + relation + lid2``
  (e.g. ``"Q-T-Q"`` or just ``"Q"``); ``main_soil_codes`` stays empty —
  formation codes (Q, HyEg, …) are a different codelist namespace from
  soil-type codes (FZ, KL, GL, …) and don't share the column.

Per-layer ``<betrouwbaarheid>`` (stratigraphy) is currently dropped — the
domain ObservationLayer has no per-layer reliability field, only the
header-level one on Observation. If per-layer reliability becomes a UI need
(e.g. badging individual layers as "low confidence"), add a column then.

Caller responsibilities
-----------------------
The parser is single-responsibility: XML in, ``InterpretationParseResult``
out. The caller (Phase C orchestrator) supplies:

* ``borehole_id`` — must be the UUID of the persisted ``Borehole`` this
  interpretation describes. The XML's ``<boring>`` element holds the
  source-side identificatie (e.g. ``"kb13d23w-B2"``); the orchestrator has
  already resolved that to a UUID by the time it calls us.
* ``observation_type`` — the ``ObservationType`` enum value. The orchestrator
  knows this because it decided which WFS layer to query. Passed in rather
  than detected from the XML inner tag because (a) the inner tag isn't
  authoritative — DOV's schema sometimes uses singular vs plural — and
  (b) the orchestrator already has it.

We sanity-log if the inner tag clearly mismatches the expected type, but
we don't reject the parse.
"""

from __future__ import annotations

from uuid import UUID

# defusedxml — guards against billion-laughs entity expansion +
# external DTD fetches that stdlib ``xml.etree.ElementTree`` is
# vulnerable to. Drop-in API replacement. See debt #12.
import defusedxml.ElementTree as ET

from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.domain.models.borehole.observation_layer import ObservationLayer
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_BORING_TOT_TAG,
    DOV_BORING_VAN_TAG,
    DOV_INTERP_ADMIXTURE_AMOUNT_TAG,
    DOV_INTERP_ADMIXTURE_LOCALLY_TAG,
    DOV_INTERP_ADMIXTURE_SOIL_CODE_TAG,
    DOV_INTERP_AUTHOR_PARENT_TAG,
    DOV_INTERP_DATE_TAG,
    DOV_INTERP_LAYER_ADMIXTURE_TAG,
    DOV_INTERP_LAYER_COLOR_TAG,
    DOV_INTERP_LAYER_DESCRIPTION_TAG,
    DOV_INTERP_LAYER_LID1_TAG,
    DOV_INTERP_LAYER_LID2_TAG,
    DOV_INTERP_LAYER_LID_RELATION_TAG,
    DOV_INTERP_LAYER_MAIN_SOIL_CODE_TAG,
    DOV_INTERP_LAYER_MAIN_SOIL_PARENT_TAG,
    DOV_INTERP_LAYER_TAG,
    DOV_INTERP_QUALITY_CATEGORY_TAG,
    DOV_INTERP_QUALITY_DRILL_METHOD_TAG,
    DOV_INTERP_QUALITY_PARENT_TAG,
    DOV_INTERP_RELIABILITY_TAG,
    DOV_INTERP_WRAPPER_TAG,
)
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result import (
    InterpretationParseResult,
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


class DovInterpretationParser(GroundModelLogger):
    """Parse a DOV interpretation XML into an ``InterpretationParseResult``.

    Single-responsibility: XML bytes + caller-supplied (borehole_id,
    observation_type) → structured ``InterpretationParseResult``. Never
    raises on borehole-level data quality issues — those become validation
    findings so the import pipeline can continue with the rest of the bbox.

    The only fatal outcomes are unparseable XML, missing ``<interpretaties>``
    wrapper, or empty ``<interpretaties>`` (no inner stream element). All
    raise ``ParseError``; the orchestrator converts that to a per-
    interpretation skip.

    Logging
    -------
    Inherits ``GroundModelLogger`` and emits at:

    * ``trace`` — per-layer extraction (one log per ``<laag>``).
    * ``debug`` — root structure / fallbacks.
    * ``info`` — phase boundaries.
    * ``warning`` — degraded but continuing (skipped malformed layer,
      mismatched inner tag, no layers at all).
    * ``error`` — terminal structural error before raising ``ParseError``.
    * ``success`` — happy-path completion with layer count.
    """

    def __init__(self) -> None:
        """Initialise with the canonical module-name logger."""
        super().__init__(__name__)

    def parse(
        self,
        xml_bytes: bytes,
        *,
        borehole_id: UUID,
        observation_type: ObservationType,
        name: str = "",
    ) -> InterpretationParseResult:
        """Parse *xml_bytes* into an ``InterpretationParseResult``.

        Parameters
        ----------
        xml_bytes : bytes
            Raw XML body fetched from
            ``/data/interpretatie/{permkey}.xml``.
        borehole_id : UUID
            UUID of the persisted ``Borehole`` this interpretation belongs
            to. Required keyword argument so callers can't accidentally
            forget to pass it (which would silently link the observation to
            the wrong row).
        observation_type : ObservationType
            Which interpretation stream this XML is from. Required keyword
            argument for the same reason.
        name : str
            Display name used in log messages (e.g. the interpretation's
            permkey or the parent borehole's identifier) so a failing parse
            is identifiable in stream-parse output.

        Returns
        -------
        InterpretationParseResult
            ``Observation`` (with layers nested) plus validation issues.

        Raises
        ------
        ParseError
            When *xml_bytes* is not parseable XML, or the document has no
            ``<interpretaties>`` wrapper, or that wrapper has no element child.
        """
        self.debug(
            f"DOV interpretation parser: parsing {name!r} ({len(xml_bytes)} bytes), "
            f"type={observation_type.value}"
        )

        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            self.error(f"DOV interpretation '{name}': XML parse error: {exc}")
            raise ParseError(f"DOV interpretation XML parse error for '{name}': {exc}") from exc

        wrapper = root.find(DOV_INTERP_WRAPPER_TAG)
        if wrapper is None:
            self.error(
                f"DOV interpretation '{name}': missing <{DOV_INTERP_WRAPPER_TAG}> "
                f"under root <{root.tag}> (children: {[c.tag for c in root]})"
            )
            raise ParseError(f"DOV interpretation '{name}': missing <{DOV_INTERP_WRAPPER_TAG}>")

        # First element child of <interpretaties> is the stream-typed wrapper.
        # We don't care which name it has — we let the caller-supplied
        # ``observation_type`` define the semantic.
        stream_elem = next(iter(wrapper), None)
        if stream_elem is None:
            self.error(f"DOV interpretation '{name}': empty <{DOV_INTERP_WRAPPER_TAG}>")
            raise ParseError(f"DOV interpretation '{name}': empty <{DOV_INTERP_WRAPPER_TAG}>")

        return self.parse_stream_element(
            stream_elem, borehole_id=borehole_id, observation_type=observation_type, name=name
        )

    def parse_stream_element(
        self,
        stream_elem: ET.Element,
        *,
        borehole_id: UUID,
        observation_type: ObservationType,
        name: str = "",
    ) -> InterpretationParseResult:
        """Parse one already-parsed stream element (e.g. ``<formelestratigrafie>``).

        The body of :meth:`parse` after the document-level checks. Split out so
        a caller holding a document with SEVERAL stream elements under one
        ``<interpretaties>`` (a DOV export saved to a local file carries every
        interpretation of every boring it holds, see ``DovBoringFileParser``)
        can parse each one. :meth:`parse` still takes only the first child,
        so the bbox import sees no change.

        Parameters
        ----------
        stream_elem : Element
            The stream-typed element from a document parsed with defusedxml.
        borehole_id : UUID
            UUID the resulting ``Observation`` is attached to.
        observation_type : ObservationType
            Which interpretation stream the element carries.
        name : str
            Log label (see :meth:`parse`).

        Returns
        -------
        InterpretationParseResult
            ``Observation`` (with layers nested) plus validation issues.
        """
        self.trace(f"DOV interpretation '{name}': stream element <{stream_elem.tag}>")

        issues: list[ValidationIssue] = []

        author = self._parse_author(stream_elem)
        observation_date = date_iso(stream_elem, DOV_INTERP_DATE_TAG)
        reliability = text(stream_elem, DOV_INTERP_RELIABILITY_TAG) or None

        quality_elem = stream_elem.find(DOV_INTERP_QUALITY_PARENT_TAG)
        score_category = text(quality_elem, DOV_INTERP_QUALITY_CATEGORY_TAG) or None
        drill_method_score = text(quality_elem, DOV_INTERP_QUALITY_DRILL_METHOD_TAG) or None

        observation = Observation(
            borehole_id=borehole_id,
            observation_type=observation_type,
            author=author,
            observation_date=observation_date,
            reliability=reliability,
            score_category=score_category,
            drill_method_score=drill_method_score,
        )

        # Pull <laag> elements and pack each into an ObservationLayer.
        observation.layers = self._parse_layers(stream_elem, observation.id, name, issues)

        if not observation.layers:
            issues.append(
                _issue(
                    ValidationLevel.WARNING,
                    "NO_LAYERS",
                    f"DOV interpretation '{name}' ({observation_type.value}): "
                    f"no <{DOV_INTERP_LAYER_TAG}> children",
                )
            )

        self.success(
            f"DOV interpretation parsed: '{name}' ({observation_type.value}, "
            f"{len(observation.layers)} layer(s), {len(issues)} issue(s))"
        )
        return InterpretationParseResult(observation=observation, issues=issues)

    # ------------------------------------------------------------------
    # Author
    # ------------------------------------------------------------------

    def _parse_author(self, stream_elem: ET.Element) -> str | None:
        """Build a flat author string from ``<auteur>/<persoon>`` + ``<bedrijf-dienst>``.

        DOV ships author as a structured tree: a person (achternaam +
        voornaam) plus an organisation. We flatten it to a single
        ``"<surname>, <first-name> (<organisation>)"`` string for storage —
        the structured original is preserved verbatim in the source-XML
        cache, so we don't lose anything by collapsing here.
        """
        author_elem = stream_elem.find(DOV_INTERP_AUTHOR_PARENT_TAG)
        if author_elem is None:
            return None

        person_elem = author_elem.find("persoon")
        surname = text(person_elem, "naam")
        first_name = text(person_elem, "voornaam")

        organisation = text(author_elem.find("bedrijf-dienst"), "naam")

        person_part = ""
        if surname and first_name:
            person_part = f"{surname}, {first_name}"
        elif surname:
            person_part = surname
        elif first_name:
            person_part = first_name

        if person_part and organisation:
            return f"{person_part} ({organisation})"
        if person_part:
            return person_part
        if organisation:
            return organisation
        return None

    # ------------------------------------------------------------------
    # Layers
    # ------------------------------------------------------------------

    def _parse_layers(
        self,
        stream_elem: ET.Element,
        observation_id: UUID,
        name: str,
        issues: list[ValidationIssue],
    ) -> list[ObservationLayer]:
        """Build the layer list from ``<laag>`` children, in source order.

        Each layer falls into one of three sub-shapes (lithology / free-text /
        stratigraphy) — we pack whichever fields are present into the
        unified ``ObservationLayer``. Malformed layers (top >= base, missing
        intervals) are skipped with a WARNING ``INVALID_INTERVAL`` issue
        rather than rejecting the entire interpretation.
        """
        layers: list[ObservationLayer] = []
        for layer_index, laag_elem in enumerate(stream_elem.findall(DOV_INTERP_LAYER_TAG)):
            top = float_value(laag_elem, DOV_BORING_VAN_TAG)
            base = float_value(laag_elem, DOV_BORING_TOT_TAG)
            if top is None or base is None:
                self.warning(
                    f"DOV interpretation '{name}' layer {layer_index}: "
                    f"missing van/tot (van={top} tot={base})"
                )
                issues.append(
                    _issue(
                        ValidationLevel.WARNING,
                        "INCOMPLETE_LAYER",
                        f"DOV interpretation '{name}' layer {layer_index}: "
                        f"missing van/tot (van={top} tot={base})",
                    )
                )
                continue

            color = text(laag_elem, DOV_INTERP_LAYER_COLOR_TAG) or None
            # main_soil_codes carries SOIL-type codes only (FZ, KL, GL, ...).
            # Stratigraphy formation codes (Q, HyEg, Eg, ...) are a different
            # codelist namespace and a different consumer concept; they live
            # only in `description` (built below). Mirrors the design
            # documented on observation_layer_orm: lithology layers populate
            # color + main_soil_codes + admixtures; stratigraphy layers
            # populate description.
            main_soil_codes = self._parse_main_soils(laag_elem)
            admixtures = self._parse_admixtures(laag_elem)
            description = self._build_description(laag_elem)

            # Cross-field pre-check (debt #15).
            if base <= top:
                self.warning(
                    f"DOV interpretation '{name}' layer {layer_index}: "
                    f"inverted interval base={base} <= top={top} — skipping"
                )
                issues.append(
                    _issue(
                        ValidationLevel.WARNING,
                        "INVALID_INTERVAL",
                        f"DOV interpretation '{name}' layer {layer_index} "
                        f"({top}–{base}m): base must be greater than top",
                    )
                )
                continue
            try:
                layer = ObservationLayer(
                    observation_id=observation_id,
                    top_m=top,
                    base_m=base,
                    color=color,
                    main_soil_codes=main_soil_codes,
                    admixtures=admixtures,
                    description=description,
                    layer_index=layer_index,
                )
            except ValueError as exc:
                self.warning(
                    f"DOV interpretation '{name}' layer {layer_index}: "
                    f"invalid layer fields {top}–{base}: {exc}"
                )
                issues.append(
                    _issue(
                        ValidationLevel.WARNING,
                        "INVALID_INTERVAL",
                        f"DOV interpretation '{name}' layer {layer_index} ({top}–{base}m): {exc}",
                    )
                )
                continue

            self.trace(
                f"DOV interpretation '{name}' layer {layer_index}: "
                f"{top}–{base} m, soils={main_soil_codes}, "
                f"description={description!r}"
            )
            layers.append(layer)
        return layers

    def _parse_main_soils(self, laag_elem: ET.Element) -> list[str]:
        """Extract ``<hoofdnaam>/<grondsoort>`` codes — repeats for equally-dominant soils."""
        codes: list[str] = []
        for hoofdnaam_elem in laag_elem.findall(DOV_INTERP_LAYER_MAIN_SOIL_PARENT_TAG):
            code = text(hoofdnaam_elem, DOV_INTERP_LAYER_MAIN_SOIL_CODE_TAG)
            if code:
                codes.append(code)
        return codes

    def _parse_admixtures(self, laag_elem: ET.Element) -> list[Admixture]:
        """Extract ``<bijmenging>`` elements as Admixture value objects.

        Empty / malformed admixtures (missing ``<grondsoort>``) are skipped
        silently — they're degenerate by definition since Admixture's domain
        invariant rejects empty soil_code, and the source-XML cache preserves
        the raw element for forensic review.
        """
        admixtures: list[Admixture] = []
        for adm_elem in laag_elem.findall(DOV_INTERP_LAYER_ADMIXTURE_TAG):
            soil_code = text(adm_elem, DOV_INTERP_ADMIXTURE_SOIL_CODE_TAG)
            if not soil_code:
                continue
            amount = text(adm_elem, DOV_INTERP_ADMIXTURE_AMOUNT_TAG)
            locally_raw = text(adm_elem, DOV_INTERP_ADMIXTURE_LOCALLY_TAG)
            # DOV ships locally as the literal "true"/"false" — case-insensitive
            # in case some sources differ. Default to False (the more common
            # case in DOV: most admixtures occur throughout the layer).
            locally = locally_raw.lower() == "true"
            admixtures.append(Admixture(soil_code=soil_code, amount=amount, locally=locally))
        return admixtures

    def _build_description(self, laag_elem: ET.Element) -> str | None:
        """Build the description string from ``<beschrijving>`` or stratigraphy fields.

        Three sources, in priority order:

        1. ``<beschrijving>`` (free-text shape) — used as-is.
        2. ``<lid1>`` / ``<relatie_lid1_lid2>`` / ``<lid2>`` (stratigraphy
           shape) — built into ``"<lid1>-<rel>-<lid2>"`` (or just ``"<lid1>"``
           when lid2 absent / equal to lid1).
        3. Neither present (lithology shape) — return None.
        """
        free_text = text(laag_elem, DOV_INTERP_LAYER_DESCRIPTION_TAG)
        if free_text:
            return free_text

        lid1 = text(laag_elem, DOV_INTERP_LAYER_LID1_TAG)
        lid2 = text(laag_elem, DOV_INTERP_LAYER_LID2_TAG)
        relation = text(laag_elem, DOV_INTERP_LAYER_LID_RELATION_TAG)

        if lid1 and lid2 and lid2 != lid1:
            if relation:
                return f"{lid1}-{relation}-{lid2}"
            return f"{lid1} / {lid2}"
        if lid1:
            return lid1
        if lid2:
            return lid2
        return None
