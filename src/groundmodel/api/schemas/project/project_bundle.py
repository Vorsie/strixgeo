"""Schemas for the project bundle round-trip (GET /bundle + POST /restore).

The bundle carries a project's complete state — header metadata plus
every CPT (with series) and every borehole (with its full child tree).
It powers the .gmproj v2 file format: ``GET /projects/{id}/bundle`` is
called on File → Save and embedded in the file; the same shape is sent
back to ``POST /projects/{id}/restore`` when opening a file whose DB
row is missing.

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

* The top-level shape (``project`` / ``cpts`` / ``boreholes``).
* ``format_version`` so we can branch on it as the file format evolves.

Anything more granular is intentionally left to the per-column type
hooks in the serialiser module.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProjectBundleRequest(BaseModel):
    """Body of ``POST /projects/{id}/restore``.

    Child fields default to empty so a caller that only knows metadata
    (e.g. an older v1 file, or a partial bundle) can still trigger the
    project shell restore without bundling everything. ``geological_*``
    were added in a later additive bundle revision — older .gmproj v2
    files won't have them and that's fine.
    """

    format_version: int = Field(default=2, ge=1)
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


class ProjectBundleResponse(BaseModel):
    """Body returned by ``GET /projects/{id}/bundle``.

    Same shape as the request — symmetry is intentional, the desktop
    client persists the response verbatim and POSTs it back unchanged.
    """

    format_version: int = 2
    project: dict[str, Any]
    cpts: list[dict[str, Any]]
    boreholes: list[dict[str, Any]]
    geological_formations: list[dict[str, Any]] = Field(default_factory=list)
    geological_models: list[dict[str, Any]] = Field(default_factory=list)
