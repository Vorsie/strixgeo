"""Pure derivation of a geotech band-set's litho parent links from FINAL geometry.

Owner ruling 2026-09-01: *"Running it on divide boreholes is prolly not right,
because that is usually before the last user changes; we need the litho parents
after the model build."* The geotech Build is the last whole-model operation, so
it is where a geotech band's covering litho band and each connected body's litho
parent are (re)derived — Divide/subdivide and the recompute run earlier, before
the final edits, and only stamp the link once at their own moment.

Two rules, one per level of the parent link:

* Band level — a geotech band's covering litho band is the accepted litho band
  on the SAME investigation whose half-open ``[depth_top_m, depth_base_m)``
  interval contains the band's vertical MIDPOINT (owner spec note 2026-08-27;
  the same rule the ``c9d0e1f2a3b4`` migration backfilled). ``None`` = no
  covering band, a true orphan.
* Body level — a connected geotech body's litho parent BODY is taken from the
  SHALLOWEST member band that HAS a covering litho band (min ``depth_top_m``,
  tie-broken by band id); that covering litho band's own ``body_id`` is the
  answer, which may itself be ``None``. ``None`` = no member has a covering band.

These functions are the executable statement of the rules the geotech Build's
two heal UPDATEs implement as set-based SQL
(:meth:`~groundmodel.infrastructure.db.repositories.litho_layer_repository.LithoLayerRepository.rederive_geotech_parent_litho_layers`
and ``.restamp_geotech_parent_litho_bodies``) and that
``ResolveLithoInstances`` step 5b/6 stamps on a resolve. They are PURE — no
session, no ORM — so the rule is unit-tested here in isolation while the SQL,
which must run on PostgreSQL, mirrors it (integration-tested). The codebase
already keeps this rule in both a Python (resolver step 5b) and a SQL (step 6)
form; this module is the third, testable statement they all agree with.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class LithoBandInterval:
    """One accepted litho band's identity + interval on one investigation.

    Attributes
    ----------
    layer_id : UUID
        The litho ``litho_layer.id`` — what a covering band stamps onto a
        geotech band's ``parent_litho_layer_id``.
    cpt_id : UUID | None
        The CPT anchor, or ``None`` when the band is on a borehole.
    borehole_id : UUID | None
        The borehole anchor, or ``None`` when the band is on a CPT.
    depth_top_m : float
        Interval top (shallower end, in metres of depth).
    depth_base_m : float
        Interval base (deeper end); the interval is half-open ``[top, base)``.
    """

    layer_id: UUID
    cpt_id: UUID | None
    borehole_id: UUID | None
    depth_top_m: float
    depth_base_m: float


def covering_litho_band_id(
    *,
    band_top_m: float,
    band_base_m: float,
    band_cpt_id: UUID | None,
    band_borehole_id: UUID | None,
    candidate_litho_bands: Iterable[LithoBandInterval],
) -> UUID | None:
    """Return the covering litho band's id for one geotech band, or ``None``.

    The covering band is the accepted litho band on the SAME investigation whose
    half-open ``[depth_top_m, depth_base_m)`` interval contains the geotech
    band's vertical midpoint ``(band_top_m + band_base_m) / 2``. Litho
    contiguity guarantees at most one such band on a column, so the first match
    is returned. This is the midpoint rule the ``c9d0e1f2a3b4`` migration
    backfilled and the Build's heal UPDATE re-derives.

    Parameters
    ----------
    band_top_m, band_base_m : float
        The geotech band's interval (metres of depth); its midpoint is the probe.
    band_cpt_id : UUID | None
        The geotech band's CPT anchor (``None`` when it is on a borehole).
    band_borehole_id : UUID | None
        The geotech band's borehole anchor (``None`` when it is on a CPT).
    candidate_litho_bands : Iterable[LithoBandInterval]
        The accepted litho bands to search — the parent litho model's bands.
        Bands on another investigation are skipped by the same-anchor test, so
        an unfiltered model-wide list is accepted (though a per-column list is
        cheaper).

    Returns
    -------
    UUID | None
        The covering litho band's ``layer_id``, or ``None`` when the midpoint
        falls in no accepted litho band on the same investigation (a true
        orphan — the honest "No litho band" state).
    """
    midpoint = (band_top_m + band_base_m) / 2.0
    for litho in candidate_litho_bands:
        same_investigation = (band_cpt_id is not None and litho.cpt_id == band_cpt_id) or (
            band_borehole_id is not None and litho.borehole_id == band_borehole_id
        )
        if same_investigation and litho.depth_top_m <= midpoint < litho.depth_base_m:
            return litho.layer_id
    return None


@dataclass(frozen=True)
class GeotechBodyMember:
    """One accepted member band of a geotech body, for the litho-parent stamp.

    Attributes
    ----------
    band_id : UUID
        The geotech band's ``litho_layer.id`` — the tie-break key after depth,
        matching the SQL's ``ORDER BY depth_top_m, id``.
    depth_top_m : float
        The band's interval top; the SHALLOWEST member wins.
    has_covering_litho_band : bool
        Whether the band has a covering litho band (``parent_litho_layer_id`` is
        set). A member without one is ineligible to be the shallowest.
    covering_litho_body_id : UUID | None
        The ``body_id`` of that covering litho band (its litho BODY), or
        ``None`` — either because the band has no covering band, or because the
        covering litho band is itself not yet resolved into a body.
    """

    band_id: UUID
    depth_top_m: float
    has_covering_litho_band: bool
    covering_litho_body_id: UUID | None


def geotech_body_litho_parent_id(members: Iterable[GeotechBodyMember]) -> UUID | None:
    """Return a geotech body's litho parent BODY id, or ``None``.

    Mirrors ``ResolveLithoInstances`` step 5b/6: among the members that HAVE a
    covering litho band, take the SHALLOWEST (min ``depth_top_m``, tie-broken by
    ``band_id``) and return that band's ``covering_litho_body_id`` — which may
    itself be ``None`` when the covering litho band is not yet in a body. The
    shallowest covered member wins outright; the selection never skips to a
    deeper member merely to find a non-null litho body.

    Parameters
    ----------
    members : Iterable[GeotechBodyMember]
        The body's accepted member bands.

    Returns
    -------
    UUID | None
        The litho parent BODY id, or ``None`` when no member has a covering
        litho band (the honest "No litho body" state).
    """
    with_cover = [m for m in members if m.has_covering_litho_band]
    if not with_cover:
        return None
    with_cover.sort(key=lambda m: (m.depth_top_m, str(m.band_id)))
    return with_cover[0].covering_litho_body_id
