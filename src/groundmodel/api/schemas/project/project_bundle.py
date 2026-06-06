"""Schemas for the project bundle round-trip (GET /bundle + POST /restore).

The bundle carries a project's complete state — header metadata,
every CPT (with series), every borehole (with its full child tree),
every per-project decision (geological model, cross-sections,
investigation reviews, view-state toggles), litho_layer rows,
contact-correlation edges, bodies, formation absences, and boundary
shapes. This is the v4 bundle shape. The desktop client wraps it in a
v3 .gmproj file (``format_version: 3`` outer envelope; the bundle payload
inside is the v4 shape). ``GET /projects/{id}/bundle`` is called on
File → Save and embedded in the file; the same shape is sent back to
``POST /projects/{id}/restore`` when opening a file whose DB row is
missing. Both v3 and v4 bundles are accepted on restore.

The round-trip is idempotent: re-restoring a bundle whose rows already
exist (by id) returns them as-is rather than failing or duplicating.

Why ``dict[str, Any]`` instead of a typed nested schema:

* The bundle's child trees span ~10 ORM classes. Modelling each as its
  own Pydantic class is a lot of code with weak payoff — the source of
  truth for column shapes is the ORM, not the API. Tracking those
  schemas in two places drifts.
* The serialiser (``infrastructure/db/repositories/project_bundle.py``)
  uses ``__mapper__.column_attrs`` to enumerate columns, so adding a
  column anywhere in the tree rides along automatically. A typed
  Pydantic mirror would force a manual update each time.
* Validation happens at the ORM level on restore — bad types raise
  before commit and the router maps the error to a 400.

What we DO type at this layer:

* The top-level shape (``project`` / ``cpts`` / ``boreholes`` / …).
* ``format_version`` so we can branch on it as the file format evolves.

Every per-project decision lives in the bundle, never in localStorage.
See memory/project_decisions_in_bundle.md.

v3 is the first format that matters — v1 (metadata-only) and v2
(CPTs + boreholes + geology + sections) were dev-only and have been
removed. Opening a pre-v3 .gmproj fails loudly with a "re-save from
the build that created it" message.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, Field, field_validator

# Re-exported from the shared floor so infrastructure can import the format
# constants without depending on this API module (clean-architecture). Callers
# that already do ``from ...schemas.project.project_bundle import
# BUNDLE_FORMAT_VERSION`` keep working unchanged.
from groundmodel.shared.bundle_format import (  # noqa: F401
    BUNDLE_FORMAT_VERSION,
    SUPPORTED_BUNDLE_VERSIONS,
)

# Bounds for the StratigraphyLumping sub-object. The .gmproj file is the
# highest-trust on-disk input we accept (a crafted/corrupted bundle is the
# threat) — an unbounded `map` dict lets a malicious file allocate an
# arbitrarily large structure during Pydantic validation on restore. A real
# geological project has at most a few hundred distinct formation names, so
# these ceilings are generous while still capping the DoS surface.
_LUMPING_MAX_ENTRIES = 2_000  # formation-name pairs; real projects ≪ this
_LUMPING_STR_MAX = 512  # a formation name / normalised key is ≤ ~100 chars
_APPLIED_AT_MAX = 64  # ISO-8601 UTC is ≤ ~32 chars


class StratigraphyLumping(BaseModel):
    """Snapshot of the manual lumping map last applied via Fill from boreholes.

    Stored in the bundle so the user's grouping for this project is remembered
    and pre-populates the next Fill dialog.  This is metadata only — the
    formations and contacts in the bundle ARE the already-applied result.  On
    restore the map is stored as-is; it is NEVER re-applied (doing so would
    create duplicate contacts on top of the restored rows).

    Attributes
    ----------
    schema_version : int
        Versioning for this sub-object (currently 1).  Allows additive
        evolution without bumping the top-level ``format_version``.
    applied_at : str
        ISO-8601 timestamp (UTC) of the last successful Apply that produced
        this map, so the UI can show "last lumped at …".
    map : dict[str, str]
        ``{ normalised_candidate_key: target_formation_name }`` — the exact
        map sent to the server on the last confirm.  Keys are
        ``normalize_formation_key()`` output (server-side).
    """

    schema_version: int = 1
    applied_at: Annotated[str, Field(max_length=_APPLIED_AT_MAX)]
    map: Annotated[
        dict[
            Annotated[str, Field(max_length=_LUMPING_STR_MAX)],
            Annotated[str, Field(max_length=_LUMPING_STR_MAX)],
        ],
        Field(default_factory=dict, max_length=_LUMPING_MAX_ENTRIES),
    ]


# BUNDLE_FORMAT_VERSION + SUPPORTED_BUNDLE_VERSIONS now live in
# groundmodel.shared.bundle_format (imported + re-exported above) so the
# infrastructure restore/build path can use them without an API import.


# Per-array bounds for the restore body (debt #38). Calibrated well
# above any plausible real-world project — a DOV-bbox import of 500
# CPTs is the documented "large project" reference. The bounds defend
# against a malicious / corrupted .strix shipping a 10⁷-entry array
# that OOMs the API while it iterates. None of these will bind in
# practice on legitimate user data.
_MAX_CPTS_PER_BUNDLE = 10_000
_MAX_BOREHOLES_PER_BUNDLE = 10_000
_MAX_FORMATIONS_PER_BUNDLE = 5_000
_MAX_GEOTECH_UNITS_PER_BUNDLE = 5_000
_MAX_GEOLOGICAL_MODELS_PER_BUNDLE = 1_000
_MAX_CROSS_SECTIONS_PER_BUNDLE = 1_000
_MAX_INVESTIGATION_REVIEWS_PER_BUNDLE = 50_000
# An edge joins two formations.  A project with 5,000 formations can have at
# most ~12.5M edges in a complete graph; the practical upper bound for a
# v1.0 litho project is O(formations²) within each model, well under 50,000.
_MAX_LITHO_CORRELATION_EDGES_PER_BUNDLE = 50_000
# A project with 500 investigations and 20 parent formations could
# theoretically have hundreds of bodies.  10 000 is a safe ceiling well
# above any plausible real project while still capping the DoS surface.
_MAX_BODIES_PER_BUNDLE = 10_000
# Each formation can declare at most every investigation absent.  A project
# with 500 investigations × 50 formations is the extreme upper bound, so
# 25 000 rows caps the space while remaining well above reality.
_MAX_FORMATION_ABSENCES_PER_BUNDLE = 25_000
# One shape per body; capped at the body ceiling.  Each shape carries a
# small handful of boundary nodes — a generous global ceiling caps the DoS
# surface (#112) while staying far above any real project (#163f).
_MAX_LITHO_LENS_SHAPES_PER_BUNDLE = 10_000
_MAX_LITHO_LENS_BOUNDARY_NODES_PER_BUNDLE = 200_000

# Per-item dict key/value length caps for body_boundary_shapes and
# body_boundary_nodes. The ORM columns are short (UUID/float/int/String(16));
# 256 chars per key and 4 096 chars per value are generous while capping the
# per-item DoS surface that the list-length bounds alone cannot close.
_MAX_BOUNDARY_ITEM_KEY_LEN = 256
_MAX_BOUNDARY_ITEM_VALUE_LEN = 4_096


def _validate_bounded_dict_list(
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Validate that each item dict's keys and string values are bounded.

    Raises ``ValueError`` if any key exceeds ``_MAX_BOUNDARY_ITEM_KEY_LEN``
    or any string value exceeds ``_MAX_BOUNDARY_ITEM_VALUE_LEN``.

    Parameters
    ----------
    items : list[dict[str, Any]]
        The list of raw item dicts from the bundle payload.

    Returns
    -------
    list[dict[str, Any]]
        The validated items (unchanged).
    """
    for item in items:
        for k, v in item.items():
            if len(k) > _MAX_BOUNDARY_ITEM_KEY_LEN:
                raise ValueError(
                    f"Bundle item key too long "
                    f"({len(k)} > {_MAX_BOUNDARY_ITEM_KEY_LEN}): {k[:64]!r}…"
                )
            if isinstance(v, str) and len(v) > _MAX_BOUNDARY_ITEM_VALUE_LEN:
                raise ValueError(
                    f"Bundle item value for key {k!r} too long "
                    f"({len(v)} > {_MAX_BOUNDARY_ITEM_VALUE_LEN})"
                )
    return items


