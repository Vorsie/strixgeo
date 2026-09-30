"""Provenance enum for ``elevation_m`` on CPT + borehole rows."""

from enum import StrEnum


class ElevationSource(StrEnum):
    """Where a row's surface elevation came from.

    Stored alongside ``elevation_m`` on both ``cpt`` and ``borehole``
    so the refresh-on-duplicate import path can overwrite an imported
    Z (e.g. DOV corrected one of their published values) without
    clobbering a manual edit the user made afterwards — see debt #8.

    Values
    ------
    DOV
        Surface Z came from a DOV WFS row (sondering ``Z_mTAW`` or
        boring ``Z_mTAW`` property).
    GEF
        Surface Z came from a GEF file's ``#ZID=`` header.
    MANUAL
        User entered the Z via the desktop's ``ElevationEditor`` —
        the refresh-on-duplicate path must NOT overwrite this value
        even when the upstream Z changes.
    NONE
        No Z is recorded for this row (``elevation_m`` is ``NULL``).
        The default for rows that pre-date this enum's introduction
        — treat as unknown.
    PDF
        Surface Z is the ground level printed on a PDF report's CPT sheet
        ("HOOGTE MAAIVELD"), read by the PDF digitiser (or typed by the
        user in the import dialog when the sheet printed none).

    A ``None`` Python value (column NULL after an old migration) means
    the same as ``NONE``; new rows always carry a non-null enum.
    """

    DOV = "dov"
    GEF = "gef"
    MANUAL = "manual"
    NONE = "none"
    PDF = "pdf"
