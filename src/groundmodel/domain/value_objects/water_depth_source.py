"""Provenance enum for ``water_depth_m`` on CPT rows."""

from enum import StrEnum


class WaterDepthSource(StrEnum):
    """Where a CPT's recorded water-table depth came from.

    Stored alongside ``water_depth_m`` so the refresh-on-duplicate import
    path can overwrite a file-derived water table without clobbering the
    engineer's own judgement — the same contract ``ElevationSource.MANUAL``
    gives the surveyed collar (debt #8).

    Values
    ------
    GEF
        The depth came from the file's ``#MEASUREMENTVAR= 14`` header
        (DIEPTE GRONDWATER).  The parser is the only writer; a re-parse of
        the same file is the authority on it.
    ENGINEER
        The engineer typed the value in the Parameters inspector.  It
        OUTRANKS the file: a re-import must not silently move the water
        table the whole Ic profile is normalised against.

    A NULL column means "no water table recorded" — the consumer falls back
    to ``DEFAULT_GWT_DEPTH_M`` and must label the value as ASSUMED (Data
    Integrity Rule 1).  There is deliberately no ``ASSUMED`` member here:
    an assumption is the ABSENCE of a record, not a third kind of record.
    """

    GEF = "gef"
    ENGINEER = "engineer"
