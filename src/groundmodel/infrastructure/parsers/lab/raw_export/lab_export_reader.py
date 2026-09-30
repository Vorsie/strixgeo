"""Sniff a lab export's kind from its content and hand it to the right parser.

The file name and the extension say nothing about the kind (``cd.txt`` is not
unique; ``.csv`` / ``.txt`` do not fix the delimiter; the 8.3 names truncate
the borehole), so the reader looks at what the file holds.
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_constants import (
    LAB_EXPORT_ENCODING,
    LAB_EXPORT_FORMAT_OED_LISTING,
    LAB_EXPORT_FORMAT_OED_NEW_RAW,
    LAB_EXPORT_FORMAT_TX_DUMP,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_constants import (
    OED_STAGE_HEADER_RE,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_control_listing_parser import (
    OedometerControlListingParser,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_new_constants import (
    OED_NEW_START_MARKER,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_new_export_parser import (
    OedometerNewExportParser,
)
from groundmodel.infrastructure.parsers.lab.raw_export.triaxial_constants import (
    TX_SPECIMEN_RE,
    TX_TABLE_HEADER_LABEL,
)
from groundmodel.infrastructure.parsers.lab.raw_export.triaxial_dump_result import (
    TriaxialDumpResult,
)
from groundmodel.infrastructure.parsers.lab.raw_export.triaxial_raw_dump_parser import (
    TriaxialRawDumpParser,
)
from groundmodel.shared.exceptions import LabFileFormatNotRecognisedError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_UTF8_BOM = b"\xef\xbb\xbf"


def decode_lab_export_bytes(raw: bytes) -> str:
    """Decode a lab export: UTF-8 when it carries a BOM, else ISO-8859-1.

    The control listings and point dumps are ISO-8859-1 with no BOM; the newer oedometer
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
    return raw.decode(LAB_EXPORT_ENCODING)


def detect_lab_export_format(raw: bytes) -> str | None:
    """Return the export's source-format stamp, or ``None`` when unknown.

    Parameters
    ----------
    raw : bytes
        The file bytes.

    Returns
    -------
    str or None
        ``LAB_EXPORT_FORMAT_OED_LISTING`` (a ``TRAP :`` stage block),
        ``LAB_EXPORT_FORMAT_OED_NEW_RAW`` (``#START_METINGEN``),
        ``LAB_EXPORT_FORMAT_TX_DUMP`` (a specimen block and a ``Meetpunt``
        table), or ``None``.
    """
    lines = decode_lab_export_bytes(raw).splitlines()
    if any(line.startswith(OED_NEW_START_MARKER) for line in lines):
        return LAB_EXPORT_FORMAT_OED_NEW_RAW
    if any(OED_STAGE_HEADER_RE.match(line) for line in lines):
        return LAB_EXPORT_FORMAT_OED_LISTING
    has_specimen = any(TX_SPECIMEN_RE.match(line) for line in lines)
    has_table = any(line.startswith(TX_TABLE_HEADER_LABEL) for line in lines)
    if has_specimen and has_table:
        return LAB_EXPORT_FORMAT_TX_DUMP
    return None


class LabExportReader(GroundModelLogger):
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
        LabFileFormatNotRecognisedError
            When the content is none of the supported exports.
        ParseError
            When the matching parser refuses the file.
        """
        fmt = detect_lab_export_format(raw)
        self.info("lab export %s: %d bytes, sniffed as %s", source_name, len(raw), fmt)
        text = decode_lab_export_bytes(raw)
        if fmt == LAB_EXPORT_FORMAT_OED_LISTING:
            return OedometerControlListingParser().parse_text(text, source_name=source_name)
        if fmt == LAB_EXPORT_FORMAT_OED_NEW_RAW:
            return OedometerNewExportParser().parse_text(text, source_name=source_name)
        if fmt == LAB_EXPORT_FORMAT_TX_DUMP:
            return TriaxialRawDumpParser().parse_text(text, source_name=source_name)
        head = [line.strip() for line in text.splitlines()[:3]]
        self.warning(
            "lab export %s: format not recognised (none of the oedometer control "
            "listing, the oedometer stage export or the triaxial per-point dump); "
            "first lines %s",
            source_name,
            head,
        )
        raise LabFileFormatNotRecognisedError(source_name)
