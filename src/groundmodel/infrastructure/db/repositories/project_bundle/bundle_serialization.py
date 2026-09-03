"""Value-level JSON encoding / decoding and per-table dict helpers for the bundle.

Provides the core serialisation utilities used by every per-table
serialiser and by the restore pipeline:

* ``_to_json`` — DB-side Python value → JSON-friendly form (UUID, date,
  bytes → str; lists recurse).
* ``_from_json`` — Reverse parse, guided by the column's ``python_type``.
* ``_column_to_json`` — Snapshot every mapped column on an ORM row into a
  JSON-friendly dict, applying ``_to_json`` per value.
* ``_apply_json_to_kwargs`` — Parse a JSON dict into ORM-constructor
  kwargs, converting each value back to its DB-side Python type.

Also provides per-table serialise helpers (``_cpt_to_dict``,
``_borehole_to_dict``, ``_observation_to_dict``, ``_layer_to_dict``,
``_sample_to_dict``, ``_geological_model_to_dict``) used by the
build pipeline.

Also contains the ``_SKIP_COLUMNS`` sentinel and the restore-boundary
size caps (``_MAX_SURFACE_SOURCE_CONTACTS``, ``_MAX_TIN_ARRAY_LEN``,
``_MAX_CPT_SERIES_ROWS``, and the per-borehole child-array caps).
These constants live here rather than in the sub-module that uses them
so that every downstream module can import them without importing the
full build or restore pipeline.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.lab_test_family_constants import (
    LAB_TEST_RELATIONSHIP_NAMES,
)
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.constants.model_kind import NON_STRATIGRAPHIC_KINDS

# Columns dropped on serialise + restore because their value does not travel
# across machines / installs (debt #47 audit — the backwards-compat re-arm).
# Every name here is genuinely non-portable, not merely a cache:
#   * ``created_at`` / ``updated_at`` / ``archived_at`` — server clocks
#     (``server_default=func.now()`` / ``onupdate``). ``archived_at`` is
#     by-design active on restore, see the parent module docstring.
#   * ``location`` — the PostGIS geometry blob, rebuilt from ``location_x`` /
#     ``location_y`` / ``epsg`` on restore, so the WKB never rides along.
#   * ``generation_id`` — the ``LithoBodySolid`` FK into
#     ``litho_build_generation``, a build-history table the bundle does NOT
#     carry as one of its collections. Serialising it makes a solid reference a
#     row that never travels: on a fresh-DB open the FK dangles, and on a
#     Save-As clone ``remap_ids`` leaves it pointing at the SOURCE project's
#     build generation (only bundled rows get re-keyed). The column is nullable
#     by design ("rows written before build generations existed remain
#     readable"), so dropping it restores a valid ``NULL``. It is unique to
#     ``LithoBodySolidOrm`` among the bundled classes, so a global skip is safe.
# NOTE: the 3-D / TIN caches (``vertices`` / ``triangles`` / the ``source_*``
# checksums on ``FormationSurface`` + ``LithoBodySolid``) are deliberately NOT
# here — they are rebuildable but are carried on purpose (the surface restore
# re-validates freshness against the checksum, and the meshes let a fresh-DB
# open skip the recompute) and are portable (project-CRS coordinates). File →
# Save drops the solid meshes separately via ``include_solids=False``.
_SKIP_COLUMNS = frozenset({"created_at", "updated_at", "archived_at", "location", "generation_id"})

# Read-side bundle-key aliases: old bundle key → renamed ORM column, keyed
# by ORM class name (string keys avoid importing every ORM model here).
# ``_apply_json_to_kwargs`` silently drops unknown keys, so a column rename
# would otherwise LOSE the value when an older .strix (written before the
# rename) is restored. Aliases map the old key onto the new column; the new
# key wins when both are present (a bundle should never carry both).
# Build always writes the new key — these are restore-only.
_RESTORE_KEY_ALIASES: dict[str, dict[str, str]] = {
    # 2026-07-13 lens→body cross-section rename (debt #222).
    "CrossSectionOrm": {
        "companion_lens_id": "companion_body_id",
        "is_lens_companion": "is_body_companion",
    },
    # 2026-07-13 kind-neutral parent rename (audit NAME-09) — the parent of a
    # geotech model is a LITHO model, so "geological" in the old name lied.
    "GeologicalModelOrm": {
        "parent_geological_model_id": "parent_model_id",
    },
    # 2026-07-13 edge endpoint rename (audit ARCH-08) — the endpoints have
    # FK'd litho_layer.id since A4 slice 4a; the columns now say so.
    "LithoContactCorrelationEdgeOrm": {
        "contact_a_id": "layer_a_id",
        "contact_b_id": "layer_b_id",
        "contact_a_side": "layer_a_side",
        "contact_b_side": "layer_b_side",
    },
}

# Restore-boundary caps for FormationSurface TIN blobs (debt #19). The
# .strix bundle's ``vertices`` / ``triangles`` JSONB arrays are deserialised
# straight into PostgreSQL with no inherent bound — a malicious or
# accidentally-oversized bundle could OOM the asyncio process or balloon a
# DB row. A real v1 TIN is a few KB; even a Phase-5 kriging surface stays
# well under these. Over the cap → blank the geometry + force is_stale so
# the user rebuilds (the surface row survives; only the runaway blob is
# dropped). Folds into debt #5 (tamper hardening) — same trigger.
_MAX_SURFACE_SOURCE_CONTACTS = 50_000
_MAX_TIN_ARRAY_LEN = 200_000

# Cap on CPT depth-series array length (debt #112). The series payload is
# a dict[str, Any] — Pydantic has no visibility into the array length since
# the bundle schema types CPTs as list[dict[str, Any]]. A malicious bundle
# can embed depths_m with 5 M entries; at ~8 bytes/float × 6 channels that
# is ~240 MB of Python heap just for the series. The perf baseline shows the
# deepest real CPT is ~10 000 rows; 100 000 is 10× that and far above any
# plausible real project. Over the cap → CPT row is skipped with a warning.
_MAX_CPT_SERIES_ROWS = 100_000

# Per-borehole child-array caps (debt #112, F2). The outer ``boreholes`` array
# is bounded by _MAX_BOREHOLES_PER_BUNDLE, but a SINGLE borehole can nest an
# unbounded observation/sample tree — a crafted .strix with one borehole
# carrying 100 000 observations × 100 layers × 10 admixtures would allocate
# ~10⁸ ORM objects before the first DB write. These caps are all far above any
# real DOV borehole (O(10) drill segments, O(100) observations). Over the cap →
# the array is truncated with a warning (the borehole still restores).
_MAX_BOREHOLE_DRILL_SEGMENTS = 2_000
_MAX_BOREHOLE_FIELD_LOG_INTERVALS = 2_000
_MAX_BOREHOLE_OBSERVATIONS = 5_000
_MAX_OBSERVATION_LAYERS = 1_000
_MAX_LAYER_ADMIXTURES = 50
_MAX_BOREHOLE_SAMPLES = 5_000
_MAX_SAMPLE_LAB_TESTS = 500


def _to_json(value: Any) -> Any:
    """Convert a DB-side value to a JSON-friendly form.

    UUIDs / dates / datetimes become ISO strings; bytes columns become
    lowercase hex strings (LargeBinary columns like
    ``formation_surface.source_contact_checksum`` are random-byte
    digests that don't round-trip through JSON as raw strings —
    pydantic raises ``invalid utf-8 sequence`` the moment a non-ASCII
    byte appears). Arrays convert element-wise. Floats / ints /
    strings / None / lists-of-those pass through unchanged.

    Parameters
    ----------
    value : Any
        A DB-side Python value from an ORM column attribute.

    Returns
    -------
    Any
        JSON-serialisable equivalent of ``value``.
    """
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bytes | bytearray | memoryview):
        return bytes(value).hex()
    if isinstance(value, list):
        return [_to_json(v) for v in value]
    return value


def _from_json(value: Any, python_type: type[Any] | None) -> Any:
    """Reverse of ``_to_json`` — parse JSON back to the DB-side Python type.

    The ``python_type`` hint comes from the column's ``type.python_type``
    (e.g. ``UUID`` for ``PG_UUID``, ``date`` for ``Date``, ``bytes`` for
    ``LargeBinary``). When the value is ``None`` or the type doesn't
    need parsing (str / int / float / list of those) we return it
    unchanged.

    Parameters
    ----------
    value : Any
        A raw JSON value from the bundle dict.
    python_type : type[Any] | None
        The column's Python type hint, or ``None`` when unavailable.

    Returns
    -------
    Any
        DB-side Python value ready for ORM constructor kwargs.
    """
    if value is None:
        return None
    if python_type is UUID and isinstance(value, str):
        return UUID(value)
    if python_type is datetime and isinstance(value, str):
        return datetime.fromisoformat(value)
    if python_type is date and isinstance(value, str):
        return date.fromisoformat(value)
    if python_type is bytes and isinstance(value, str):
        return bytes.fromhex(value)
    return value


def _column_to_json(orm: Any, exclude: frozenset[str]) -> dict[str, Any]:
    """Snapshot every mapped column on ``orm`` as a JSON-friendly dict.

    Mirrors ``project_repository._column_dict`` but applies ``_to_json``
    per value so the result is safe to dump straight to JSON.

    Parameters
    ----------
    orm : Any
        An ORM model instance whose ``__mapper__.column_attrs`` carries
        the column descriptor set.
    exclude : frozenset[str]
        Column keys to omit from the snapshot (e.g. ``_SKIP_COLUMNS``,
        plus any FK back-refs that would duplicate the parent's id).

    Returns
    -------
    dict[str, Any]
        Mapping of column key → JSON-serialisable value.
    """
    return {
        col.key: _to_json(getattr(orm, col.key))
        for col in orm.__class__.__mapper__.column_attrs
        if col.key not in exclude
    }


def _normalise_restore_keys(cls: type[Any], data: dict[str, Any]) -> dict[str, Any]:
    """Remap renamed bundle keys onto their current column names.

    Applies the ``_RESTORE_KEY_ALIASES`` entry for ``cls`` (if any) so a
    bundle written before a column rename still restores losslessly. The
    new key wins on collision — a stale old-name entry never overwrites a
    value already present under the current name. Idempotent; callers that
    need the current keys BEFORE ``_apply_json_to_kwargs`` (e.g. FK
    pre-validation in the restore pipeline) can call this directly.

    Parameters
    ----------
    cls : type[Any]
        The ORM class whose alias table applies.
    data : dict[str, Any]
        Raw JSON dict from the bundle.

    Returns
    -------
    dict[str, Any]
        ``data`` with old keys remapped (a copy when aliases apply,
        ``data`` itself otherwise).
    """
    aliases = _RESTORE_KEY_ALIASES.get(cls.__name__)
    if not aliases:
        return data
    remapped: dict[str, Any] = {}
    for key, value in data.items():
        new_key = aliases.get(key, key)
        if new_key not in data or new_key == key:
            remapped[new_key] = value
    return remapped


def _apply_json_to_kwargs(cls: type[Any], data: dict[str, Any]) -> dict[str, Any]:
    """Parse a JSON dict into ORM-constructor kwargs.

    For each column known to ``cls`` that appears in ``data``, look up
    the column's Python type and run ``_from_json``. Unknown keys are
    silently dropped — older bundle versions that included a now-removed
    column shouldn't blow up the restore. Renamed columns are covered by
    ``_RESTORE_KEY_ALIASES``: an old bundle key is remapped onto the new
    column (new key wins if both appear) so pre-rename ``.strix`` files
    keep restoring losslessly.

    Parameters
    ----------
    cls : type[Any]
        The ORM class whose ``__mapper__.column_attrs`` defines the
        known column set.
    data : dict[str, Any]
        Raw JSON dict from the bundle.

    Returns
    -------
    dict[str, Any]
        Filtered and type-converted kwargs safe to pass to ``cls(**kwargs)``.
    """
    data = _normalise_restore_keys(cls, data)

    known: dict[str, type[Any] | None] = {}
    for col in cls.__mapper__.column_attrs:
        try:
            python_type = col.columns[0].type.python_type
        except (AttributeError, NotImplementedError):
            python_type = None
        known[col.key] = python_type

    return {
        key: _from_json(data[key], known[key])
        for key in data
        if key in known and key not in _SKIP_COLUMNS
    }


# ---------------------------------------------------------------------------
# Per-table serialise helpers — small, focused, mirror the clone helpers in
# project_repository.py.
# ---------------------------------------------------------------------------


def _cpt_to_dict(cpt: CptOrm) -> dict[str, Any]:
    """Serialise a ``CptOrm`` and its optional depth-series to a bundle dict.

    Parameters
    ----------
    cpt : CptOrm
        ORM instance with the ``series`` relationship eager-loaded.

    Returns
    -------
    dict[str, Any]
        JSON-friendly dict carrying all mapped columns plus a nested
        ``"series"`` key (``None`` when the CPT has no series row).
    """
    payload = _column_to_json(cpt, _SKIP_COLUMNS | {"app_project_id"})
    if cpt.series is not None:
        payload["series"] = _column_to_json(cpt.series, _SKIP_COLUMNS | {"cpt_id"})
    else:
        payload["series"] = None
    return payload


def _borehole_to_dict(bh: BoreholeOrm) -> dict[str, Any]:
    """Serialise a ``BoreholeOrm`` with its full child tree.

    Parameters
    ----------
    bh : BoreholeOrm
        ORM instance with all relationships eager-loaded (drill_segments,
        field_log_intervals, observations→layers→admixtures, samples→lab
        families).

    Returns
    -------
    dict[str, Any]
        JSON-friendly dict with nested child arrays.
    """
    payload = _column_to_json(bh, _SKIP_COLUMNS | {"app_project_id"})
    payload["drill_segments"] = [
        _column_to_json(seg, _SKIP_COLUMNS | {"borehole_id"}) for seg in bh.drill_segments
    ]
    payload["field_log_intervals"] = [
        _column_to_json(fl, _SKIP_COLUMNS | {"borehole_id"}) for fl in bh.field_log_intervals
    ]
    payload["observations"] = [_observation_to_dict(obs) for obs in bh.observations]
    payload["samples"] = [_sample_to_dict(s) for s in bh.samples]
    return payload


def _observation_to_dict(obs: ObservationOrm) -> dict[str, Any]:
    """Serialise an ``ObservationOrm`` with its layer children.

    Parameters
    ----------
    obs : ObservationOrm
        ORM instance with the ``layers`` relationship eager-loaded.

    Returns
    -------
    dict[str, Any]
        JSON-friendly dict with a nested ``"layers"`` array.
    """
    payload = _column_to_json(obs, _SKIP_COLUMNS | {"borehole_id"})
    payload["layers"] = [_layer_to_dict(layer) for layer in obs.layers]
    return payload


def _layer_to_dict(layer: ObservationLayerOrm) -> dict[str, Any]:
    """Serialise an ``ObservationLayerOrm`` with its admixture children.

    Parameters
    ----------
    layer : ObservationLayerOrm
        ORM instance with the ``admixtures`` relationship eager-loaded.

    Returns
    -------
    dict[str, Any]
        JSON-friendly dict with a nested ``"admixtures"`` array.
    """
    payload = _column_to_json(layer, _SKIP_COLUMNS | {"observation_id"})
    payload["admixtures"] = [
        _column_to_json(admix, _SKIP_COLUMNS | {"observation_layer_id"})
        for admix in layer.admixtures
    ]
    return payload


def _sample_to_dict(sample: SampleOrm) -> dict[str, Any]:
    """Serialise a ``SampleOrm`` with all six lab-test family children.

    Every lab-test family shares the same leaf shape — flat columns,
    FK back to sample.id.  The family list comes from the shared
    ``LAB_TEST_FAMILIES`` registry.

    Parameters
    ----------
    sample : SampleOrm
        ORM instance with all six lab-test family relationships
        eager-loaded.

    Returns
    -------
    dict[str, Any]
        JSON-friendly dict with nested arrays for each lab-test family.
    """
    payload = _column_to_json(sample, _SKIP_COLUMNS | {"borehole_id"})
    # Registry-driven: bundle key == relationship name for every family,
    # and registry order == the established bundle key order.
    for rel_name in LAB_TEST_RELATIONSHIP_NAMES:
        payload[rel_name] = [
            _column_to_json(row, _SKIP_COLUMNS | {"sample_id"}) for row in getattr(sample, rel_name)
        ]
    return payload


def _geological_model_to_dict(model: GeologicalModelOrm) -> dict[str, Any]:
    """Serialise a geological model with its formation contacts +
    cached TIN surfaces + (litho/geotech models) litho_layers nested.

    Mirrors the rest of the bundle's nesting convention — child rows
    live under their parent (CPT.series, borehole.observations[]) — so
    restore is a single-level walk per top-level array.

    The cached surfaces ride along so opening a .strix on a fresh DB
    doesn't pay the recompute cost up front. The next contact mutation
    refreshes the cache anyway, but for a freshly-opened project the
    section view's slice query lands on already-computed geometry.

    Litho AND geotech models carry only ``litho_layers`` — the Shape A
    primitives (id, formation_id, anchor, depth_top_m, depth_base_m,
    status, source, confidence, ...) are the source of truth post-A3.
    The ``contacts`` field is emitted as an empty list for both
    (``NON_STRATIGRAPHIC_KINDS``, A4 slice 4c) — formation_contact stays
    populated in the DB as a legacy mirror via the LL→FC trigger, but
    the bundle no longer duplicates the data. On restore the geotech/
    litho layers insert explicitly and the LL→FC trigger (no kind gate)
    rebuilds the FC mirror. Geotech MUST stay empty here: if it emitted
    its contacts, restore's de-dupe would SKIP the explicit layer INSERT
    and defer to the FC→LL trigger, which is gated to litho only — so a
    reopened geotech project would lose every geotech layer and its
    correlation edges would dangle (FK violation on restore).

    Geological models keep the historical ``contacts`` shape (the
    geological axis never grew Shape A) and always emit an empty
    ``litho_layers`` (the litho_layer XOR CHECK + the trigger's kind
    gate make this an invariant), so v4 readers can branch on
    model.kind safely.

    Older v4 bundles that DID emit ``contacts`` on litho models still
    restore — the explicit FC inserts run via the legacy path, the
    FC→LL trigger UPSERTs the matching LL rows. The slice-1 de-dupe
    rule (skip explicit LL INSERT when the layer's id is in the
    contacts payload) handles the overlap.

    Parameters
    ----------
    model : GeologicalModelOrm
        ORM instance with ``contacts``, ``surfaces``, and
        ``litho_layers`` relationships eager-loaded.

    Returns
    -------
    dict[str, Any]
        JSON-friendly dict with nested contacts/surfaces/litho_layers.
    """
    payload = _column_to_json(model, _SKIP_COLUMNS)
    if model.kind in NON_STRATIGRAPHIC_KINDS:
        # Shape A native (litho AND geotech): layers are the truth, contacts
        # are derived via the LL→FC trigger and don't ride along in the bundle.
        # Geotech MUST NOT emit contacts — its layers are restored explicitly
        # (the de-dupe skip only fires when a matching contact is in the
        # payload), and the LL→FC trigger (no kind gate) rebuilds the mirror.
        # If geotech emitted its contacts, restore would SKIP the layer INSERT
        # and defer to the FC→LL trigger, which is gated to litho only — so the
        # geotech layers would never come back and their edges would dangle.
        payload["contacts"] = []
    else:
        payload["contacts"] = [
            _column_to_json(c, _SKIP_COLUMNS | {"model_id"}) for c in model.contacts
        ]
    payload["surfaces"] = [_column_to_json(s, _SKIP_COLUMNS | {"model_id"}) for s in model.surfaces]
    payload["litho_layers"] = [
        _column_to_json(layer, _SKIP_COLUMNS | {"model_id"}) for layer in model.litho_layers
    ]
    return payload
