"""Value objects for the DOV Virtuele Boring doorprik response.

The API returns two arrays — ``data`` (per-layer top/base/thickness at
the queried point) and ``layers`` (the model's full unit catalogue
inline, with code → Dutch name + color + NCS link). We merge them at
parse time into a single flat list of ``VirtueleBoringLayer`` rows so
the consumer never has to do a second lookup against ``layers``.

Storing the resolved beschrijving / name / color on every row is a
small redundancy but keeps the wire shape downstream-friendly: a row
fully describes itself, and a renderer can iterate without carrying
the catalogue.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VirtueleBoringLayer:
    """One layer (formation / member / hydrogeo unit) at a single point.

    Attributes
    ----------
    code : str
        API-internal sequential code (``g3dv3_F_2``, ``hcovv2_H_1``,
        …). NOT the G3Dv3 4-digit numeric code from our static
        catalog — Virtuele Boring uses a different numbering. Bridge
        via ``name`` (strip "Formatie van " or "Fm " prefix) if cross-
        referencing the G3Dv3 catalog is needed.
    name : str
        Full Dutch label as the API ships it ("Formatie van Gent",
        "Antropogeen", "A0100 - Quartaire Aquifersystemen"). Suitable
        for direct UI display.
    beschrijving : str
        Short label ("Fm Gent", "Antropogeen", "Quartaire
        Aquifersystemen"). Shorter than ``name`` — useful for narrow
        column labels on the section view.
    top_m_taw : float
        Absolute top elevation in mTAW (Belgian vertical datum,
        EPSG:5710). Positive = above sea level, negative = below.
    base_m_taw : float
        Absolute base elevation in mTAW.
    thickness_m : float
        Layer thickness (``top_m_taw - base_m_taw``). DOV computes it
        server-side; we pass through.
    color_hex : str | None
        Prescribed RGB ("#RRGGBB") from DOV's layer catalogue. None
        when the API ships an empty / null colour for the unit.
    ncs_link : str | None
        Optional URL to the Natural Sciences lithostratigraphy page
        for this formation, when DOV ships one in ``layers[].links``.
        Members + hydrogeology units typically don't have one.
    """

    code: str
    name: str
    beschrijving: str
    top_m_taw: float
    base_m_taw: float
    thickness_m: float
    color_hex: str | None
    ncs_link: str | None


@dataclass(frozen=True, slots=True)
class VirtueleBoringResult:
    """The full doorprik response for one (x, y) and one model code.

    Attributes
    ----------
    model_code : str
        Echoes the model code the caller queried (``g3dv3_F``,
        ``hcovv2_H``, …). Useful when a service multiplexes several
        models in one response payload.
    x_lambert72 : float
    y_lambert72 : float
        Echoes the query coordinates so consumers can verify what
        was asked for without re-threading the call site.
    layers : list[VirtueleBoringLayer]
        One entry per layer present at the point, ordered top → base
        (descending top elevation). Layers absent at the point are
        simply omitted; this is NOT a fixed-size catalogue.
    """

    model_code: str
    x_lambert72: float
    y_lambert72: float
    layers: list[VirtueleBoringLayer]
