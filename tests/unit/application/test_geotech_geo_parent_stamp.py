"""The geological parent a hand-edited packing band carries is a DERIVED LABEL.

Owner, 2026-08-26: *"just drop the wall everywhere, user wil have to manually do
it"*. A geological line stopped being structure for the packing bands on that
date — the machine never cuts at one and the editor never refuses one — so a
band may now straddle a geological contact, which was structurally impossible
before.

That makes a question live that never had to be answered: WHICH geological
parent does a straddling band carry? The answer follows the A2 precedent
(``docs/domain-model.md``): geological attribution is a derived label, taken by
thickness-weighted majority. A band takes the parent of the side it has most of
its thickness in.

Reading the parent at the interval's TOP — the pre-2026-08-26 rule — would give
the shallower formation however little of the band lies in it. Before the
ruling, top and majority could never disagree (a band could not straddle);
after it, they disagree for every straddling band.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.application.geotech_band_edit_helpers import (
    GeotechColumnContext,
    geo_parent_for_interval,
)

GEO_UPPER = UUID(int=101)
GEO_LOWER = UUID(int=102)
LITHO = UUID(int=201)
BUILD_STAMP = UUID(int=999)


def _context(
    geo_contacts: tuple[tuple[float, UUID], ...],
    source_geo_formation_id: UUID | None = BUILD_STAMP,
) -> GeotechColumnContext:
    """A column context carrying only what the stamp rule reads."""
    return GeotechColumnContext(
        project_id=UUID(int=1),
        geotech_model_id=UUID(int=2),
        investigation_id=UUID(int=3),
        anchor_is_cpt=True,
        bands=(),
        band_rows={},
        soil="ZAND",
        admixtures=(),
        depth_m=[],
        qc_mpa=[],
        min_thickness_m=0.35,
        statistic="median",
        source_litho_formation_id=LITHO,
        source_geo_formation_id=source_geo_formation_id,
        geo_contacts=geo_contacts,
    )


def test_gp1_a_band_wholly_inside_one_geological_unit_takes_that_unit() -> None:
    """GP1 — the ordinary case: no contact inside the band, one obvious parent."""
    context = _context(((2.0, GEO_UPPER), (8.0, GEO_LOWER)))

    assert geo_parent_for_interval(context, 3.0, 5.0) == GEO_UPPER


def test_gp2_a_straddling_band_takes_the_parent_of_its_thicker_side() -> None:
    """GP2 — most of the band lies BELOW the contact, so it reads as the lower unit.

    The contact sits at 4.00 m in a band running 3.00-9.00 m: 1.00 m above,
    5.00 m below. Reading the top would call this band the upper formation on
    the strength of one sixth of its thickness.
    """
    context = _context(((4.0, GEO_LOWER),))

    assert geo_parent_for_interval(context, 3.0, 9.0) == GEO_LOWER


def test_gp3_a_straddling_band_mostly_above_the_contact_keeps_the_upper_unit() -> None:
    """GP3 — the mirror of GP2: majority above, so the upper unit wins."""
    context = _context(((2.0, GEO_UPPER), (8.0, GEO_LOWER)))

    assert geo_parent_for_interval(context, 3.0, 9.0) == GEO_UPPER


def test_gp4_a_band_above_the_first_contact_carries_no_geological_parent() -> None:
    """GP4 — ``None`` is the open shallow band, not "unknown"."""
    context = _context(((6.0, GEO_LOWER),))

    assert geo_parent_for_interval(context, 0.0, 2.0) is None


def test_gp5_a_contact_exactly_at_the_midpoint_resolves_to_the_lower_unit() -> None:
    """GP5 — an exact tie is broken downward, and it is broken the same way every time.

    A 50/50 straddle has no majority. The tie-break follows the ground: a
    geological contact is a TOP, so the deeper unit owns everything from its top
    down, and a band that reaches into it by exactly half is claimed by it. The
    value matters less than its being deterministic — an undefined tie-break
    would make the stamp flicker between two runs on identical data.
    """
    context = _context(((5.0, GEO_LOWER),))

    assert geo_parent_for_interval(context, 3.0, 7.0) == GEO_LOWER


def test_gp6_without_a_geological_model_the_build_time_stamp_is_kept() -> None:
    """GP6 — no live contacts (a litho model with no geological parent): carry the stamp."""
    context = _context(())

    assert geo_parent_for_interval(context, 3.0, 9.0) == BUILD_STAMP


def test_gp7_the_stamp_never_refuses_an_edit() -> None:
    """GP7 — a straddling band still RESOLVES; the rule labels, it never raises.

    The whole point of the 2026-08-26 ruling is that a geological line costs the
    engineer nothing. A stamp rule that could not answer for a straddling band
    would reintroduce the wall through the back door.
    """
    context = _context(((4.0, GEO_UPPER), (5.0, GEO_LOWER)))

    # Two contacts inside one band — the messiest shape the editor can produce.
    assert geo_parent_for_interval(context, 3.0, 9.0) == GEO_LOWER
