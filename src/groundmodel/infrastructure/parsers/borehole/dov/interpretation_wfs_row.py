"""WFS-row metadata for one DOV interpretation feature (Phase C2).

Each row is the WFS-side identity of an interpretation (= an ``Observation``
once persisted). The orchestrator pairs the row with the per-feature XML body
and the parent borehole's UUID, then asks ``DovInterpretationParser`` to turn
the bytes into a populated ``Observation``.

We expose this as its own module per the project "one class per file" rule;
``DovInterpretationClient`` and ``ImportInterpretationsDov`` both import it.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.observation_type import ObservationType


@dataclass(frozen=True)
class InterpretationWfsRow:
    """WFS-row metadata for one interpretation feature.

    DOV publishes every interpretation as a row in one of eight
    ``interpretaties:*`` WFS layers. Each row carries the parent borehole's
    ``Proefnummer`` (= ``boornummer`` on the borehole side, which we store as
    ``test_id``) plus a ``fiche`` URL pointing to the per-interpretation XML
    body at ``/data/interpretatie/{permkey}.xml``.

    Design notes
    ------------
    * ``observation_type`` is set by the client based on which WFS layer the
      feature came from — DOV's WFS feature itself doesn't redundantly carry
      the stream type, so the client tags it during row construction.
    * We deliberately don't store parsed metadata fields here (author, date,
      reliability, ...) — those live in the per-interpretation XML body and
      are populated by the parser. Mixing WFS-row metadata with XML-parsed
      content would create a drift risk (CLAUDE.md "Data Integrity Rules" §1).
    * ``permkey`` is extracted from the ``fiche`` URL's last path segment.
      It's the cache key so per-stream collisions in a single permkey
      namespace can never escape: the orchestrator scopes the cache to the
      ``interpretatie/`` subdirectory of the shared DOV cache root.

    Parameters
    ----------
    permkey : str
        DOV permkey for the interpretation XML (e.g. ``"2025-200001"``).
    test_id : str
        ``Proefnummer`` from the WFS row — the parent borehole's
        ``boornummer``. The orchestrator uses this as the lookup key to
        resolve the parent borehole's UUID.
    observation_type : ObservationType
        Which interpretation stream this row belongs to. Set by the client
        from the WFS layer name; passed through to the parser as required
        keyword argument.
    fiche_url : str
        Public URL of the interpretation page (302-redirects to the proxy).
        Kept for diagnostics.
    xml_url : str
        Proxy-direct URL the client actually fetches — saves the 302 round-
        trip. Mirrors the optimisation already in ``DovBoreholeClient``.
    """

    permkey: str
    test_id: str
    observation_type: ObservationType
    fiche_url: str
    xml_url: str
