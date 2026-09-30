"""Kinds of raw lab-series test (the ``lab_series_test.kind`` vocabulary)."""

from enum import StrEnum


class LabSeriesKind(StrEnum):
    """Which laboratory test a raw series belongs to — OUR vocabulary.

    The lab's own test-type token ("CD", "CU", "UU") is stored verbatim next to
    it (``test_type_token``); this enum only names the family, so the storage
    shape (test → specimens → stages → channels) and the viewer can branch on it.

    * OEDOMETER — incremental-loading oedometer (one specimen, one stage per
      load step, readings against time).
    * TRIAXIAL — triaxial compression (n specimens, one shear stage each,
      readings against the lab's point numbers; no time axis in the export).
    """

    OEDOMETER = "oedometer"
    TRIAXIAL = "triaxial"
