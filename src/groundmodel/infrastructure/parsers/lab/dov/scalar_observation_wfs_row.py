"""WFS-row metadata for a scalar-valued DOV lab observation (Phase C4).

DOV's ``monster:observaties`` WFS rows already carry the value (``resultaat``)
plus all the metadata the scalar lab-test ORMs need (method, test date,
detectieconditie). So unlike grain-size — which uses a series stored in the
per-observation XML body — scalar tests need NO XML fetch at all.
``DovScalarObservationClient`` issues only the WFS query and the orchestrator
maps each row directly into a CaCO3Content / OrganicContent / WaterContent /
AtterbergLimits row.

We expose this as its own module per the project "one class per file" rule.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class ScalarObservationWfsRow:
    """One scalar-valued lab observation row from ``monster:observaties``.

    Parameters
    ----------
    permkey : str
        DOV permkey for the observation (e.g. ``"2019-790783"``). The
        cache root has no entry for scalar tests since the XML body is
        never fetched, but we keep the permkey for diagnostics and as a
        stable identity in logs.
    parent_sample_permkey : str
        Last path segment of the WFS row's ``gekoppeld_aan_link`` URL —
        the permkey of the parent ``Sample``. Resolved by the
        orchestrator to a sample UUID via the ``permkey_to_sample_id`` map
        built during the C3 sample-persist phase.
    parameter : str
        Source-vocabulary parameter string (e.g.
        ``"Calciumcarbonaatgehalte (caco3_gehalte)"``). Used for routing
        when one query returns multiple parameters (Atterberg LL + PL).
    resultaat : str | None
        The scalar value as a string. ``None`` when ``detectieconditie``
        is non-empty (DOV typically nulls ``resultaat`` whenever the
        condition is set — verified live 2026-05-09). Strings rather than
        floats because DOV ships values like ``"0.000"`` and we let the
        domain entity validate after we parse.
    eenheid : str | None
        Source-vocabulary unit string (``"%"`` / ``"g/100g"`` / etc.).
        Kept for diagnostics; the ORM doesn't store it (every column
        already has its unit baked in).
    methode : str | None
        Source-vocabulary measurement method (``"Calcimetrie"`` / ``"TOC
        by CN analyser na verwijderen anorganische C"`` / ``"Onbekend"``).
        Pass-through for the ORM's ``method`` column.
    fenomeentijd : date | None
        Date the test was performed. Maps directly to ORM ``test_date``.
    detectieconditie : str | None
        DOV's "the value couldn't be measured because…" code. ``"NM"`` =
        Niet Meetbaar = not measurable; ``"<"`` = below detection limit;
        ``None`` = no condition (ordinary measurement). The orchestrator
        maps ``"NM"`` on a plastic-limit row to
        ``AtterbergLimits.non_plastic = True``.
    """

    permkey: str
    parent_sample_permkey: str
    parameter: str
    resultaat: str | None
    eenheid: str | None
    methode: str | None
    fenomeentijd: date | None
    detectieconditie: str | None
