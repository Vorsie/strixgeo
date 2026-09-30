"""Where a Reset to DOV finds a borehole's DOV XML (owner 2026-09-30).

The bbox import caches each boring XML under its BORING permkey, but a stored
borehole only knows its boornummer (``test_id``); the permkey is not kept on
the row. The boring XML names its boornummer in ``<identificatie>``, so the
source finds the file by that. Interpretations are cached under the permkey
each observation keeps (``dov_permkey``) - a direct hit.
"""

from __future__ import annotations

from pathlib import Path

from groundmodel.infrastructure.parsers.borehole.dov.cached_dov_track_source import (
    CachedDovTrackSource,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache


def _boring(boornummer: str, permkey: str) -> bytes:
    """A minimal boring XML naming ``boornummer``."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<ns4:dov-schema xmlns:ns4="http://kern.schemas.dov.vlaanderen.be"><boring>'
        f"<identificatie>{boornummer}</identificatie>"
        f"<dataidentifier><permkey>{permkey}</permkey></dataidentifier>"
        "</boring></ns4:dov-schema>"
    ).encode()


def _source(tmp_path: Path) -> CachedDovTrackSource:
    """A source over two fresh cache directories."""
    return CachedDovTrackSource(
        boring_cache=DovXmlCache(tmp_path / "boring"),
        interpretation_cache=DovXmlCache(tmp_path / "interpretatie"),
    )


def test_the_boring_xml_is_found_by_the_boornummer_it_names(tmp_path: Path) -> None:
    """Two borings cached under their permkeys; the one naming B250 is returned."""
    src = _source(tmp_path)
    DovXmlCache(tmp_path / "boring").put("2001-000249", _boring("kb7d15w-B249", "2001-000249"))
    DovXmlCache(tmp_path / "boring").put("2001-000250", _boring("kb7d15w-B250", "2001-000250"))

    xml = src.boring_xml("kb7d15w-B250")

    assert xml is not None
    assert b"<permkey>2001-000250</permkey>" in xml


def test_a_boornummer_that_is_only_a_prefix_of_another_does_not_match(tmp_path: Path) -> None:
    """B25 must not pick up B250's file: the whole identificatie is compared."""
    src = _source(tmp_path)
    DovXmlCache(tmp_path / "boring").put("2001-000250", _boring("kb7d15w-B250", "2001-000250"))

    assert src.boring_xml("kb7d15w-B25") is None


def test_no_cached_boring_for_the_boornummer_answers_none(tmp_path: Path) -> None:
    """An XML-file import never went through the cache: nothing to find."""
    assert _source(tmp_path).boring_xml("kb7d15w-B250") is None


def test_an_interpretation_is_read_by_its_permkey(tmp_path: Path) -> None:
    """The observation's dov_permkey IS the interpretation cache key."""
    src = _source(tmp_path)
    DovXmlCache(tmp_path / "interpretatie").put("2001-184773", b"<x/>")

    assert src.interpretation_xml("2001-184773") == b"<x/>"
    assert src.interpretation_xml("2001-184774") is None
