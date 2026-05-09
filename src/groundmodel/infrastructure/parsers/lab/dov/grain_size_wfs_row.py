"""WFS-row metadata for one DOV grain-size observation feature (Phase C3).

Each row is the WFS-side identity of a grain-size observation, sourced from
the unified ``monster:observaties`` WFS layer (≈7.5M rows in DOV) filtered
server-side to ``parametergroep = "Onderkenningsproeven-korrelverdeling "``.
The row points at the per-observation XML body whose contents
(``DovGrainSizeParser``) we turn into a ``GrainSize`` entity.

We expose this as its own module per the project "one class per file" rule;
``DovGrainSizeClient`` and ``ImportSamplesDov`` both import it.

Why we filter server-side rather than fetching all observations and
filtering client-side
---------------------------------------------------------------------
DOV's ``monster:observaties`` layer ships ALL lab-test observations
across every parametergroep (grain-size, Atterberg, CaCO3, organic,
water-content, plus dozens of other tests). A bbox can easily return
tens of thousands of features when unfiltered, the vast majority of
which we don't care about. Filtering with ``CQL_FILTER`` on
``parametergroep`` cuts both bandwidth and our recursive-bbox-split
budget — a sparse stream stays sparse.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GrainSizeWfsRow:
    """WFS-row metadata for one grain-size ``monster:observaties`` feature.

    Parameters
    ----------
    permkey : str
        DOV permkey for the observation (e.g. ``"2022-2618228"``). Cache
        key for the per-observation XML at ``/data/observatie/{permkey}.xml``.
    parent_sample_permkey : str
        Last path segment of the WFS row's ``gekoppeld_aan_link`` URL —
        the permkey of the parent ``Sample``. The orchestrator resolves
        this to a sample UUID via the ``permkey_to_sample_id`` map it
        builds during the sample-persist phase.
    fiche_url : str
        Public URL of the observation page (302-redirects to the proxy).
        Kept for diagnostics.
    xml_url : str
        Proxy-direct URL the client actually fetches — saves the 302
        round-trip. Mirrors the optimisation in ``DovBoreholeClient`` and
        ``DovInterpretationClient``.
    """

    permkey: str
    # The parent-borehole permkey isn't carried on the grain-size row by
    # design: the Sample row's borehole_id FK is set during the Phase C3
    # sample-persist phase (resolved via the orchestrator's
    # permkey_to_borehole_id map), and GrainSize.sample_id FKs to that.
    # So the chain GrainSize → Sample → Borehole is intact at the DB
    # layer, no extra permkey tracking needed here.
    parent_sample_permkey: str
    fiche_url: str
    xml_url: str
