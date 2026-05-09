"""WFS-row metadata for one DOV sample feature (Phase C3).

Each row is the WFS-side identity of a sample (= ``Sample`` once persisted).
DOV publishes sample headers in the ``boringen:grondmonsters`` WFS layer;
each row carries the depth interval, sample-type / composition / instrument
metadata, the sample's own permkey, and a URL link back to the parent
borehole's data page.

We expose this as its own module per the project "one class per file" rule.
The Phase C3 orchestrator (``ImportSamplesDov``) and the sample WFS client
(``DovSampleClient``) both import it.

Why we don't fetch the per-sample monster XML
---------------------------------------------
The per-sample XML at ``/data/monster/{permkey}.xml`` is mostly redundant
with the WFS row plus a ``<bijlage>`` reference (see CLAUDE.md memory:
"DOV WFS endpoint map"). The Sample domain entity's fields are all
expressible from the WFS row:

* depth_top_m / depth_base_m       ← diepte_van_m / diepte_tot_m
* description, sample_number       ← monsternummer (free-form ID)
* sample_type / composition /
  instrument / sampling_date       ← monstertype / monstersamenstelling /
                                     bemonsteringsinstrument /
                                     monstername_datum

Every metadata field is optional on DOV's side — older samples drop most
of them — so the WFS-row builder treats every field as ``str | None``
and the orchestrator persists ``None`` faithfully rather than fabricating
defaults.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class SampleWfsRow:
    """WFS-row metadata for one ``boringen:grondmonsters`` feature.

    Parameters
    ----------
    permkey : str
        DOV permkey for the sample (e.g. ``"2017-137886"``). Used as the
        cache key (sample XMLs land under ``monster/`` if/when we ever
        fetch them) and as the lookup key for grain-size observations
        (whose ``gekoppeld_aan_link`` URLs end in this permkey).
    parent_borehole_permkey : str
        Last path segment of the WFS row's ``gekoppeld_aan`` URL — the
        permkey of the parent borehole. The orchestrator resolves this
        to a borehole UUID via the parent ``permkey_to_borehole_id`` map.
    monster_xml_url : str
        Public URL of the sample's monster page. Currently unused (the
        WFS row is sufficient for Phase C3) but kept here so a future
        phase can fetch the XML without re-querying the WFS.
    depth_top_m : float | None
        Top of the sampled interval in metres below surface. ``None`` when
        DOV omitted ``diepte_van_m``. Spot samples (top == base) are valid.
    depth_base_m : float | None
        Base of the sampled interval. ``None`` for the same reason.
    sample_number : str | None
        Source-side identifier (``monsternummer``). Often a small integer
        like ``"0"`` or ``"19"`` plus an optional tag.
    sample_type : str | None
        Source-vocabulary token (DOV ``monstertype``: ``"geroerd"`` /
        ``"ongeroerd"``). Translation is a presentation concern.
    composition : str | None
        Source-vocabulary composition (``monstersamenstelling``):
        ``"Enkelvoudig monster"`` / ``"Mengmonster"``.
    instrument : str | None
        Source-vocabulary sampling instrument (``bemonsteringsinstrument``):
        ``"spoelboor"`` / ``"pulsboor"`` / ``"edelmanboor"`` / etc.
    sampling_date : date | None
        Date the sample was taken (``monstername_datum``). ``None`` when DOV
        couldn't parse it or omitted it; Sample.sampling_date stays None.
    observation_count : int | None
        Reported total number of observations on this sample
        (``aantal_observaties``). Includes grain-size + Atterberg + CaCO3
        + organic + water-content + any other parametergroep — not just
        grain-size. Useful for diagnostics; not stored on the Sample.
    """

    permkey: str
    parent_borehole_permkey: str
    monster_xml_url: str
    depth_top_m: float | None
    depth_base_m: float | None
    sample_number: str | None
    sample_type: str | None
    composition: str | None
    instrument: str | None
    sampling_date: date | None
    observation_count: int | None
