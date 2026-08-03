"""The bundle registry is the one list every copy path reads.

These tests pin the two properties that make it trustworthy: it agrees
with the restore's own signature, and remapping a bundle onto new ids
carries every reference — wherever the reference lives.
"""

from __future__ import annotations

import inspect
from uuid import UUID

import pytest

from groundmodel.infrastructure.db.repositories.project_bundle.bundle_collections import (
    BUNDLE_COLLECTION_KEYS,
    BUNDLE_RESTORE_KWARGS,
    BundleRegistryError,
    assert_bundle_keys_registered,
    build_clone_id_map,
    collect_row_ids,
    count_rows_per_collection,
    remap_ids,
    sort_models_parents_first,
)
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_restore_core import (
    _restore_project_bundle_impl,
)

_SOURCE_PROJECT = UUID("11111111-1111-1111-1111-111111111111")
_NEW_PROJECT = UUID("22222222-2222-2222-2222-222222222222")


def test_every_registered_collection_is_a_parameter_the_restore_accepts() -> None:
    """A key nobody can pass to the restore is a key nothing copies."""
    accepted = set(inspect.signature(_restore_project_bundle_impl).parameters)
    unknown = sorted(kw for kw in BUNDLE_RESTORE_KWARGS.values() if kw not in accepted)
    assert not unknown, (
        f"BUNDLE_RESTORE_KWARGS names {unknown}, which _restore_project_bundle_impl "
        "does not accept — a copy path would pass them nowhere"
    )


def test_a_collection_the_bundle_carries_but_nobody_registered_is_refused() -> None:
    """Adding a table to the bundle without registering it must not go quiet."""
    bundle = {"format_version": 4, "project": {}} | {k: [] for k in BUNDLE_COLLECTION_KEYS}
    bundle["monitoring_series"] = []
    with pytest.raises(BundleRegistryError, match="monitoring_series"):
        assert_bundle_keys_registered(bundle)


def test_a_registered_collection_missing_from_the_bundle_is_refused() -> None:
    """The registry and the bundle must describe the same shape, both ways."""
    bundle = {"format_version": 4, "project": {}} | {k: [] for k in BUNDLE_COLLECTION_KEYS}
    del bundle["bodies"]
    with pytest.raises(BundleRegistryError, match="bodies"):
        assert_bundle_keys_registered(bundle)


def test_rows_are_counted_at_every_depth() -> None:
    """A borehole's child tree counts toward its collection, not nothing."""
    bundle = {k: [] for k in BUNDLE_COLLECTION_KEYS}
    bundle["boreholes"] = [
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "samples": [
                {
                    "id": "44444444-4444-4444-4444-444444444444",
                    "grain_sizes": [{"id": "55555555-5555-5555-5555-555555555555"}],
                }
            ],
        }
    ]
    assert count_rows_per_collection(bundle)["boreholes"] == 3


def test_a_json_blob_without_an_id_is_not_mistaken_for_a_row() -> None:
    """Vertex arrays and admixture descriptors are payload, not rows."""
    bundle = {k: [] for k in BUNDLE_COLLECTION_KEYS}
    bundle["geological_formations"] = [
        {
            "id": "66666666-6666-6666-6666-666666666666",
            "litho_admixtures": [{"soil_code": "ZS", "amount": "weinig"}],
        }
    ]
    bundle["litho_solids"] = [
        {"id": "77777777-7777-7777-7777-777777777777", "vertices": [[0.0, 1.0, 2.0]]}
    ]
    counts = count_rows_per_collection(bundle)
    assert counts["geological_formations"] == 1
    assert counts["litho_solids"] == 1


