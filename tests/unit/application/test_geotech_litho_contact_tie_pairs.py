"""A tie that restates a shared litho contact, with a borehole between, is deleted.

Direct unit pins for the pure ``litho_contact_tie_pairs`` band-planning
function, which had no test file at all.  These guard the rule on its own terms
before it moves out of ``divide_boreholes.py`` into ``band_planning.py``.

Owner's step 1, 2026-08-16:

    if a cpt to cpt contact is a litho contact, then you replace it by the litho
    bands

and, on his S13 KLEI-21 <-> S6 ZAND-5 tie that looks cross-facies until you read
the unit above it:

    i thought we were talking about the silt unit on top that should be one unit

Both clauses matter.  A tie is returned (to be deleted, because dividing the
boreholes between the two columns re-expresses it) only when the litho unit
ABOVE each tied band is the SAME body laterally, AND a borehole sits BETWEEN the
two tied columns along the section.  With no borehole between them nothing was
re-expressed; with different units above them the surfaces are unrelated
contacts that merely happen to be unit boundaries.

The fixtures model two columns A (along 0) and B (along 10) whose tied bands
each start at 8.0 m — the base of a shared silt unit above (body ``SILT``) — with
a borehole H at along 5.
"""

from __future__ import annotations

from groundmodel.application.divide_boreholes import litho_contact_tie_pairs
from groundmodel.domain.services.geotech_tie_donors import AcceptedTie

# The tied geotech bands: each starts at 8.0 m (the base contact of the silt).
_GEOTECH_BY_INV = {
    "A": [(8.0, 12.0, "tieA")],
    "B": [(8.0, 12.0, "tieB")],
}
# Litho layers per column: a silt unit 1..8 over a lower unit 8..12.
_LITHO_DEPTHS = {
    "A_silt": ("A", 1.0, 8.0),
    "A_lower": ("A", 8.0, 12.0),
    "B_silt": ("B", 1.0, 8.0),
    "B_lower": ("B", 8.0, 12.0),
}
_ALONG = {"A": 0.0, "H": 5.0, "B": 10.0}


def _tie() -> AcceptedTie:
    """The accepted A<->B packing tie on the base contact of the silt unit."""
    return AcceptedTie(
        investigation_a="A",
        layer_a_id="tieA",
        investigation_b="B",
        layer_b_id="tieB",
        section_id="S",
    )


def test_ct1_shared_silt_above_with_a_borehole_between_is_deleted() -> None:
    """CT1 — the owner's case: one silt unit above both tied bands, borehole between."""
    body_by_layer = {
        "A_silt": "SILT",
        "A_lower": "CLAY",
        "B_silt": "SILT",
        "B_lower": "SAND",
    }

    pairs = litho_contact_tie_pairs(
        accepted_ties=[_tie()],
        geotech_layer_by_inv_depth=_GEOTECH_BY_INV,
        litho_layer_depths=_LITHO_DEPTHS,
        litho_body_by_layer=body_by_layer,
        along_by_investigation=_ALONG,
        borehole_ids={"H"},
    )

    assert pairs == [("tieA", "tieB")]


def test_ct2_no_borehole_between_the_columns_keeps_the_tie() -> None:
    """CT2 — with no borehole between the two columns nothing was re-expressed."""
    body_by_layer = {
        "A_silt": "SILT",
        "A_lower": "CLAY",
        "B_silt": "SILT",
        "B_lower": "SAND",
    }

    pairs = litho_contact_tie_pairs(
        accepted_ties=[_tie()],
        geotech_layer_by_inv_depth=_GEOTECH_BY_INV,
        litho_layer_depths=_LITHO_DEPTHS,
        litho_body_by_layer=body_by_layer,
        along_by_investigation=_ALONG,
        borehole_ids=set(),
    )

    assert pairs == []


def test_ct3_different_unit_above_each_column_keeps_the_tie() -> None:
    """CT3 — the second clause: unrelated units above, so it is not one contact."""
    body_by_layer = {
        "A_silt": "SILT",
        "A_lower": "CLAY",
        "B_silt": "OTHER",  # B's unit above is a different body
        "B_lower": "SAND",
    }

    pairs = litho_contact_tie_pairs(
        accepted_ties=[_tie()],
        geotech_layer_by_inv_depth=_GEOTECH_BY_INV,
        litho_layer_depths=_LITHO_DEPTHS,
        litho_body_by_layer=body_by_layer,
        along_by_investigation=_ALONG,
        borehole_ids={"H"},
    )

    assert pairs == []
