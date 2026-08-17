"""One correlation per contact, decided before anything is written.

Owner, 2026-08-17, on hops still appearing where he had already correlated:
*"how about you put a safeguard: put litho ties first, if a contact already has
a tie it can't get a second tie for step 4"* — and then, on the first attempt at
it: *"why prune instead of no emit? sounds like bad coding"*, *"don't create
stuff you'll delete after anyways, useless computations"*.

So the cap is applied where the hops are DECIDED.  A contact is one surface of
one band — a ``(layer, side)`` pair.  Seeding the taken set from the ties that
already exist is what makes "litho first" true, and a hop that may not exist is
never written at all.
"""

from uuid import UUID

from groundmodel.domain.services.geotech_edge_dedup import HopCandidate, hops_to_emit

BH_TOP = (UUID(int=10), "top")
BH_BASE = (UUID(int=10), "base")
S13_TOP = (UUID(int=11), "top")
B6_TOP = (UUID(int=12), "top")
FAR_TOP = (UUID(int=13), "top")


def test_ot1_a_hop_is_not_written_onto_an_already_correlated_contact() -> None:
    """His correlation stands, and step 4 does not join it."""
    taken = {BH_TOP}
    assert hops_to_emit([HopCandidate(BH_TOP, S13_TOP, 3.7)], taken_contacts=taken) == []


def test_ot2_a_bare_contact_still_gets_its_hop() -> None:
    """The cap is one, not zero — a borehole bands where nothing objects."""
    taken: set[tuple[UUID, str]] = set()
    assert hops_to_emit([HopCandidate(BH_TOP, S13_TOP, 3.7)], taken_contacts=taken) == [0]
    assert taken == {BH_TOP, S13_TOP}


def test_ot3_two_hops_competing_for_one_contact_keep_the_flatter() -> None:
    """The hop that jumps 14 m loses to the one that jumps 3.5 m.

    Both are guesses; the flatter is the less extravagant one, and the steep
    jumps are what he circled on the section.
    """
    steep = HopCandidate(BH_TOP, FAR_TOP, 14.0)
    flat = HopCandidate(BH_TOP, B6_TOP, 3.5)
    assert hops_to_emit([steep, flat], taken_contacts=set()) == [1]


def test_ot4_the_two_sides_of_a_band_are_different_contacts() -> None:
    """A top hop and a base hop do not compete: separate surfaces."""
    emitted = hops_to_emit(
        [HopCandidate(BH_TOP, S13_TOP, 3.7), HopCandidate(BH_BASE, B6_TOP, 2.0)],
        taken_contacts=set(),
    )
    assert emitted == [0, 1]


def test_ot5_the_far_contact_counts_too() -> None:
    """A hop whose PARTNER contact is already correlated is not written either."""
    assert hops_to_emit([HopCandidate(BH_TOP, S13_TOP, 3.7)], taken_contacts={S13_TOP}) == []


def test_ot6_emission_order_is_the_candidates_own_order() -> None:
    """Ranking decides WHICH survive; the caller still writes in its own order."""
    emitted = hops_to_emit(
        [HopCandidate(BH_TOP, S13_TOP, 9.0), HopCandidate(BH_BASE, B6_TOP, 1.0)],
        taken_contacts=set(),
    )
    assert emitted == [0, 1]


def test_ot7_nothing_is_written_for_no_candidates() -> None:
    """The ordinary model, where the litho ties already say everything."""
    assert hops_to_emit([], taken_contacts=set()) == []


def test_ot8_a_correlated_cpt_contact_does_not_block_the_hop() -> None:
    """A CPT contact is routinely tied left AND right — that is how a band spans.

    Capping it refused every borehole hop in the model (nine integration
    scenarios lost their chain), so the cap governs only the column step 4 is
    deriving: the borehole.
    """
    candidate = HopCandidate(BH_TOP, S13_TOP, 3.7, cap_a=True, cap_b=False)
    assert hops_to_emit([candidate], taken_contacts={S13_TOP}) == [0]


def test_ot9_the_borehole_contact_still_blocks_it() -> None:
    """His litho restatement on the borehole's own contact is what step 4 obeys."""
    candidate = HopCandidate(BH_TOP, S13_TOP, 3.7, cap_a=True, cap_b=False)
    assert hops_to_emit([candidate], taken_contacts={BH_TOP}) == []