def test_a_reference_is_carried_wherever_it_lives() -> None:
    """FK column, UUID array element and JSON map key all follow the row."""
    formation_id = "88888888-8888-8888-8888-888888888888"
    section_id = "99999999-9999-9999-9999-999999999999"
    bundle = {k: [] for k in BUNDLE_COLLECTION_KEYS}
    bundle["geological_formations"] = [{"id": formation_id, "name": "Zand van Mol"}]
    bundle["cross_sections"] = [{"id": section_id, "seeded_formation_contact_ids": [formation_id]}]
    id_map = build_clone_id_map(
        bundle, source_project_id=_SOURCE_PROJECT, new_project_id=_NEW_PROJECT
    )
    lumping = {formation_id: {"group": "A"}}
    remapped = remap_ids({"collections": bundle, "lumping": lumping}, id_map)

    new_formation_id = id_map[formation_id]
    assert new_formation_id != formation_id
    assert remapped["collections"]["geological_formations"][0]["id"] == new_formation_id
    assert remapped["collections"]["cross_sections"][0]["seeded_formation_contact_ids"] == [
        new_formation_id
    ]
    assert list(remapped["lumping"]) == [new_formation_id]
    # A value that is not a row of this bundle is left alone — it points
    # somewhere outside the project and re-keying it would break it.
    assert remap_ids("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", id_map) == (
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    )


def test_an_upper_case_reference_is_re_keyed_like_any_other() -> None:
    """The same row written in upper case must not slip through unmapped.

    ``collect_row_ids`` canonicalises to lower case, so the fresh id is minted
    under the lower-case key. If the lookup asked for the RAW string, an
    upper-case occurrence would pass through untouched: the cloned row would
    keep the SOURCE primary key, the restore's insert-if-absent would skip it as
    already present, and the "copy" would silently share that row with the
    original — the one thing a copy may never do.
    """
    formation_id = "abcdef01-2345-6789-abcd-ef0123456789"
    shouting = formation_id.upper()
    bundle = {k: [] for k in BUNDLE_COLLECTION_KEYS}
    bundle["geological_formations"] = [{"id": shouting, "name": "Zand van Mol"}]
    bundle["cross_sections"] = [{"id": "99999999-9999-9999-9999-999999999999"}]
    id_map = build_clone_id_map(
        bundle, source_project_id=_SOURCE_PROJECT, new_project_id=_NEW_PROJECT
    )
    remapped = remap_ids(bundle, id_map)

    new_formation_id = id_map[formation_id]
    assert remapped["geological_formations"][0]["id"] == new_formation_id
    assert remapped["geological_formations"][0]["id"] not in (formation_id, shouting)


def test_the_project_id_itself_maps_onto_the_copy() -> None:
    """Any ``app_project_id`` riding in a payload must land on the copy."""
    bundle = {k: [] for k in BUNDLE_COLLECTION_KEYS}
    id_map = build_clone_id_map(
        bundle, source_project_id=_SOURCE_PROJECT, new_project_id=_NEW_PROJECT
    )
    assert id_map[str(_SOURCE_PROJECT)] == str(_NEW_PROJECT)


def test_collect_row_ids_normalises_case() -> None:
    """An upper-case UUID string is the same row as its lower-case form."""
    assert collect_row_ids([{"id": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"}]) == {
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    }


def test_a_parent_model_is_ordered_before_its_children() -> None:
    """The geotech model may not be inserted before the litho model it hangs from."""
    geo = {"id": "g", "parent_model_id": None}
    litho = {"id": "l", "parent_model_id": "g"}
    geotech = {"id": "t", "parent_model_id": "l"}
    ordered = sort_models_parents_first([geotech, litho, geo])
    assert [m["id"] for m in ordered] == ["g", "l", "t"]


def test_a_model_whose_parent_is_not_in_the_payload_counts_as_a_root() -> None:
    """A parent outside this project is not ours to order around."""
    orphan = {"id": "x", "parent_model_id": "somewhere-else"}
    root = {"id": "r", "parent_model_id": None}
    ordered = sort_models_parents_first([orphan, root])
    assert {m["id"] for m in ordered} == {"x", "r"}
