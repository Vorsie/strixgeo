"""Unit tests for contact-level auto-correlate (#133 Phase 2+3)."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.auto_correlate_contact_edges import (
    ContactRecord,
    InvestigationLocation,
    auto_correlate_contact_edges,
)


def _uid(n: int) -> UUID:
    """Deterministic UUID for fixtures.

    Parameters
    ----------
    n : int
        Integer seed.

    Returns
    -------
    UUID
        UUID built from ``n``.
    """
    return UUID(int=n)


def _make_contact(
    cid: int,
    inv_id: int,
    depth: float,
    parent: int,
    above: str,
    below: str | None,
    formation: int | None = None,
) -> ContactRecord:
    """Construct a ContactRecord from terse positional inputs.

    Parameters
    ----------
    cid : int
        Contact id seed.
    inv_id : int
        Investigation id seed.
    depth : float
        Depth top in metres.
    parent : int
        Parent formation id seed.
    above : str
        Lithology above the contact.
    below : str | None
        Lithology below the contact (None for deepest contact).
    formation : int | None
        Formation id seed.  Defaults to ``cid`` if omitted.

    Returns
    -------
    ContactRecord
        Constructed record.
    """
    return ContactRecord(
        contact_id=_uid(cid),
        formation_id=_uid(formation or cid),
        investigation_id=_uid(inv_id),
        depth_top_m=depth,
        parent_formation_id=_uid(parent),
        litho_main_soil_code=above,
        litho_below_code=below,
    )


def test_happy_path_three_columns_two_boundaries_each() -> None:
    """3 columns × 2 boundary groups produce ≥4 mutual correlation candidates.

    Each of the 2 boundary signatures (ZAND→KLEI at ~5 m, KLEI→SILT at
    ~10 m) appears at all 3 columns.  MNN across 3 column-pairs per
    group produces between 4 and 6 surviving pairs depending on
    tie-breaking dynamics; we assert ≥ 4 (the spanning tree) and that
    both groups are represented in the result.
    """
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 10, 10.0, 99, "KLEI", "SILT"),
        _make_contact(3, 11, 5.1, 99, "ZAND", "KLEI"),
        _make_contact(4, 11, 10.1, 99, "KLEI", "SILT"),
        _make_contact(5, 12, 5.2, 99, "ZAND", "KLEI"),
        _make_contact(6, 12, 10.2, 99, "KLEI", "SILT"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
        InvestigationLocation(_uid(12), 100.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) >= 4
    contact_ids = {c.contact_a_id for c in result} | {c.contact_b_id for c in result}
    assert _uid(1) in contact_ids or _uid(3) in contact_ids or _uid(5) in contact_ids
    assert _uid(2) in contact_ids or _uid(4) in contact_ids or _uid(6) in contact_ids


def test_boundary_signature_filter_rejects_different_below_litho() -> None:
    """Two contacts with same above-lithology but different below-lithology don't pair."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.0, 99, "ZAND", "SILT"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    assert auto_correlate_contact_edges(contacts, locations) == []


def test_null_below_litho_matches_only_other_nulls() -> None:
    """A deepest-contact (below=None) pairs only with another deepest-contact, not a ZAND→KLEI."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", None),
        _make_contact(2, 11, 5.1, 99, "ZAND", None),
        _make_contact(3, 12, 5.0, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
        InvestigationLocation(_uid(12), 100.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) == 1
    pair = result[0]
    assert {pair.contact_a_id, pair.contact_b_id} == {_uid(1), _uid(2)}


def test_distance_gate_rejects_far_pairs() -> None:
    """Two contacts more than MAX_COLUMN_DISTANCE_M apart never pair, even at identical depth."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.0, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 300.0, 0.0),
    ]
    assert auto_correlate_contact_edges(contacts, locations) == []


def test_mnn_tie_breaking_picks_exactly_one() -> None:
    """When two contacts on column B are equidistant from a column-A contact, MNN keeps exactly one."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.4, 99, "ZAND", "KLEI"),
        _make_contact(3, 11, 5.4, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) == 1
