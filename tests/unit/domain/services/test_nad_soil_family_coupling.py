"""The soil-family / NAD-class coupling, as an invariant.

Owner ruling 2026-08-26, verbatim: *"no a zand body can never carry a silt
packing class"*, reinforced the same day with *"the nad coupling is
absolute."*

Generalised: a geotech unit's NAD packing class MUST belong to the soil family
of the litho unit it subdivides — GRAVEL 1-4, SAND 5-12, SILT 13-20, CLAY
21-28, PEAT 29-31. The classifier module has said this in prose since it was
written ("Lithology is hard truth: qc never promotes or demotes a unit across
soil types"); these pins make it a mechanical fact that every writer can ask
about and that no future change can quietly drop.

Claims pinned here:
  NF1  Every one of the 31 classes names exactly one soil family, and the
       answer is the norm table's own.
  NF2  Across the whole 31 x 5 grid, a class belongs to a soil if and only if
       it is that soil's own class — no near-miss, no rank equivalence.
  NF3  The two tables that both encode the coupling (``NAD_CLASSES``, the
       canonical class -> soil map, and ``NAD_QC_BANDS``, the classifier's
       thresholds) never disagree about which soil owns a class.
  NF4  "Not yet classified" is never a violation — a band with no class has
       nothing to be out of family with.
  NF5  A soil the norm table does not know cannot convict a class: the
       coupling is checked against a family, and where there is no family
       there is nothing to check.
  NF6  The clamp answers with the class or with nothing. It never answers
       with a DIFFERENT class — an estimate that crosses a soil family is not
       data for that soil, so there is no same-rank substitute to reach for.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.nad_classification_constants import NAD_QC_BANDS
from groundmodel.domain.services.nad_classifier import (
    clamp_class_to_soil,
    class_belongs_to_soil,
    soil_family_of,
)
from groundmodel.shared.constants.litho_constants import (
    BASE_LITHOLOGIES,
    NAD_CLASS_MAX,
    NAD_CLASS_MIN,
    NAD_CLASSES,
)

# ---------------------------------------------------------------------------
# NF1 — every class names one family
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("nad_class", sorted(NAD_CLASSES))
def test_nf1_every_class_names_the_norm_tables_own_soil(nad_class: int) -> None:
    """NF1 — the family of a class is the one the norm table prints for it."""
    assert soil_family_of(nad_class) == NAD_CLASSES[nad_class][1]


def test_nf1_the_five_families_partition_all_31_classes() -> None:
    """NF1 — no class is family-less and no class is in two families."""
    covered = {n for n in range(NAD_CLASS_MIN, NAD_CLASS_MAX + 1) if soil_family_of(n) is not None}
    assert covered == set(range(NAD_CLASS_MIN, NAD_CLASS_MAX + 1))
    assert {soil_family_of(n) for n in covered} == set(BASE_LITHOLOGIES)


@pytest.mark.parametrize("outside", [0, 32, -1, 999])
def test_nf1_a_number_outside_the_table_names_no_family(outside: int) -> None:
    """NF1 — a class number the norm never printed is not silently adopted."""
    assert soil_family_of(outside) is None


# ---------------------------------------------------------------------------
# NF2 — the whole grid, exhaustively
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("soil", sorted(BASE_LITHOLOGIES))
@pytest.mark.parametrize("nad_class", sorted(NAD_CLASSES))
def test_nf2_a_class_belongs_to_its_own_soil_and_to_no_other(nad_class: int, soil: str) -> None:
    """NF2 — "a zand body can never carry a silt packing class", for all 155 pairs."""
    own_soil = NAD_CLASSES[nad_class][1]
    assert class_belongs_to_soil(nad_class, soil) is (soil == own_soil)


def test_nf2_the_owners_own_case_is_refused() -> None:
    """NF2 — the case he named: NAD 14 is a SILT class, so ZAND cannot carry it."""
    assert soil_family_of(14) == "SILT"
    assert class_belongs_to_soil(14, "ZAND") is False
    assert clamp_class_to_soil(14, "ZAND") is None


# ---------------------------------------------------------------------------
# NF3 — the two tables agree
# ---------------------------------------------------------------------------


def test_nf3_the_threshold_table_and_the_name_table_agree_on_every_family() -> None:
    """NF3 — the classifier's thresholds can only ever emit own-family classes."""
    for (table_soil, _variant), bands in NAD_QC_BANDS.items():
        for _threshold, nad_class in bands:
            assert soil_family_of(nad_class) == table_soil, (
                f"NAD_QC_BANDS[{table_soil}] can emit class {nad_class}, "
                f"which NAD_CLASSES calls {soil_family_of(nad_class)}"
            )


# ---------------------------------------------------------------------------
# NF4 / NF5 — what the coupling does NOT convict
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("soil", [*sorted(BASE_LITHOLOGIES), None, "SCHIST"])
def test_nf4_an_unclassified_band_is_never_a_violation(soil: str | None) -> None:
    """NF4 — no class means nothing to be out of family with; the clamp holds."""
    assert class_belongs_to_soil(None, soil) is True
    assert clamp_class_to_soil(None, soil) is None


@pytest.mark.parametrize("unknown_soil", [None, "", "SCHIST", "zand"])
def test_nf5_a_soil_with_no_family_cannot_convict_a_class(unknown_soil: str | None) -> None:
    """NF5 — the coupling is checked against a family; no family, no check.

    A litho unit whose soil code the norm table does not know has no NAD
    column at all, so nothing here is evidence that its class is foreign.
    Those units are already refused a machine class upstream (they fall to a
    skeleton); this pin keeps the clamp from ALSO wiping a class an engineer
    set by hand on one.
    """
    assert class_belongs_to_soil(6, unknown_soil) is True
    assert clamp_class_to_soil(6, unknown_soil) == 6


# ---------------------------------------------------------------------------
# NF6 — no rank mapping
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("soil", sorted(BASE_LITHOLOGIES))
@pytest.mark.parametrize("nad_class", sorted(NAD_CLASSES))
def test_nf6_the_clamp_answers_the_class_itself_or_nothing(nad_class: int, soil: str) -> None:
    """NF6 — a foreign class becomes NO class, never the same rank in this soil.

    "SILT, moderately firm" is not evidence that a sand is medium dense; it is
    evidence about a silt somewhere else. The honest answer for the sand is
    that nothing has classified it yet.
    """
    answer = clamp_class_to_soil(nad_class, soil)
    assert answer in (nad_class, None)
    assert answer is None or soil_family_of(answer) == soil
