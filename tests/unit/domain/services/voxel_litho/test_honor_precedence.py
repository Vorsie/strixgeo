"""Behavioural tests for which investigation wins a shared voxel column.

The rule, in the modelling vocabulary (full evidence in ``docs/debt.md`` #241):

* a CPT beats a borehole — the driller's descriptions are logged on a 0.5 m
  grid, so a borehole contact depth is only known to the nearest half metre,
  while a cone registers depth continuously and resolves 3-4x more contacts;
* between two tests of the SAME kind, the one that reached deeper wins;
* a remaining tie falls to the lower investigation id, so a build is
  reproducible — on real data it is never reached.
"""

from __future__ import annotations

from groundmodel.domain.services.investigation_kind_constants import (
    KIND_BOREHOLE,
    KIND_CPT,
)
from groundmodel.domain.services.voxel_litho.honor_precedence import honor_rank
from groundmodel.domain.services.voxel_litho.voxel_types import InvestigationColumn


def _column(inv_id: str, kind: str, base_elev: float) -> InvestigationColumn:
    """An investigation column with one interval reaching down to ``base_elev``."""
    return InvestigationColumn(
        investigation_id=inv_id,
        world_x=0.0,
        world_y=0.0,
        intervals=(("body-1", "KLEI", 10.0, base_elev),),
        kind=kind,
    )


def test_a_cpt_wins_the_column_over_a_borehole() -> None:
    """The cone's continuously registered depths beat the 0.5 m driller's log."""
    cpt = _column("bbb", KIND_CPT, -10.0)
    borehole = _column("aaa", KIND_BOREHOLE, -10.0)

    assert honor_rank(cpt) < honor_rank(borehole)


def test_a_cpt_wins_even_when_the_borehole_reached_deeper() -> None:
    """Kind decides before depth — depth only separates tests of the same kind."""
    cpt = _column("bbb", KIND_CPT, -5.0)
    deeper_borehole = _column("aaa", KIND_BOREHOLE, -30.0)

    assert honor_rank(cpt) < honor_rank(deeper_borehole)


def test_between_two_cpts_the_deeper_one_wins() -> None:
    """Same kind: the test that reached further down describes more of the column."""
    shallow = _column("aaa", KIND_CPT, -5.0)
    deep = _column("zzz", KIND_CPT, -20.0)

    assert honor_rank(deep) < honor_rank(shallow)


def test_between_two_boreholes_the_deeper_one_wins() -> None:
    """The same depth rule applies within the borehole kind."""
    shallow = _column("aaa", KIND_BOREHOLE, -5.0)
    deep = _column("zzz", KIND_BOREHOLE, -20.0)

    assert honor_rank(deep) < honor_rank(shallow)


def test_an_exact_tie_is_broken_reproducibly_by_id() -> None:
    """Same kind and same depth must still pick the same winner every build."""
    first = _column("aaa", KIND_CPT, -10.0)
    second = _column("bbb", KIND_CPT, -10.0)

    assert honor_rank(first) < honor_rank(second)


def test_the_ranking_is_a_total_order_so_three_contenders_fold_either_way() -> None:
    """A cell holding three tests resolves the same whatever order they arrive in.

    The GEO-23/125 S5 / S5A / S5B cluster is three tests; the running comparison
    in ``label_voxels`` must not depend on which one it happens to see first.
    """
    borehole = _column("aaa", KIND_BOREHOLE, -30.0)
    shallow_cpt = _column("bbb", KIND_CPT, -5.0)
    deep_cpt = _column("ccc", KIND_CPT, -20.0)

    for order in (
        (borehole, shallow_cpt, deep_cpt),
        (deep_cpt, shallow_cpt, borehole),
        (shallow_cpt, borehole, deep_cpt),
        (borehole, deep_cpt, shallow_cpt),
    ):
        winner = min(order, key=honor_rank)
        assert winner is deep_cpt, [column.investigation_id for column in order]


def test_a_column_with_no_observed_log_never_wins() -> None:
    """Nothing to honour → it must not take a column off a test that has a log."""
    empty = InvestigationColumn(
        investigation_id="aaa", world_x=0.0, world_y=0.0, intervals=(), kind=KIND_CPT
    )
    logged = _column("zzz", KIND_BOREHOLE, -1.0)

    assert honor_rank(logged) < honor_rank(empty)


def test_an_unrecognised_kind_never_outranks_a_cone() -> None:
    """A future investigation type must not silently take a column from a CPT.

    Only ``cpt`` and ``borehole`` anchor a litho layer today.  When a new kind
    appears the build must keep working, but the new kind has to be placed in
    the order deliberately rather than inheriting a winning position.
    """
    cone = _column("zzz", KIND_CPT, -1.0)
    newcomer = _column("aaa", "pressuremeter", -50.0)

    assert honor_rank(cone) < honor_rank(newcomer)
