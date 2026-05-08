"""WFS-row metadata for one DOV borehole — typed dataclass for orchestration."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BoreholeWfsRow:
    """WFS-row metadata for one borehole.

    Holds the fields the orchestrator needs to enrich a parsed Borehole that
    aren't available in the boring XML body itself. ``test_id`` is the
    ``boornummer`` from the WFS row; ``permkey`` is the dataidentifier piece
    extracted from the ``fiche`` URL.

    Coordinate nullability invariant
    --------------------------------
    ``x`` and ``y`` are typed ``float | None`` here because the WFS row is the
    parser's faithful view of what DOV shipped — DOV could in theory return a
    feature with null coordinates (network glitch, malformed source, etc.).
    The PERSIST step refuses to write such a borehole: ``ImportBoreholeDov``
    requires non-null x/y after the XML→WFS merge, otherwise the row cannot
    be placed on the map and is marked as failed for the import report. ``z``
    is allowed to remain ``None`` post-merge (the NO_ELEVATION warning case
    from ``DovBoringParser``); the user can supply Z manually later via the
    UI editor described in ``CLAUDE.local.md`` "Phase 3a UX requirements".

    Boolean flags map to the eight DOV interpretation streams. The
    orchestrator (Phase C2) uses them to decide which interpretation WFS
    layers to query for this borehole.
    """

    permkey: str
    test_id: str  # boornummer (= bore number)
    fiche_url: str
    xml_url: str  # proxy URL constructed from fiche_url

    # Coordinates from the WFS row. ``None`` when DOV omitted them — see the
    # nullability invariant above; the orchestrator validates non-null x/y
    # before persisting and rejects rows that lack a placeable position.
    x: float | None
    y: float | None
    z: float | None  # Z_mTAW; orchestrator uses as fallback when boring XML omits Z.

    # Borehole header metadata that lives only in the WFS row.
    drill_method: str | None  # Boringen.methode summary (= drilling method)
    # Free-text municipality (DOV ``gemeente``). When ``None``, downstream code
    # can resolve from the coords via reverse geocoding rather than asking the
    # user — captured in CLAUDE.local.md "Phase 3a UX requirements" together
    # with the manual-Z-entry editor; no code change here yet.
    municipality: str | None
    executor: str | None
    purpose: str | None
    total_depth_m: float | None

    # Eight interpretation-stream availability flags (Phase C2 uses these).
    has_coded_lithology: bool
    has_geotechnical_coding: bool
    has_lithological_description: bool
    has_informal_stratigraphy: bool
    has_formal_stratigraphy: bool
    has_quaternary_stratigraphy: bool
    has_hydrogeological_stratigraphy: bool
    has_informal_hydrogeological_stratigraphy: bool