class ProjectBundleRequest(BaseModel):
    """Body of ``POST /projects/{id}/restore``.

    Child fields default to empty so a caller restoring a project
    shell without children still works. ``format_version`` is required
    and must equal ``BUNDLE_FORMAT_VERSION`` — older files are rejected
    by the route handler with a 400 + "re-save from a current build"
    message.

    Per-array ``max_length`` caps defend against malicious /
    corrupted bundles (debt #38). The body-size middleware in
    ``api/main.py`` caps the JSON envelope; these caps stop a payload
    that fits the envelope budget but ships an N-billion entry list.
    """

    format_version: int = Field(ge=1)
    project: dict[str, Any]
    cpts: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_CPTS_PER_BUNDLE,
    )
    boreholes: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_BOREHOLES_PER_BUNDLE,
    )
    # Per-project formation vocabulary — substrate entities the
    # geological model references.
    geological_formations: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_FORMATIONS_PER_BUNDLE,
    )
    # Geotechnical subdivision of formations (v1.0 MVP gate). Flat
    # array — each row carries its own ``geological_formation_id``
    # so the restore is "formations first, then units" and a missing
    # parent surfaces as an FK error rather than a silent partial
    # load. Older bundles without this key restore cleanly (default
    # empty list).
    geotechnical_units: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_GEOTECH_UNITS_PER_BUNDLE,
    )
    # Interpretation containers. Each carries its own ``contacts`` list
    # nested (formation top per investigation), mirroring how CPT
    # carries series and borehole carries observations / samples.
    geological_models: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_GEOLOGICAL_MODELS_PER_BUNDLE,
    )
    # Project-scoped cross-section definitions (the slice lines + view
    # preferences; polylines drawn on them land later with the editor).
    cross_sections: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_CROSS_SECTIONS_PER_BUNDLE,
    )
    # Per-(project, investigation) decisions: review status / notes /
    # hidden flag. Polymorphic target_kind / target_id; see
    # InvestigationReviewOrm.
    investigation_reviews: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_INVESTIGATION_REVIEWS_PER_BUNDLE,
    )
    # Body rows (replaces litho_lenses — slice 4.1 rename).  Each row carries
    # id, model_id, formation_id, body_ordinal, source_investigation_id, name,
    # primary_section_id.  Extent columns are intentionally excluded — the
    # extent system is retired in favour of the partition-fill model.  Restore
    # order: models first, then bodies (model_id + formation_id FK-respecting).
    # Additive field: absence in an older bundle restores cleanly via
    # default_factory=list.  Older bundles carrying ``litho_lenses`` key
    # are ignored on restore (pre-ship amnesty — no upgrade path needed;
    # the field is not read by new restores).
    bodies: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_BODIES_PER_BUNDLE,
    )
    # Absence records scoped to a formation (Position 4).  Each row carries
    # formation_id so the restore order is "formations first, then absences"
    # (FK-respecting).  Additive field: absence in an older bundle restores
    # cleanly via default_factory=list.  Older bundles that carried
    # ``litho_lens_absences`` are ignored (pre-ship amnesty — no upgrade path
    # needed; the field simply won't be sent by new saves and won't be read).
    formation_absences: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_FORMATION_ABSENCES_PER_BUNDLE,
    )
    # Contact-level correlation edges (#133 Phase 2+3).  Additive — absent
    # in bundles saved before this field shipped; default_factory=list so
    # older files open cleanly.  Restore order: after the litho models exist
    # (both contact_a_id and contact_b_id FK litho_layer.id post-A4; a v3
    # bundle's endpoints resolve via the FC↔LL mirror).
    litho_contact_correlation_edges: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_LITHO_CORRELATION_EDGES_PER_BUNDLE,
    )
    # Body boundary shapes + control nodes (#163f Slice 2).  Additive — absent
    # in older bundles; default_factory=list. Restore order: shapes after
    # geological_models (model_id FK), nodes after shapes (shape_id FK).
    body_boundary_shapes: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_LITHO_LENS_SHAPES_PER_BUNDLE,
    )
    body_boundary_nodes: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_LITHO_LENS_BOUNDARY_NODES_PER_BUNDLE,
    )

    @field_validator("body_boundary_shapes", "body_boundary_nodes", mode="after")
    @classmethod
    def _bound_boundary_item_dicts(cls, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Enforce per-item key/value length bounds on boundary payload dicts.

        The list-length ``max_length`` cap (above) limits the number of items;
        this validator closes the per-item DoS surface — a crafted bundle
        cannot ship a single item with a 1 GB string value and bypass the
        envelope-size middleware (which checks the raw byte budget, not
        per-field semantics).

        Parameters
        ----------
        items : list[dict[str, Any]]
            The list of raw item dicts from the bundle payload.

        Returns
        -------
        list[dict[str, Any]]
            The validated items, unchanged.
        """
        return _validate_bounded_dict_list(items)

    # Manual lumping map from the last Fill-from-boreholes confirm.
    # Nullable — absent in bundles saved before this field existed.
    # On restore: stored as bundle metadata only; NEVER re-applied
    # (formations + contacts are the already-applied result).
    stratigraphy_lumping: StratigraphyLumping | None = None


class ProjectBundleResponse(BaseModel):
    """Body returned by ``GET /projects/{id}/bundle``.

    Same shape as the request — symmetry is intentional, the desktop
    client persists the response verbatim and POSTs it back unchanged.
    """

    format_version: int = BUNDLE_FORMAT_VERSION
    project: dict[str, Any]
    cpts: list[dict[str, Any]]
    boreholes: list[dict[str, Any]]
    geological_formations: list[dict[str, Any]] = Field(default_factory=list)
    geotechnical_units: list[dict[str, Any]] = Field(default_factory=list)
    geological_models: list[dict[str, Any]] = Field(default_factory=list)
    cross_sections: list[dict[str, Any]] = Field(default_factory=list)
    investigation_reviews: list[dict[str, Any]] = Field(default_factory=list)
    # Body rows (replaces litho_lenses — slice 4.1 rename).  Additive — absent
    # in bundles saved before this field existed.
    bodies: list[dict[str, Any]] = Field(default_factory=list)
    # Absence records scoped to a formation (Position 4).  Additive.
    formation_absences: list[dict[str, Any]] = Field(default_factory=list)
    # Contact-level correlation edges (#133 Phase 2+3).  Additive — absent
    # in bundles saved before this field shipped.
    litho_contact_correlation_edges: list[dict[str, Any]] = Field(default_factory=list)
    # Body boundary shapes + control nodes (#163f Slice 2).  Additive.
    body_boundary_shapes: list[dict[str, Any]] = Field(default_factory=list)
    body_boundary_nodes: list[dict[str, Any]] = Field(default_factory=list)
    # Manual lumping map from the last Fill-from-boreholes confirm.
    # Nullable — bundles saved before this field existed carry null.
    stratigraphy_lumping: StratigraphyLumping | None = None
