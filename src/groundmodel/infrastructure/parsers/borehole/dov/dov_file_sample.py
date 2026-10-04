"""One sample (``<monster>``) found in a local DOV borehole XML file."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from uuid import UUID

from groundmodel.infrastructure.parsers.lab.dov.grain_size_parse_result import (
    GrainSizeParseResult,
)


@dataclass
class DovFileSample:
    """A sample of one boring, parsed out of a local DOV file.

    Every string is the raw DOV token (source vocabulary, never translated at
    ingest); a codelist URI is reduced to its last path segment, which is the
    token the DOV WFS row carries for the same field (``ongeroerd``, ``boor``).

    Parameters
    ----------
    sample_key : UUID
        Provisional id the grain-size curves were parsed against; the use case
        stores it as the new ``SampleOrm.id`` (a refresh that matches a stored
        sample keeps the stored id instead).
    permkey : str | None
        DOV permkey of the sample (``identificator`` assigned by DOV); the
        refresh key, the same ``SampleOrm.dov_permkey`` the bbox import writes.
    sample_number : str | None
        The data manager's own sample number (``identificator`` assigned by
        anyone else, e.g. ``DATABEHEERDER``).
    depth_top_m, depth_base_m : float
        ``bemonsteringsplaats/van`` and ``/tot``; a missing ``tot`` makes a
        spot sample (top == base), as DOV itself writes spot samples.
    description : str
        ``beschrijving`` when the file has one, else empty.
    sample_type : str | None
        ``monstertype`` (``geroerd`` / ``ongeroerd``).
    composition : str | None
        ``type`` (``Enkelvoudig monster`` / ``Mengmonster``).
    instrument : str | None
        ``bemonsteringsmethode/bemonsteringsinstrument``.
    sampling_date : date | None
        ``bemonsteringstijdstip/datum``.
    grain_sizes : list[tuple[str | None, GrainSizeParseResult]]
        Grain-size curves the file carries for this sample, each with the
        observation's DOV permkey (``GrainSizeOrm.dov_permkey``).
    """

    sample_key: UUID
    permkey: str | None
    sample_number: str | None
    depth_top_m: float
    depth_base_m: float
    description: str = ""
    sample_type: str | None = None
    composition: str | None = None
    instrument: str | None = None
    sampling_date: date | None = None
    grain_sizes: list[tuple[str | None, GrainSizeParseResult]] = field(default_factory=list)
