"""A mapped donor stack respects the model's minimum band thickness.

Owner, 2026-08-17: *"just respect minimum thickness and the cpt bands"*.

Mapping a donor's packing onto a borehole rescales it to the borehole's own
unit thickness, so a thin unit receives a compressed copy of the donor's
structure.  On his B5 a 0.465 m tail received SEVEN sub-bands — 2 cm to 19 cm —
which is not a model of anything; the geotech minimum thickness (0.35 m by
default) exists to stop exactly that.

Where bands must merge, the survivor takes the LOOSEST class of the merged run.
That is not a new rule: *"absorbing may never silently make a band denser"*
(his ruling of 2026-08-11, audit F05).  A sub-minimum band absorbed INTO a band
that stands on its own is a different case — it ceases to be a band at all,
because below the minimum it was never one, and the surviving band keeps its
own class.
"""

from groundmodel.application.divide_boreholes import coarsen_to_minimum_thickness
from groundmodel.domain.services.borehole_packing_fill import FillBand

MIN = 0.35
_MD, _D, _VD = 6, 7, 8


def _band(top: float, base: float, nad: int) -> FillBand:
    """One mapped band."""
    return FillBand(top=top, base=base, nad_class=nad, source="cpt_interpolated")


def _out(bands: list[FillBand]) -> list[tuple[float, float, int]]:
    return [
        (round(b.top, 3), round(b.base, 3), b.nad_class)
        for b in coarsen_to_minimum_thickness(bands, minimum_thickness_m=MIN)
    ]


def test_mt1_his_b5_tail_becomes_one_band_at_the_loosest_class() -> None:
    """Seven sub-bands in 0.465 m — none of them a band — become one.

    The whole interval is barely over the minimum, so it can hold exactly one
    band, and that band must not be denser than its loosest constituent.
    """
    assert _out(
        [
            _band(18.035, 18.133, _MD),
            _band(18.133, 18.169, _D),
            _band(18.169, 18.192, _MD),
            _band(18.192, 18.231, _D),
            _band(18.231, 18.276, _MD),
            _band(18.276, 18.467, _VD),
            _band(18.467, 18.500, _MD),
        ]
    ) == [(18.035, 18.5, _MD)]


def test_mt2_a_sliver_beside_a_real_band_is_absorbed_into_it() -> None:
    """Below the minimum it was never a band, so the neighbour keeps its class.

    A 5 cm loose lens inside 2 m of very dense sand is under the model's
    resolution; reporting 2 m of loose sand because of it would be the tail
    wagging the dog.
    """
    assert _out([_band(0.0, 0.05, _MD), _band(0.05, 2.05, _VD)]) == [(0.0, 2.05, _VD)]


def test_mt3_bands_that_all_stand_are_untouched() -> None:
    """The ordinary case must pass through byte for byte."""
    bands = [_band(6.0, 7.59, _MD), _band(7.59, 8.43, _D)]
    assert _out(bands) == [(6.0, 7.59, _MD), (7.59, 8.43, _D)]


def test_mt4_a_unit_thinner_than_the_minimum_is_one_band() -> None:
    """Nothing can be honoured, so the whole unit reads its loosest class."""
    assert _out([_band(0.0, 0.1, _VD), _band(0.1, 0.2, _MD)]) == [(0.0, 0.2, _MD)]


def test_mt5_adjacent_bands_of_one_class_coalesce() -> None:
    """A merge must not leave two rows saying the same thing."""
    assert _out([_band(0.0, 1.0, _MD), _band(1.0, 1.02, _D), _band(1.02, 2.0, _MD)]) == [
        (0.0, 2.0, _MD)
    ]


def test_mt6_a_single_band_is_returned_whatever_its_thickness() -> None:
    """There is nothing to merge with, and dropping it would leave a void."""
    assert _out([_band(0.0, 0.01, _VD)]) == [(0.0, 0.01, _VD)]


def test_mt7_no_band_is_lost_and_the_extent_still_tiles() -> None:
    """The contiguity invariant the DB trigger enforces survives the merge."""
    out = _out(
        [
            _band(0.0, 0.4, _MD),
            _band(0.4, 0.45, _VD),
            _band(0.45, 0.9, _D),
            _band(0.9, 0.92, _MD),
            _band(0.92, 1.5, _VD),
        ]
    )
    assert out[0][0] == 0.0
    assert out[-1][1] == 1.5
    assert all(a[1] == b[0] for a, b in zip(out, out[1:]))
