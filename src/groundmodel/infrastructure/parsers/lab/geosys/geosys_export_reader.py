"""Sniff a lab export's kind from its content and hand it to the right parser.

The file name and the extension say nothing about the kind (``cd.txt`` is not
unique; ``.csv`` / ``.txt`` do not fix the delimiter; the 8.3 names truncate
the borehole), so the reader looks at what the file holds.
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.lab.geosys.geosys_constants import (
    GEOSYS_ENCODING,
    GEOSYS_FORMAT_OED_LISTING,
    GEOSYS_FORMAT_OED_NEW_RAW,
    GEOSYS_FORMAT_TX_DUMP,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_constants import (
    OED_STAGE_HEADER_RE,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_control_listing_parser import (
    OedometerControlListingParser,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_new_constants import (
    OED_NEW_START_MARKER,
)
from groundmodel.infrastructure.parsers.lab.geosys.oedometer_new_export_parser import (
    OedometerNewExportParser,
)
from groundmodel.infrastructure.parsers.lab.geosys.triaxial_constants import (
    TX_SPECIMEN_RE,
    TX_TABLE_HEADER_LABEL,
)
from groundmodel.infrastructure.parsers.lab.geosys.triaxial_dump_result import (
    TriaxialDumpResult,
)
from groundmodel.infrastructure.parsers.lab.geosys.triaxial_raw_dump_parser import (
    TriaxialRawDumpParser,
)
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_UTF8_BOM = b"\xef\xbb\xbf"


def decode_geosys_bytes(raw: bytes) -> str:
    """Decode a lab export: UTF-8 when it carries a BOM, else ISO-8859-1.

    The old Geosys exports are ISO-8859-1 with no BOM; the newer oedometer
    module writes UTF-8 with a BOM. Latin-1 never fails to decode, so an
    unknown file still reaches the sniffer and is refused there, by content.

    Parameters
    ----------
    raw : bytes
        The file bytes.

    Returns
    -------
    str
        The decoded text (BOM removed).
    """
    if raw.startswith(_UTF8_BOM):
        return raw[len(_UTF8_BOM) :].decode("utf-8", errors="replace")
    return raw.decode(GEOSYS_ENCODING)


def detect_geosys_format(raw: bytes) -> str | None:
    """Return the export's source-format stamp, or ``None`` when unknown.

    Parameters
    ----------
    raw : bytes
        The file bytes.

    Returns
    -------
    str or None
        ``GEOSYS_FORMAT_OED_LISTING`` (a ``TRAP :`` stage block),
        ``GEOSYS_FORMAT_OED_NEW_RAW`` (``#START_METINGEN``),
        ``GEOSYS_FORMAT_TX_DUMP`` (a specimen block and a ``Meetpunt``
        table), or ``None``.
    """
    lines = decode_geosys_bytes(raw).splitlines()
    if any(line.startswith(OED_NEW_START_MARKER) for line in lines):
        return GEOSYS_FORMAT_OED_NEW_RAW
    if any(OED_STAGE_HEADER_RE.match(line) for line in lines):
        return GEOSYS_FORMAT_OED_LISTING
    has_specimen = any(TX_SPECIMEN_RE.match(line) for line in lines)
    has_table = any(line.startswith(TX_TABLE_HEADER_LABEL) for line in lines)
    if has_specimen and has_table:
        return GEOSYS_FORMAT_TX_DUMP
    return None


class GeosysExportReader(GroundModelLogger):
    """Parse any supported raw lab export, the parser chosen by content."""

    def __init__(self) -> None:
        super().__init__(__name__)

    def read(self, raw: bytes, *, source_name: str) -> OedometerListingResult | TriaxialDumpResult:
        """Sniff and parse one export.

        Parameters
        ----------
        raw : bytes
            The file bytes.
        source_name : str
            The file name (messages only; never used to pick the parser).

        Returns
        -------
        OedometerListingResult or TriaxialDumpResult
            The parse result of the matching parser.

        Raises
        ------
        ParseError
            When the content is none of the supported exports, or the
            matching parser refuses it.
        """
        fmt = detect_geosys_format(raw)
        self.info("lab export %s: %d bytes, sniffed as %s", source_name, len(raw), fmt)
        text = decode_geosys_bytes(raw)
        if fmt == GEOSYS_FORMAT_OED_LISTING:
            return OedometerControlListingParser().parse_text(text, source_name=source_name)
        if fmt == GEOSYS_FORMAT_OED_NEW_RAW:
            return OedometerNewExportParser().parse_text(text, source_name=source_name)
        if fmt == GEOSYS_FORMAT_TX_DUMP:
            return TriaxialRawDumpParser().parse_text(text, source_name=source_name)
        head = [line.strip() for line in text.splitlines()[:3]]
        self.warning("lab export %s: not a supported raw export; first lines %s", source_name, head)
        raise ParseError(
            f"{source_name}: not a supported raw lab export (expected a Geosys oedometer "
            "control listing, the newer oedometer module's raw export, or a triaxial "
            "per-point dump)"
        )
