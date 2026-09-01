"""The geotech Build re-derives a band-set's litho parent links from FINAL geometry.

Owner ruling 2026-09-01: *"Running it on divide boreholes is prolly not right,
because that is usually before the last user changes; we need the litho parents
after the model build."* The Build is the last whole-model operation, so it is
where a geotech band's covering litho band and each connected body's litho
parent are (re)derived — recompute runs earlier, before the final edits.

Two rules, one per level of the parent link, pinned here as pure functions the
Build's two heal UPDATEs mirror as set-based SQL:

* Band level — a geotech band's covering litho band is the accepted litho band
  on the SAME investigation whose ``[depth_top_m, depth_base_m)`` interval
  contains the band's vertical MIDPOINT (the same rule the ``c9d0e1f2a3b4``
  migration backfilled). Re-deriving is an OVERWRITE: a band edited so its
  midpoint now sits under a different litho layer picks up the NEW one; a band
  with no covering litho band is a true orphan → ``None``.
* Body level — a connected geotech body's litho parent BODY is taken from the
  SHALLOWEST member band that HAS a covering litho band; that covering band's
  own ``body_id`` is the answer (which may itself be ``None``). No member with a
  covering band → ``None``.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.geotech_litho_parent_links import (
    GeotechBodyMember,
    LithoBandInterval,
    covering_litho_band_id,
    geotech_body_litho_parent_id,
)

# Stable ids so the assertions read as identities, not opaque UUIDs.
CPT_A = UUID("00000000-0000-0000-0000-0000000000a1")
CPT_B = UUID("00000000-0000-0000-0000-0000000000b2")
LITHO_1 = UUID("00000000-0000-0000-0000-0000000011a1")
LITHO_2 = UUID("00000000-0000-0000-0000-0000000022a2")
LITHO_ON_B = UUID("00000000-0000-0000-0000-0000000033b3")


# ---------------------------------------------------------------------------
# Band level — the midpoint covering rule (rederive_geotech_parent_litho_layers)
# ---------------------------------------------------------------------------


def test_cm1_midpoint_inside_a_litho_band_takes_that_band() -> None:
    """A geotech band whose midpoint sits in a litho band takes that litho band.

    Band [2, 4) has midpoint 3.0, which falls inside litho band L1 [0, 5) on
    the same CPT → its ``parent_litho_layer_id`` is L1.
    """
    litho = [
        LithoBandInterval(
            layer_id=LITHO_1,
            cpt_id=CPT_A,
            borehole_id=None,
            depth_top_m=0.0,
            depth_base_m=5.0,
        ),
    ]
    assert (
        covering_litho_band_id(
            band_top_m=2.0,
            band_base_m=4.0,
            band_cpt_id=CPT_A,
            band_borehole_id=None,
            candidate_litho_bands=litho,
        )
        == LITHO_1
    )


def test_cm2_edited_band_is_re_derived_to_the_new_covering_litho_band() -> None:
    """A band whose covering litho band changed is re-derived to the new one.

    The litho column was re-cut: L1 now ends at 3.0 and L2 [3, 6) begins. The
    SAME geotech band [2, 4) (midpoint 3.0) now sits under L2, not L1. A
    re-derive is an overwrite, so it must return L2 — a fill-if-null heal would
    wrongly keep a stale L1.
    """
    litho = [
        LithoBandInterval(
            layer_id=LITHO_1, cpt_id=CPT_A, borehole_id=None, depth_top_m=0.0, depth_base_m=3.0
        ),
        LithoBandInterval(
            layer_id=LITHO_2, cpt_id=CPT_A, borehole_id=None, depth_top_m=3.0, depth_base_m=6.0
        ),
    ]
    assert (
        covering_litho_band_id(
            band_top_m=2.0,
            band_base_m=4.0,
            band_cpt_id=CPT_A,
            band_borehole_id=None,
            candidate_litho_bands=litho,
        )
        == LITHO_2
    )


def test_cm3_no_covering_litho_band_is_a_true_orphan_none() -> None:
    """A band whose midpoint is below every litho band on its column → ``None``.

    The geotech band [8, 10) (midpoint 9.0) is deeper than the only litho band
    [0, 5); nothing covers it, so the honest answer is ``None`` (a true orphan,
    the "No litho body" state reported as-is).
    """
    litho = [
        LithoBandInterval(
            layer_id=LITHO_1, cpt_id=CPT_A, borehole_id=None, depth_top_m=0.0, depth_base_m=5.0
        ),
    ]
    assert (
        covering_litho_band_id(
            band_top_m=8.0,
            band_base_m=10.0,
            band_cpt_id=CPT_A,
            band_borehole_id=None,
            candidate_litho_bands=litho,
        )
        is None
    )


def test_cm4_a_litho_band_on_another_investigation_never_matches() -> None:
    """A litho band that would cover the midpoint but sits on ANOTHER column is ignored.

    The band is on CPT_A; a litho band covering the same depth but anchored to
    CPT_B must not be its parent — the covering band is same-investigation only.
    """
    litho = [
        LithoBandInterval(
            layer_id=LITHO_ON_B, cpt_id=CPT_B, borehole_id=None, depth_top_m=0.0, depth_base_m=5.0
        ),
    ]
    assert (
        covering_litho_band_id(
            band_top_m=2.0,
            band_base_m=4.0,
            band_cpt_id=CPT_A,
            band_borehole_id=None,
            candidate_litho_bands=litho,
        )
        is None
    )


def test_cm5_midpoint_on_a_base_belongs_to_the_next_band_half_open() -> None:
    """The interval is half-open ``[top, base)``: a midpoint on a base is the next band.

    Midpoint 5.0 is NOT in L1 [0, 5) (base excluded) but IS in L2 [5, 9) — the
    same ``>= top AND < base`` semantics the SQL uses, so a band exactly on a
    litho contact resolves down, deterministically, never to both.
    """
    litho = [
        LithoBandInterval(
            layer_id=LITHO_1, cpt_id=CPT_A, borehole_id=None, depth_top_m=0.0, depth_base_m=5.0
        ),
        LithoBandInterval(
            layer_id=LITHO_2, cpt_id=CPT_A, borehole_id=None, depth_top_m=5.0, depth_base_m=9.0
        ),
    ]
    assert (
        covering_litho_band_id(
            band_top_m=4.0,
            band_base_m=6.0,
            band_cpt_id=CPT_A,
            band_borehole_id=None,
            candidate_litho_bands=litho,
        )
        == LITHO_2
    )


# ---------------------------------------------------------------------------
# Body level — shallowest covered member rule (restamp_geotech_parent_litho_bodies)
# ---------------------------------------------------------------------------

LITHO_BODY_SHALLOW = UUID("00000000-0000-0000-0000-00000000da01")
LITHO_BODY_DEEP = UUID("00000000-0000-0000-0000-00000000da02")
BAND_SHALLOW = UUID("00000000-0000-0000-0000-0000000000c1")
BAND_DEEP = UUID("00000000-0000-0000-0000-0000000000c2")


def test_gb1_shallowest_covered_member_supplies_the_body_litho_parent() -> None:
    """The body's litho parent is the SHALLOWEST covered member's litho body.

    Two covered members, different litho bodies; the shallower (depth_top 2.0)
    wins over the deeper (depth_top 6.0) → the body takes LITHO_BODY_SHALLOW.
    """
    members = [
        GeotechBodyMember(
            band_id=BAND_DEEP,
            depth_top_m=6.0,
            has_covering_litho_band=True,
            covering_litho_body_id=LITHO_BODY_DEEP,
        ),
        GeotechBodyMember(
            band_id=BAND_SHALLOW,
            depth_top_m=2.0,
            has_covering_litho_band=True,
            covering_litho_body_id=LITHO_BODY_SHALLOW,
        ),
    ]
    assert geotech_body_litho_parent_id(members) == LITHO_BODY_SHALLOW


def test_gb2_body_with_no_covering_member_is_none() -> None:
    """A body every member of which lacks a covering litho band → ``None``.

    This is the owner's honest "No litho body" bucket: nothing over the body
    resolves to an accepted litho band, so its ``parent_litho_body_id`` stays
    ``None`` rather than being invented.
    """
    members = [
        GeotechBodyMember(
            band_id=BAND_SHALLOW,
            depth_top_m=2.0,
            has_covering_litho_band=False,
            covering_litho_body_id=None,
        ),
        GeotechBodyMember(
            band_id=BAND_DEEP,
            depth_top_m=6.0,
            has_covering_litho_band=False,
            covering_litho_body_id=None,
        ),
    ]
    assert geotech_body_litho_parent_id(members) is None


def test_gb3_shallowest_covered_member_wins_even_when_its_litho_body_is_none() -> None:
    """Shallowest COVERED member wins even if its covering litho band has no body yet.

    The shallowest member has a covering litho band whose own ``body_id`` is
    ``None`` (that litho band is not yet resolved into a body); a deeper member
    has a real litho body. The shallowest still wins → ``None``, matching the
    resolver step 5b/6 rule (it never skips to a deeper member for a non-null).
    """
    members = [
        GeotechBodyMember(
            band_id=BAND_SHALLOW,
            depth_top_m=2.0,
            has_covering_litho_band=True,
            covering_litho_body_id=None,
        ),
        GeotechBodyMember(
            band_id=BAND_DEEP,
            depth_top_m=6.0,
            has_covering_litho_band=True,
            covering_litho_body_id=LITHO_BODY_DEEP,
        ),
    ]
    assert geotech_body_litho_parent_id(members) is None


def test_gb4_uncovered_members_are_skipped_for_the_shallowest_selection() -> None:
    """A member with no covering band is skipped; the shallowest COVERED one wins.

    The overall-shallowest member (depth_top 1.0) has no covering band, so it is
    ineligible; the shallowest member WITH a covering band (depth_top 6.0)
    supplies the body's litho parent.
    """
    members = [
        GeotechBodyMember(
            band_id=BAND_SHALLOW,
            depth_top_m=1.0,
            has_covering_litho_band=False,
            covering_litho_body_id=None,
        ),
        GeotechBodyMember(
            band_id=BAND_DEEP,
            depth_top_m=6.0,
            has_covering_litho_band=True,
            covering_litho_body_id=LITHO_BODY_DEEP,
        ),
    ]
    assert geotech_body_litho_parent_id(members) == LITHO_BODY_DEEP
