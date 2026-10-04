"""DOV XML of one borehole, and a fake cache, shared by the track unit tests.

The borehole ``kb7d15w-B250``: a coded lithology (FZ 0-2, MZ 2-4 with a gravel
admixture) and a boring with a colour log (bruin 0-2, grijs 2-4) and a moisture
log (vochtig 0-4). Used by the Reset-to-DOV tests and by the undo-of-the-first-
edit tests (owner dogfeed 2026-10-01), which compare a track with what DOV
published.
"""

from __future__ import annotations

from datetime import UTC, datetime

BOORNUMMER = "kb7d15w-B250"
CODED_PERMKEY = "2001-184773"
EDITED = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)

_NS = "http://kern.schemas.dov.vlaanderen.be"

# The coded lithology DOV published: FZ 0-2, MZ 2-4 with a gravel admixture.
CODED_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}">
  <interpretaties>
    <gecodeerdelithologie>
      <boring>{BOORNUMMER}</boring>
      <dataidentifier><permkey>{CODED_PERMKEY}</permkey></dataidentifier>
      <datum>2001-10-18</datum>
      <betrouwbaarheid>goed</betrouwbaarheid>
      <laag><van>0.00</van><tot>2.00</tot><kleur>bruingrijs</kleur>
        <hoofdnaam><grondsoort>FZ</grondsoort></hoofdnaam></laag>
      <laag><van>2.00</van><tot>4.00</tot><kleur>bruingrijs</kleur>
        <hoofdnaam><grondsoort>MZ</grondsoort></hoofdnaam>
        <bijmenging><plaatselijk>false</plaatselijk><hoeveelheid>N</hoeveelheid>
          <grondsoort>FG</grondsoort></bijmenging></laag>
    </gecodeerdelithologie>
  </interpretaties>
</ns4:dov-schema>""".encode()

# The boring DOV published: a colour log 0-2 / 2-4 and a moisture log 0-4.
BORING_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="http://www.opengis.net/gml/3.2">
  <boring>
    <identificatie>{BOORNUMMER}</identificatie>
    <dataidentifier><permkey>2001-000250</permkey></dataidentifier>
    <ligging><gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
      <gml:pos>150000.0 200000.0 10.0</gml:pos></gml:Point></ligging>
    <diepte_tot>4.00</diepte_tot>
    <details>
      <kleur><van>0.00</van><tot>2.00</tot><kleur>bruin</kleur></kleur>
      <kleur><van>2.00</van><tot>4.00</tot><kleur>grijs</kleur></kleur>
      <vochtgehalte><van>0.00</van><tot>4.00</tot><vochtgehalte>vochtig</vochtgehalte></vochtgehalte>
    </details>
  </boring>
</ns4:dov-schema>""".encode()


class FakeDovSource:
    """The DOV XML cache as the reset sees it: boring by boornummer, interpretation by permkey."""

    def __init__(self, borings: dict[str, bytes], interpretations: dict[str, bytes]) -> None:
        """Hold the XMLs the fake 'cache' knows."""
        self.borings = borings
        self.interpretations = interpretations

    def boring_xml(self, boornummer: str) -> bytes | None:
        """Return the cached boring XML of ``boornummer``, or None."""
        return self.borings.get(boornummer)

    def interpretation_xml(self, permkey: str) -> bytes | None:
        """Return the cached interpretation XML of ``permkey``, or None."""
        return self.interpretations.get(permkey)


def full_source() -> FakeDovSource:
    """A cache holding every XML of the borehole."""
    return FakeDovSource({BOORNUMMER: BORING_XML}, {CODED_PERMKEY: CODED_XML})
