"""Unit tests for DovInterpretationParser — DOV interpretation XML → Observation.

Fixtures mirror the three real DOV layer sub-shapes verified live 2026-05-08:

* Lithology (gecodeerde_lithologie permkey 2001-046845): kleur + hoofdnaam[]
  + bijmenging[].
* Free-text (lithologische_beschrijving permkey 2016-252398): single
  beschrijving per layer.
* Stratigraphy (formele_stratigrafie permkey 1990-002744): lid1 + relatie +
  lid2 + per-layer betrouwbaarheid.

Caller-supplied parameters:
* borehole_id — UUID, required keyword arg.
* observation_type — ObservationType enum, required keyword arg.

Both checked across the test cases.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest

from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser import (
    DovInterpretationParser,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError

_NS = "http://kern.schemas.dov.vlaanderen.be"


def _xml(
    *,
    inner_tag: str = "gecodeerdelithologie",
    boring: str = "kb13d23w-B2",
    permkey: str = "2025-200001",
    author_surname: str = "De Ceukelaire",
    author_first_name: str = "Marleen",
    organisation: str = "Universiteit Gent",
    datum: str = "2001-05-14",
    betrouwbaarheid: str = "goed",
    quality_categorie: str = "matig",
    quality_drill_method: str = "Laag",
    laag_xml: str = "",
    omit_kwaliteit: bool = False,
    omit_auteur: bool = False,
) -> bytes:
    """Build a DOV interpretation XML matching the real schema for testing.

    Parameters
    ----------
    inner_tag : str
        The element name inside ``<interpretaties>``. Default matches
        gecodeerde_lithologie XML; tests can override for stratigraphy /
        free-text flavours.
    laag_xml : str
        Inner XML for ``<laag>`` rows. Use the helpers
        ``_lithology_laag`` / ``_freetext_laag`` / ``_stratigraphy_laag``.
    """
    auteur_xml = (
        ""
        if omit_auteur
        else f"""
            <auteur>
                <persoon>
                    <naam>{author_surname}</naam>
                    <voornaam>{author_first_name}</voornaam>
                </persoon>
                <bedrijf-dienst>
                    <naam>{organisation}</naam>
                </bedrijf-dienst>
            </auteur>
        """
    )
    kwaliteit_xml = (
        ""
        if omit_kwaliteit
        else f"""
            <kwaliteit>
                <categorie>{quality_categorie}</categorie>
                <geschiktheid_boormethode>{quality_drill_method}</geschiktheid_boormethode>
            </kwaliteit>
        """
    )

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}">
  <interpretaties>
    <{inner_tag}>
      <boring>{boring}</boring>
      <dataidentifier>
        <permkey>{permkey}</permkey>
      </dataidentifier>
      {auteur_xml}
      <datum>{datum}</datum>
      <betrouwbaarheid>{betrouwbaarheid}</betrouwbaarheid>
      <dataleverancier><naam>onbekend</naam></dataleverancier>
      {kwaliteit_xml}
      {laag_xml}
    </{inner_tag}>
  </interpretaties>
</ns4:dov-schema>""".encode()


def _lithology_laag(
    *,
    van: str,
    tot: str,
    kleur: str = "onbekend",
    hoofdnamen: list[str] | None = None,
    admixtures: list[tuple[str, str, bool]] | None = None,
) -> str:
    """Build a lithology-shape <laag> fragment.

    hoofdnamen is a list of grondsoort codes (DOV's <hoofdnaam> repeats for
    equally-dominant main soils). admixtures is a list of (soil_code, amount,
    locally) tuples; pass an empty list for none.
    """
    hoofdnamen = hoofdnamen or []
    admixtures = admixtures or []
    hoofd_xml = "".join(f"<hoofdnaam><grondsoort>{c}</grondsoort></hoofdnaam>" for c in hoofdnamen)
    adm_xml = "".join(
        f"<bijmenging><plaatselijk>{'true' if loc else 'false'}</plaatselijk>"
        f"<hoeveelheid>{amt}</hoeveelheid><grondsoort>{code}</grondsoort></bijmenging>"
        for code, amt, loc in admixtures
    )
    return (
        f"<laag><van>{van}</van><tot>{tot}</tot><kleur>{kleur}</kleur>{hoofd_xml}{adm_xml}</laag>"
    )


