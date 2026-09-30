"""Unit tests for GeosysExportReader — the kind is sniffed from CONTENT.

Proposal §3: the file name and the extension say nothing (``cd.txt`` is not
unique, ``.csv`` / ``.txt`` do not fix the delimiter, the 8.3 names truncate
the borehole). The reader looks at what the file holds: ``TRAP :`` stage
blocks → the oedometer control listing; ``#START_METINGEN`` → the newer
oedometer module's raw dump; ``Identificatiegegevens deelmonster`` +
``Meetpunt`` → the triaxial per-point dump. Anything else is refused.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.lab.geosys.geosys_constants import (
    GEOSYS_FORMAT_OED_LISTING,
    GEOSYS_FORMAT_OED_NEW_RAW,
    GEOSYS_FORMAT_TX_DUMP,
)
from groundmodel.infrastructure.parsers.lab.geosys.geosys_export_reader import (
    GeosysExportReader,
    detect_geosys_format,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.lab.geosys.triaxial_dump_result import (
    TriaxialDumpResult,
)
from groundmodel.shared.exceptions import ParseError

_LAB = Path(__file__).resolve().parents[5] / "fixtures" / "lab"


@pytest.mark.parametrize(
    ("relative", "expected"),
    [
        ("oedometer/200568B7-LstSMControleListing.txt", GEOSYS_FORMAT_OED_LISTING),
        ("oedometer/200569B7-LstSMControleListing.txt", GEOSYS_FORMAT_OED_LISTING),
        ("oedometer_new/uit_nieuwemodule.csv", GEOSYS_FORMAT_OED_NEW_RAW),
        ("triaxial/tx_cd.txt", GEOSYS_FORMAT_TX_DUMP),
        ("triaxial/advtxuutxt.txt", GEOSYS_FORMAT_TX_DUMP),
    ],
)
def test_the_kind_is_read_from_the_content(relative: str, expected: str) -> None:
    """Every real fixture is recognised by what it holds."""
    assert detect_geosys_format((_LAB / relative).read_bytes()) == expected


def test_the_extension_does_not_decide() -> None:
    """A triaxial dump renamed ``.csv`` is still a triaxial dump."""
    raw = (_LAB / "triaxial" / "tx_cu.txt").read_bytes()
    result = GeosysExportReader().read(raw, source_name="renamed.csv")
    assert isinstance(result, TriaxialDumpResult)


def test_the_reader_returns_the_matching_parse_result() -> None:
    """Oedometer exports come back as an OedometerListingResult stamped with
    their source format."""
    listing = GeosysExportReader().read(
        (_LAB / "oedometer" / "200568B7-LstSMControleListing.txt").read_bytes(), source_name="a"
    )
    new = GeosysExportReader().read(
        (_LAB / "oedometer_new" / "uit_nieuwemodule.csv").read_bytes(), source_name="b"
    )
    assert isinstance(listing, OedometerListingResult)
    assert listing.source_format == GEOSYS_FORMAT_OED_LISTING
    assert isinstance(new, OedometerListingResult)
    assert new.source_format == GEOSYS_FORMAT_OED_NEW_RAW


def test_an_unknown_file_is_refused() -> None:
    """A GEF, a results listing or random text is not a raw lab export."""
    assert detect_geosys_format(b"#GEFID= 1, 1, 0\n#COLUMN= 3\n") is None
    with pytest.raises(ParseError):
        GeosysExportReader().read(b"Trap;Druk;Dhi\n;0;0,0\n", source_name="results.txt")
