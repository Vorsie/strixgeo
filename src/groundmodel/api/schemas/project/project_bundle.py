"""Schemas for the project bundle round-trip (GET /bundle + POST /restore).

The bundle carries a project's complete state — header metadata,
every CPT (with series), every borehole (with its full child tree),
and every per-project decision (geological model, cross-sections,
investigation reviews, view-state toggles). It powers the .gmproj
v3 file format: ``GET /projects/{id}/bundle`` is called on File →
Save and embedded in the file; the same shape is sent back to
``POST /projects/{id}/restore`` when opening a file whose DB row is
missing.

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

from typing import Any

from pydantic import BaseModel, Field

# Current bundle format version. Bumped when the bundle shape changes
# in a way readers must branch on. New saves always emit this version.
BUNDLE_FORMAT_VERSION = 3


class ProjectBundleRequest(BaseModel):
    """Body of ``POST /projects/{id}/restore``.

    Child fields default to empty so a caller restoring a project
    shell without children still works. ``format_version`` is required
    and must equal ``BUNDLE_FORMAT_VERSION`` — older files are rejected
    by the route handler with a 400 + "re-save from a current build"
    message.
    """

    format_version: int = Field(ge=1)
    project: dict[str, Any]
    cpts: list[dict[str, Any]] = Field(default_factory=list)
    boreholes: list[dict[str, Any]] = Field(default_factory=list)
    # Per-project formation vocabulary — substrate entities the
    # geological model references.
    geological_formations: list[dict[str, Any]] = Field(default_factory=list)
    # Interpretation containers. Each carries its own ``contacts`` list
    # nested (formation top per investigation), mirroring how CPT
    # carries series and borehole carries observations / samples.
    geological_models: list[dict[str, Any]] = Field(default_factory=list)
    # Project-scoped cross-section definitions (the slice lines + view
    # preferences; polylines drawn on them land later with the editor).
    cross_sections: list[dict[str, Any]] = Field(default_factory=list)
    # Per-(project, investigation) decisions: review status / notes /
    # hidden flag. Polymorphic target_kind / target_id; see
    # InvestigationReviewOrm.
    investigation_reviews: list[dict[str, Any]] = Field(default_factory=list)


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
    geological_models: list[dict[str, Any]] = Field(default_factory=list)
    cross_sections: list[dict[str, Any]] = Field(default_factory=list)
    investigation_reviews: list[dict[str, Any]] = Field(default_factory=list)