def _freetext_laag(*, van: str, tot: str, beschrijving: str) -> str:
    """Build a free-text <laag> fragment (lithologische_beschrijving shape)."""
    return (
        f"<laag><van>{van}</van><tot>{tot}</tot><beschrijving>{beschrijving}</beschrijving></laag>"
    )


def _stratigraphy_laag(
    *,
    van: str,
    tot: str,
    lid1: str,
    lid2: str = "",
    relatie: str = "",
    betrouwbaarheid: str = "",
) -> str:
    """Build a stratigraphy <laag> fragment (formele/informele/quartaire/hydrogeo)."""
    lid2_xml = f"<lid2>{lid2}</lid2>" if lid2 else ""
    rel_xml = f"<relatie_lid1_lid2>{relatie}</relatie_lid1_lid2>" if relatie else ""
    bet_xml = f"<betrouwbaarheid>{betrouwbaarheid}</betrouwbaarheid>" if betrouwbaarheid else ""
    return (
        f"<laag><van>{van}</van><tot>{tot}</tot>"
        f"<lid1>{lid1}</lid1>{rel_xml}{lid2_xml}{bet_xml}</laag>"
    )


# ---------------------------------------------------------------------------
# Header parsing
# ---------------------------------------------------------------------------


class TestHeaderParsing:
    def test_full_header(self) -> None:
        bh = uuid4()
        result = DovInterpretationParser().parse(
            _xml(),
            borehole_id=bh,
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        obs = result.observation
        assert obs.borehole_id == bh
        assert obs.observation_type is ObservationType.CODED_LITHOLOGY
        assert obs.author == "De Ceukelaire, Marleen (Universiteit Gent)"
        assert obs.observation_date == date(2001, 5, 14)
        assert obs.reliability == "goed"
        assert obs.score_category == "matig"
        assert obs.drill_method_score == "Laag"

    def test_no_kwaliteit_block(self) -> None:
        result = DovInterpretationParser().parse(
            _xml(omit_kwaliteit=True),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert result.observation.score_category is None
        assert result.observation.drill_method_score is None
        assert result.has_errors is False

    def test_author_organisation_only(self) -> None:
        # Some DOV interpretations ship just the organisation, no person.
        result = DovInterpretationParser().parse(
            _xml(author_surname="", author_first_name="", organisation="MVG - ANRE"),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert result.observation.author == "MVG - ANRE"

    def test_no_auteur_block(self) -> None:
        result = DovInterpretationParser().parse(
            _xml(omit_auteur=True),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert result.observation.author is None


# ---------------------------------------------------------------------------
# Lithology layers — kleur + hoofdnaam[] + bijmenging[]
# ---------------------------------------------------------------------------


class TestLithologyLayers:
    def test_single_lithology_layer(self) -> None:
        laag = _lithology_laag(van="0.00", tot="4.00", hoofdnamen=["LE"])
        result = DovInterpretationParser().parse(
            _xml(laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert len(result.observation.layers) == 1
        layer = result.observation.layers[0]
        assert layer.top_m == pytest.approx(0.00)
        assert layer.base_m == pytest.approx(4.00)
        assert layer.color == "onbekend"
        assert layer.main_soil_codes == ["LE"]
        assert layer.admixtures == []
        assert layer.description is None
        assert layer.layer_index == 0

    def test_multiple_main_soils_for_one_layer(self) -> None:
        # Real DOV permkey 2001-046845 has a layer with both XZ and KL.
        laag = _lithology_laag(van="16.00", tot="18.00", hoofdnamen=["XZ", "KL"])
        result = DovInterpretationParser().parse(
            _xml(laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert result.observation.layers[0].main_soil_codes == ["XZ", "KL"]

    def test_admixtures_attached_with_locally_flag(self) -> None:
        laag = _lithology_laag(
            van="0.00",
            tot="4.00",
            hoofdnamen=["FZ"],
            admixtures=[("GL", "M", False), ("KA", "Z", True)],
        )
        result = DovInterpretationParser().parse(
            _xml(laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        layer = result.observation.layers[0]
        assert len(layer.admixtures) == 2
        by_code = {a.soil_code: a for a in layer.admixtures}
        assert by_code["GL"].amount == "M"
        assert by_code["GL"].locally is False
        assert by_code["KA"].amount == "Z"
        assert by_code["KA"].locally is True

    def test_layer_index_preserves_source_order(self) -> None:
        laag = (
            _lithology_laag(van="0.00", tot="4.00", hoofdnamen=["LE"])
            + _lithology_laag(van="4.00", tot="8.00", hoofdnamen=["FZ"])
            + _lithology_laag(van="8.00", tot="10.00", hoofdnamen=["KL"])
        )
        result = DovInterpretationParser().parse(
            _xml(laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert [layer.layer_index for layer in result.observation.layers] == [0, 1, 2]
        assert [layer.main_soil_codes[0] for layer in result.observation.layers] == [
            "LE",
            "FZ",
            "KL",
        ]


# ---------------------------------------------------------------------------
# Free-text layers — beschrijving only
# ---------------------------------------------------------------------------


class TestFreeTextLayers:
    def test_freetext_layer(self) -> None:
        laag = _freetext_laag(van="0.00", tot="1.00", beschrijving="Donker bruin humeus zand")
        result = DovInterpretationParser().parse(
            _xml(inner_tag="lithologischebeschrijving", laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.LITHOLOGICAL_DESCRIPTION,
        )
        layer = result.observation.layers[0]
        assert layer.description == "Donker bruin humeus zand"
        assert layer.main_soil_codes == []
        assert layer.color is None
        assert layer.admixtures == []

    def test_observation_type_drives_semantic(self) -> None:
        # The XML's inner tag matches LITHOLOGICAL_DESCRIPTION but the caller
        # passed FORMAL_STRATIGRAPHY. We trust the caller — that's the design.
        laag = _freetext_laag(van="0.00", tot="1.00", beschrijving="anything")
        result = DovInterpretationParser().parse(
            _xml(inner_tag="lithologischebeschrijving", laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.FORMAL_STRATIGRAPHY,
        )
        assert result.observation.observation_type is ObservationType.FORMAL_STRATIGRAPHY


# ---------------------------------------------------------------------------
# Stratigraphy layers — lid1 / lid2 / relatie
# ---------------------------------------------------------------------------


class TestStratigraphyLayers:
    def test_lid1_only_layer(self) -> None:
        # DOV ships some layers with just lid1 — the formation member is
        # unambiguous and there's no relation needed. Formation codes go
        # into description ONLY (different codelist namespace from soil-type
        # codes, so main_soil_codes stays empty).
        laag = _stratigraphy_laag(van="0.00", tot="3.00", lid1="A")
        result = DovInterpretationParser().parse(
            _xml(inner_tag="formelestratigrafie", laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.FORMAL_STRATIGRAPHY,
        )
        layer = result.observation.layers[0]
        assert layer.description == "A"
        assert layer.main_soil_codes == []

    def test_lid1_lid2_with_relation_layer(self) -> None:
        # Real DOV permkey 1990-002744 has lid1=Q, relation=T, lid2=Q —
        # but lid1==lid2 collapses to a single code; let's exercise the
        # truly different members case.
        laag = _stratigraphy_laag(van="3.00", tot="8.50", lid1="HyEg", relatie="T", lid2="Eg")
        result = DovInterpretationParser().parse(
            _xml(inner_tag="formelestratigrafie", laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.FORMAL_STRATIGRAPHY,
        )
        layer = result.observation.layers[0]
        assert layer.description == "HyEg-T-Eg"
        # Formation codes don't share the soil-type-code column.
        assert layer.main_soil_codes == []

    def test_lid1_equals_lid2_collapses_in_description(self) -> None:
        # Real example from probed XML: lid1=Q, lid2=Q. Same member twice —
        # description folds to just "Q" (no point repeating).
        laag = _stratigraphy_laag(van="0.00", tot="2.25", lid1="Q", relatie="T", lid2="Q")
        result = DovInterpretationParser().parse(
            _xml(inner_tag="formelestratigrafie", laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.FORMAL_STRATIGRAPHY,
        )
        layer = result.observation.layers[0]
        assert layer.description == "Q"
        assert layer.main_soil_codes == []


# ---------------------------------------------------------------------------
# Resilience — malformed layers, no layers, fatal cases
# ---------------------------------------------------------------------------


class TestResilience:
    def test_no_layers_emits_warning(self) -> None:
        result = DovInterpretationParser().parse(
            _xml(),  # default has no laag_xml
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert result.observation.layers == []
        assert any(i.code == "NO_LAYERS" for i in result.issues)
        # NO_LAYERS is a WARNING, not an ERROR — interpretations without
        # layers still persist as headers.
        assert result.has_errors is False

    def test_invalid_interval_skipped_with_warning(self) -> None:
        # base equal to top → domain rejects.
        laag = (
            _lithology_laag(van="0.00", tot="1.00", hoofdnamen=["LE"])
            + _lithology_laag(van="1.00", tot="1.00", hoofdnamen=["FZ"])  # invalid
            + _lithology_laag(van="1.00", tot="2.00", hoofdnamen=["KL"])
        )
        result = DovInterpretationParser().parse(
            _xml(laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        # Two valid layers retained; the bad one emits a WARNING.
        assert len(result.observation.layers) == 2
        assert any(
            i.code == "INVALID_INTERVAL" and i.level == ValidationLevel.WARNING
            for i in result.issues
        )

    def test_layer_missing_van_tot_skipped(self) -> None:
        laag = (
            _lithology_laag(van="0.00", tot="1.00", hoofdnamen=["LE"])
            + "<laag><kleur>onbekend</kleur></laag>"  # no van/tot
        )
        result = DovInterpretationParser().parse(
            _xml(laag_xml=laag),
            borehole_id=uuid4(),
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert len(result.observation.layers) == 1
        assert any(i.code == "INCOMPLETE_LAYER" for i in result.issues)

    def test_unparseable_xml_raises(self) -> None:
        with pytest.raises(ParseError, match="parse error"):
            DovInterpretationParser().parse(
                b"<not>valid<xml",
                borehole_id=uuid4(),
                observation_type=ObservationType.CODED_LITHOLOGY,
            )

    def test_no_interpretaties_wrapper_raises(self) -> None:
        empty = (
            f'<?xml version="1.0"?><ns4:dov-schema xmlns:ns4="{_NS}">'
            f"<wrong-wrapper/></ns4:dov-schema>"
        ).encode()
        with pytest.raises(ParseError, match="missing <interpretaties>"):
            DovInterpretationParser().parse(
                empty,
                borehole_id=uuid4(),
                observation_type=ObservationType.CODED_LITHOLOGY,
            )

    def test_empty_interpretaties_wrapper_raises(self) -> None:
        empty = (
            f'<?xml version="1.0"?><ns4:dov-schema xmlns:ns4="{_NS}">'
            f"<interpretaties></interpretaties></ns4:dov-schema>"
        ).encode()
        with pytest.raises(ParseError, match="empty <interpretaties>"):
            DovInterpretationParser().parse(
                empty,
                borehole_id=uuid4(),
                observation_type=ObservationType.CODED_LITHOLOGY,
            )


# ---------------------------------------------------------------------------
# Caller-supplied parameters are required keyword args
# ---------------------------------------------------------------------------


class TestCallerSuppliedArgs:
    def test_borehole_id_threaded_to_observation(self) -> None:
        bh_id = uuid4()
        laag = _lithology_laag(van="0.00", tot="1.00", hoofdnamen=["LE"])
        result = DovInterpretationParser().parse(
            _xml(laag_xml=laag),
            borehole_id=bh_id,
            observation_type=ObservationType.CODED_LITHOLOGY,
        )
        assert result.observation.borehole_id == bh_id
        # Layers FK to the observation, not directly to the borehole.
        assert result.observation.layers[0].observation_id == result.observation.id

    def test_observation_type_threaded_to_observation(self) -> None:
        for obs_type in (
            ObservationType.CODED_LITHOLOGY,
            ObservationType.FORMAL_STRATIGRAPHY,
            ObservationType.HYDROGEOLOGICAL_STRATIGRAPHY,
        ):
            laag = _lithology_laag(van="0.00", tot="1.00", hoofdnamen=["LE"])
            result = DovInterpretationParser().parse(
                _xml(laag_xml=laag),
                borehole_id=uuid4(),
                observation_type=obs_type,
            )
            assert result.observation.observation_type is obs_type
