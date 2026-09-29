"""Track source enum — where a borehole track came from."""

from enum import StrEnum


class TrackSource(StrEnum):
    """Provenance of a borehole track (observation stream or field-log kind).

    Data Integrity rule 1: a value the engineer typed must never pass for a
    value DOV published. Every observation and field-log row carries one of:

    * DOV — imported from DOV. An imported track the engineer later edits
      STAYS ``dov`` (it keeps its ``dov_permkey`` upstream identity) and gets
      ``edited_manually_at`` stamped, so the UI can say "edited by hand".
    * MANUAL — created by hand in the borehole's Tracks panel.

    Stored as a plain VARCHAR (like ``observation_type``) so a future source
    (a GEF borehole import, a BRO import) needs no ENUM-evolution migration.
    """

    DOV = "dov"
    MANUAL = "manual"
