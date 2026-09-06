"""Canonical registry of the bundle's child collections, plus id remapping.

Why this module exists
----------------------
Several write paths used to enumerate the project's child tables by hand,
and every one of them was a single forgotten branch away from dropping a
collection in silence.  ``ProjectRepository.duplicate`` actually did: it
cloned the CPTs and the boreholes and left the entire three-level
interpretation — formations, models, contacts, litho layers, sections,
bodies, correlation edges — behind, then reported success.

``bundle_build`` already enumerates every project-scoped table once, in
order to serialise it.  This module turns that enumeration into the one
registry the copy paths consume:

* :data:`BUNDLE_COLLECTION_KEYS` — every child-collection key a bundle
  carries.  Membership is what matters; the tuple's order is informational
  (the restore takes the collections as keyword arguments and sequences the
  inserts itself).
* :data:`BUNDLE_RESTORE_KWARGS` — the keyword each key travels under into
  ``_restore_project_bundle_impl``.
* :func:`assert_bundle_keys_registered` — called by the build, so adding a
  new collection to the bundle without registering it here fails loudly at
  save time instead of being quietly skipped by every copy path.

The remap helpers (:func:`collect_row_ids`, :func:`build_clone_id_map`,
:func:`remap_ids`) turn a bundle of one project into a bundle of a
*different* project: every row id is replaced by a fresh ``uuid7`` and
every reference to it — foreign key column, UUID array element, JSON map
key — follows, because the replacement is by value across the whole
document rather than per known column.  An id that is NOT a row in this
bundle is left alone, which is exactly right for a reference that points
outside the project.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any
from uuid import UUID

from uuid6 import uuid7


class BundleRegistryError(RuntimeError):
    """Raised when the bundle's shape and this registry disagree.

    A programming error, not a data error: it means a collection was added
    to (or removed from) ``bundle_build`` without updating
    :data:`BUNDLE_COLLECTION_KEYS`.  Raised rather than logged because a
    copy path driven from a stale registry silently loses the new
    collection — the exact failure this module exists to prevent.
    """


# Bundle keys that are NOT child collections: the format stamp and the
# project row itself. Everything else in a bundle must be registered below.
BUNDLE_SCALAR_KEYS: frozenset[str] = frozenset({"format_version", "project"})

# Every child collection a bundle carries. The ORDER IS INFORMATIONAL ONLY —
# every consumer hands the collections to ``_restore_project_bundle_impl`` as
# keyword arguments (see ``BUNDLE_RESTORE_KWARGS``), and that function decides
# the insert order itself. Put a new key wherever it reads best; what matters
# is that it is here at all, because ``assert_bundle_keys_registered`` refuses
# to build a bundle carrying a collection this tuple does not name.
BUNDLE_COLLECTION_KEYS: tuple[str, ...] = (
    "cpts",
    "boreholes",
    "geological_formations",
    "geological_models",
    "cross_sections",
    "investigation_reviews",
    "bodies",
    "formation_absences",
    "litho_contact_correlation_edges",
    "body_geometry_facts",
    "geotech_tie_tombstones",
    "body_separations",
    "body_unions",
    "body_boundary_shapes",
    "body_boundary_nodes",
    "litho_solids",
    "bed_overrides",
)

# Bundle key → the keyword ``_restore_project_bundle_impl`` accepts it under.
# Derived rather than typed out twice; the unit test checks every value is a
# real parameter of that function, so a rename there fails a test instead of
# silently passing the collection as an unknown kwarg.
BUNDLE_RESTORE_KWARGS: dict[str, str] = {key: f"{key}_payload" for key in BUNDLE_COLLECTION_KEYS}


def assert_bundle_keys_registered(bundle: Mapping[str, Any]) -> None:
    """Check a freshly built bundle against the registry.

    Parameters
    ----------
    bundle : Mapping[str, Any]
        The bundle dict as ``bundle_build`` assembled it.

    Raises
    ------
    BundleRegistryError
        When the bundle carries a key this module does not know about, or
        is missing one it does. Either way a copy path driven from the
        registry would be wrong, so the build refuses rather than emitting
        a bundle whose consumers disagree about its shape.
    """
    known = BUNDLE_SCALAR_KEYS | set(BUNDLE_COLLECTION_KEYS)
    unregistered = sorted(set(bundle) - known)
    missing = sorted(set(BUNDLE_COLLECTION_KEYS) - set(bundle))
    if unregistered or missing:
        raise BundleRegistryError(
            "Bundle shape and BUNDLE_COLLECTION_KEYS disagree — "
            f"unregistered key(s): {unregistered or 'none'}; "
            f"registered but absent: {missing or 'none'}. "
            "Add the new collection to bundle_collections.BUNDLE_COLLECTION_KEYS "
            "(and to _restore_project_bundle_impl) so every copy path carries it."
        )


def _as_uuid_str(value: Any) -> str | None:
    """Return *value* as a canonical UUID string, or ``None`` if it is not one.

    Parameters
    ----------
    value : Any
        Candidate value from a bundle payload.

    Returns
    -------
    str | None
        The canonical lowercase UUID string, or ``None`` when *value* is not
        a UUID-shaped string.
    """
    if not isinstance(value, str) or len(value) != 36:
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


def collect_row_ids(node: Any) -> set[str]:
    """Collect the ``id`` of every row dict anywhere under *node*.

    Walks lists and dicts to any depth, so a borehole's nested drill
    segments / observations / layers / admixtures / samples / lab tests and
    a model's nested contacts / surfaces / litho layers are all included
    without naming any of them here. A dict qualifies as a row when it
    carries an ``id`` that parses as a UUID; the JSONB blobs the bundle
    carries (vertex arrays, admixture descriptors, view-state bags) do not.

    Parameters
    ----------
    node : Any
        Any bundle fragment — a collection list, a single payload, or the
        whole bundle.

    Returns
    -------
    set[str]
        Canonical UUID strings of every row found.
    """
    found: set[str] = set()
    stack: list[Any] = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            row_id = _as_uuid_str(current.get("id"))
            if row_id is not None:
                found.add(row_id)
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return found


def build_clone_id_map(
    bundle: Mapping[str, Any],
    *,
    source_project_id: UUID,
    new_project_id: UUID,
) -> dict[str, str]:
    """Map every id in *bundle* onto a fresh id for a clone of the project.

    The source rows stay where they are, so the copy needs its own primary
    keys; the map is what keeps every reference between the copied rows
    pointing inside the copy.

    Parameters
    ----------
    bundle : Mapping[str, Any]
        A bundle built from the source project.
    source_project_id : UUID
        The project the bundle came from.
    new_project_id : UUID
        The project row the copy will hang under (already created).

    Returns
    -------
    dict[str, str]
        ``old id → new id``, including the project id itself so any
        ``app_project_id`` carried in a payload lands on the copy.
    """
    id_map: dict[str, str] = {str(source_project_id): str(new_project_id)}
    for key in BUNDLE_COLLECTION_KEYS:
        for old_id in collect_row_ids(bundle.get(key)):
            id_map.setdefault(old_id, str(uuid7()))
    return id_map


def remap_ids(node: Any, id_map: Mapping[str, str]) -> Any:
    """Return a deep copy of *node* with every mapped id string replaced.

    Replacement is by value across the whole document — dict values, dict
    KEYS (the stratigraphy lumping map is keyed by formation id), and list
    elements alike — so a reference is carried whether it lives in a plain
    FK column, a UUID array, or a JSON blob. Strings absent from the map
    pass through untouched, which is what a reference to something outside
    the project needs.

    The lookup canonicalises UUID-shaped strings the same way
    :func:`collect_row_ids` does, because the map is KEYED on the canonical
    form. Matching the raw string instead would let an upper-case occurrence
    slip through unmapped: the cloned row would keep the source primary key,
    the restore's insert-if-absent would skip it as already present, and the
    "copy" would share that row with the original.

    Parameters
    ----------
    node : Any
        Bundle fragment to copy.
    id_map : Mapping[str, str]
        ``old id → new id`` from :func:`build_clone_id_map`.

    Returns
    -------
    Any
        A structurally independent copy with ids substituted.
    """
    if isinstance(node, dict):
        return {
            (_remap_str(k, id_map) if isinstance(k, str) else k): remap_ids(v, id_map)
            for k, v in node.items()
        }
    if isinstance(node, list):
        return [remap_ids(v, id_map) for v in node]
    if isinstance(node, str):
        return _remap_str(node, id_map)
    return node


def _remap_str(value: str, id_map: Mapping[str, str]) -> str:
    """Return the mapped id for *value*, matching on its canonical UUID form.

    Parameters
    ----------
    value : str
        Any string from a bundle payload — a row id, a plain column value, a
        dict key.
    id_map : Mapping[str, str]
        ``old id → new id``, keyed on canonical (lower-case) UUID strings.

    Returns
    -------
    str
        The replacement id, or *value* unchanged when it is not a mapped row.
    """
    return id_map.get(_as_uuid_str(value) or value, value)


def count_rows_per_collection(bundle: Mapping[str, Any]) -> dict[str, int]:
    """Count every row a bundle carries, per registered collection.

    Counts rows at ANY depth (see :func:`collect_row_ids`), so a borehole's
    child tree and a model's nested contacts / surfaces / litho layers are
    included in their parent collection's total. That is what makes the
    number usable as a completeness check: a copy that kept the boreholes
    but dropped their samples does not match.

    Parameters
    ----------
    bundle : Mapping[str, Any]
        Any bundle.

    Returns
    -------
    dict[str, int]
        Collection key → number of rows carried under it.
    """
    return {key: len(collect_row_ids(bundle.get(key))) for key in BUNDLE_COLLECTION_KEYS}


def fingerprint_cpt_series(bundle: Mapping[str, Any]) -> dict[str, int | None]:
    """Return each CPT's depth-series fingerprint: sample count, or ``None``.

    ``count_rows_per_collection`` is blind to ``cpt_series``: that table has no
    ``id`` column (its primary key is ``cpt_id``), so the depth / qc / fs arrays
    — the largest and most load-bearing payload a CPT carries — contribute
    nothing to the row counts. A copy that carried every CPT row but dropped
    every series would report ``cpts 1/1`` and pass. This is the structural
    check that closes that blind spot.

    Parameters
    ----------
    bundle : Mapping[str, Any]
        Any bundle.

    Returns
    -------
    dict[str, int | None]
        Canonical CPT id → number of depth samples its series carries, or
        ``None`` when the CPT has no series row at all (a legitimate state —
        a CPT whose file had no data block).
    """
    fingerprint: dict[str, int | None] = {}
    for cpt in bundle.get("cpts") or []:
        if not isinstance(cpt, Mapping):
            continue
        cpt_id = _as_uuid_str(cpt.get("id"))
        if cpt_id is None:
            continue
        series = cpt.get("series")
        depths = series.get("depths_m") if isinstance(series, Mapping) else None
        fingerprint[cpt_id] = len(depths) if isinstance(depths, list) else None
    return fingerprint


def sort_models_parents_first(
    models_payload: Iterable[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    """Order geological models so a parent always precedes its children.

    ``geological_model.parent_model_id`` is a self-referential FK with no
    SQLAlchemy ``relationship`` behind it, so the unit of work inserts the
    rows in the order they were added and cannot reorder them itself. A
    litho model queued before its geological parent therefore fails the FK
    on flush. Sorting by depth in the parent chain removes the dependence
    on whatever order the source rows happened to come back in.

    Rows whose parent is not in the payload count as roots — a parent that
    lives outside this project is not ours to order.

    Parameters
    ----------
    models_payload : Iterable[Mapping[str, Any]]
        Geological-model payload dicts.

    Returns
    -------
    list[Mapping[str, Any]]
        The same dicts, parents first.
    """
    models = list(models_payload)
    by_id = {m.get("id"): m for m in models if m.get("id") is not None}

    def depth(model: Mapping[str, Any]) -> int:
        """Return how many ancestors a model has inside this payload."""
        seen: set[Any] = set()
        steps = 0
        current = model
        while True:
            parent_id = current.get("parent_model_id")
            if parent_id is None or parent_id not in by_id or parent_id in seen:
                return steps
            seen.add(parent_id)
            current = by_id[parent_id]
            steps += 1

    return sorted(models, key=depth)
