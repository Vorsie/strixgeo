"""Unit tests for ``infer_age_order`` — per-investigation toposort."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.formation_age_order import infer_age_order


def _fid(suffix: str) -> UUID:
    """Build a stable test UUID from a short suffix."""
    return UUID(f"00000000-0000-0000-0000-{suffix:>012}")


ANTROPOGEEN = _fid("000001")
QUARTAIR = _fid("000002")
AALBEKE = _fid("000003")
ROUBAIX = _fid("000004")
BOOM = _fid("000005")
# Sorts AFTER Quartair by UUID string, so the tie-break alone would put Quartair on top.
GEROERD = _fid("000009")
BH_X = UUID("00000000-0000-0000-0000-0000000000a1")
BH_Y = UUID("00000000-0000-0000-0000-0000000000a2")
CPT_Z = UUID("00000000-0000-0000-0000-0000000000b1")


def test_single_anchor_orders_shallowest_first_youngest() -> None:
    """One borehole sees Antropogeen at 0.5 m, Quartair at 3 m,
    Roubaix at 21 m — the result is youngest-first, the natural
    top-down stratigraphic column.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [
                (0.5, ANTROPOGEEN),
                (3.0, QUARTAIR),
                (21.0, ROUBAIX),
            ],
        },
        all_formation_ids=[ANTROPOGEEN, QUARTAIR, ROUBAIX],
    )
    assert order == [ANTROPOGEEN, QUARTAIR, ROUBAIX]


def test_consistent_anchors_produce_unique_topo_order() -> None:
    """Two anchors agree on the stratigraphy → unambiguous toposort."""
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [
                (0.5, ANTROPOGEEN),
                (3.0, QUARTAIR),
                (13.0, AALBEKE),
            ],
            BH_Y: [
                (0.4, ANTROPOGEEN),
                (12.5, AALBEKE),
                (20.0, ROUBAIX),
            ],
        },
        all_formation_ids=[ANTROPOGEEN, QUARTAIR, AALBEKE, ROUBAIX],
    )
    # Combined evidence: Antropogeen < Quartair < Aalbeke < Roubaix
    assert order == [ANTROPOGEEN, QUARTAIR, AALBEKE, ROUBAIX]


def test_user_creation_order_is_irrelevant() -> None:
    """The user's creation order shouldn't bias the result. Passing
    ``all_formation_ids`` in reverse still produces a data-driven order.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [
                (0.5, ANTROPOGEEN),
                (3.0, QUARTAIR),
                (13.0, AALBEKE),
                (21.0, ROUBAIX),
            ],
        },
        # Reverse: oldest first — function must ignore this.
        all_formation_ids=[ROUBAIX, AALBEKE, QUARTAIR, ANTROPOGEEN],
    )
    assert order == [ANTROPOGEEN, QUARTAIR, AALBEKE, ROUBAIX]


def test_orphans_without_contacts_appended_in_uuid_order() -> None:
    """Formations with zero contacts in any anchor are appended at
    the end, sorted by UUID for determinism.
    """
    UNUSED_A = _fid("ffff01")
    UNUSED_B = _fid("ffff02")
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [
                (0.5, ANTROPOGEEN),
                (21.0, ROUBAIX),
            ],
        },
        all_formation_ids=[ANTROPOGEEN, ROUBAIX, UNUSED_B, UNUSED_A],
    )
    assert order == [ANTROPOGEEN, ROUBAIX, UNUSED_A, UNUSED_B]


def test_mean_depth_tiebreaker_when_no_pair_evidence() -> None:
    """Two formations each appear on different anchors with no
    overlapping anchor (no direct pair edge). The mean-depth tiebreak
    orders the shallower-mean one first.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [(0.5, ANTROPOGEEN), (3.0, QUARTAIR)],
            BH_Y: [(13.0, AALBEKE), (20.0, ROUBAIX)],
        },
        all_formation_ids=[ANTROPOGEEN, QUARTAIR, AALBEKE, ROUBAIX],
    )
    # Antropogeen-Quartair partial: Antropogeen < Quartair.
    # Aalbeke-Roubaix partial: Aalbeke < Roubaix.
    # Cross-pair has no edge — mean-depth tiebreak:
    # Antropogeen=0.5 < Quartair=3 < Aalbeke=13 < Roubaix=20.
    assert order == [ANTROPOGEEN, QUARTAIR, AALBEKE, ROUBAIX]


def test_contradictory_anchors_majority_wins() -> None:
    """Two anchors say 'A above B', one anchor (overturned strata,
    say) says 'B above A'. Majority direction wins.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [(0.5, ANTROPOGEEN), (5.0, QUARTAIR)],
            BH_Y: [(0.4, ANTROPOGEEN), (5.5, QUARTAIR)],
            CPT_Z: [(0.5, QUARTAIR), (5.0, ANTROPOGEEN)],  # inverted
        },
        all_formation_ids=[ANTROPOGEEN, QUARTAIR],
    )
    # 2 votes Antropogeen→Quartair vs 1 vote Quartair→Antropogeen.
    # Majority wins → Antropogeen younger, Quartair older.
    assert order == [ANTROPOGEEN, QUARTAIR]


def test_anchor_with_single_contact_contributes_no_pair_edge() -> None:
    """An anchor with only one contact gives no pair — but its depth
    still informs the mean-depth tiebreaker.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [(0.5, ANTROPOGEEN), (3.0, QUARTAIR)],
            BH_Y: [(15.0, AALBEKE)],  # single contact, mean-depth only
        },
        all_formation_ids=[ANTROPOGEEN, QUARTAIR, AALBEKE],
    )
    # Antropogeen→Quartair via BH_X.
    # Aalbeke unpaired but mean depth 15 > 3 > 0.5 → comes last.
    assert order == [ANTROPOGEEN, QUARTAIR, AALBEKE]


def test_empty_input_returns_empty_list() -> None:
    """No anchors, no formations → empty."""
    assert infer_age_order(contacts_by_anchor={}, all_formation_ids=[]) == []


def test_antropogeen_is_always_youngest_when_present() -> None:
    """Ruling (owner, 2026-09-05): Antropogeen is the youngest formation
    whenever it is present, regardless of which boreholes log it.

    Here no borehole logs both Antropogeen and Pleistoceen (Quartair),
    and Antropogeen's observed top (5.0 m) is DEEPER than Pleistoceen's
    (0.5 m) — so the shallowest-observed-top tie-break alone would place
    Pleistoceen first. The anthropogenic pin must still put Antropogeen
    at the youngest end.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [(5.0, ANTROPOGEEN), (12.0, ROUBAIX)],
            BH_Y: [(0.5, QUARTAIR), (9.0, AALBEKE)],
        },
        all_formation_ids=[ANTROPOGEEN, QUARTAIR, AALBEKE, ROUBAIX],
        labels_by_formation={
            ANTROPOGEEN: "Antropogeen",
            QUARTAIR: "Pleistoceen",
            AALBEKE: "Aalbeke",
            ROUBAIX: "Roubaix",
        },
    )
    # result[0] is the youngest — Antropogeen, even though its mean top
    # is deeper than Pleistoceen's.
    assert order[0] == ANTROPOGEEN


def test_antropogeen_is_youngest_even_as_an_orphan() -> None:
    """Ruling corollary: "whenever it is present" includes an Antropogeen
    formation with no contacts on any borehole (an orphan). It must still
    be pinned youngest rather than appended at the oldest end.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [(0.5, QUARTAIR), (12.0, ROUBAIX)],
        },
        all_formation_ids=[ANTROPOGEEN, QUARTAIR, ROUBAIX],
        labels_by_formation={
            ANTROPOGEEN: "Antropogeen",
            QUARTAIR: "Pleistoceen",
            ROUBAIX: "Roubaix",
        },
    )
    assert order[0] == ANTROPOGEEN


def test_formations_never_sharing_a_borehole_order_by_shallowest_top() -> None:
    """Ruling (owner, 2026-09-05): two formations that never share a
    borehole keep their relative order by the shallowest observed top —
    the shallower one is younger. No anthropogenic unit here, so only the
    data-driven tie-break decides.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [(0.5, QUARTAIR), (11.0, ROUBAIX)],
            BH_Y: [(3.0, AALBEKE), (11.0, ROUBAIX)],
        },
        all_formation_ids=[QUARTAIR, AALBEKE, ROUBAIX],
    )
    # Quartair (top 0.5) and Aalbeke (top 3.0) never co-occur; both sit
    # above Roubaix on their own borehole. Shallower top = younger, so
    # Quartair precedes Aalbeke, both before Roubaix.
    assert order == [QUARTAIR, AALBEKE, ROUBAIX]


def test_deterministic_under_identical_input() -> None:
    """Running the algorithm twice on the same input gives the same
    list — important for bundle reproducibility.
    """
    payload = {
        BH_X: [(0.5, ANTROPOGEEN), (3.0, QUARTAIR), (21.0, ROUBAIX)],
        BH_Y: [(0.4, ANTROPOGEEN), (12.0, AALBEKE)],
    }
    ids = [ANTROPOGEEN, QUARTAIR, AALBEKE, ROUBAIX]
    a = infer_age_order(contacts_by_anchor=payload, all_formation_ids=ids)
    b = infer_age_order(contacts_by_anchor=payload, all_formation_ids=ids)
    assert a == b


def test_dov_disturbed_group_code_g_is_youngest_when_present() -> None:
    """Owner 2026-09-23, a new project built from DOV boreholes: "it reordered
    the formations but in a wrong manner! put aangebracht geroerd below
    quartair". DOV's formal-stratigraphy code ``G`` ("Groep van geroerd/
    verstoord", reworked / disturbed ground) is the man-made top of the
    column, the same thing as Antropogeen. No borehole logged both G and Q
    (each column starts with one of them at 0 m), so no vote ordered them,
    both mean tops were 0 m, and the UUID tie-break put Quartair on top. The
    anthropogenic pin must recognise G.
    """
    order = infer_age_order(
        contacts_by_anchor={
            BH_X: [(0.0, GEROERD), (12.0, BOOM)],
            BH_Y: [(0.0, QUARTAIR), (10.8, BOOM)],
        },
        all_formation_ids=[GEROERD, QUARTAIR, BOOM],
        labels_by_formation={GEROERD: "G", QUARTAIR: "Q", BOOM: "Bm"},
    )
    assert order == [GEROERD, QUARTAIR, BOOM]


def test_dov_disturbed_group_by_name_is_youngest_when_present() -> None:
    """The same pin by DOV's full name, for a formation that carries no code."""
    order = infer_age_order(
        contacts_by_anchor={BH_X: [(0.0, GEROERD)], BH_Y: [(0.0, QUARTAIR)]},
        all_formation_ids=[GEROERD, QUARTAIR],
        labels_by_formation={
            GEROERD: "Groep van geroerd/verstoord",
            QUARTAIR: "Groep van Quartaire afzetting",
        },
    )
    assert order[0] == GEROERD
