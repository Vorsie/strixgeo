"""Pydantic schema: :class:`RebuildLithoSolidsResponse`."""

from __future__ import annotations

from pydantic import BaseModel, Field

from groundmodel.api.schemas.project.litho_body_solid_response import LithoBodySolidResponse


class RebuildLithoSolidsResponse(BaseModel):
    """Result of ``POST .../litho-solids/build-voxel``.

    Mirrors the shape of :class:`RebuildSurfacesResponse` for the
    geological TIN pipeline, extended with the freshly rebuilt solid
    list so the frontend can update its cache in a single round-trip.
    (The name predates the voxel builder: the retired strat-field
    ``rebuild`` endpoint returned the same shape.)

    Attributes
    ----------
    bodies_considered : int
        Total bodies found in the resolved model — the ones the rebuild
        loop visited.
    bodies_built : int
        Bodies whose solid was freshly (re-)triangulated and upserted.
    bodies_skipped_checksum : int
        Bodies skipped because the pick-set checksum matched the cached
        row (geometry unchanged, explicit ``force=True`` not set).
    bodies_flagged : int
        Bodies built but emitted as flagged slabs (fewer than 3
        non-collinear picks).
    orphans_deleted : int
        ``litho_body_solid`` rows removed because their ``body_id`` was
        no longer among the resolved bodies.
    solids : list[LithoBodySolidResponse]
        The full solid list after the rebuild, ordered by body creation
        time.  Equivalent to calling ``GET .../litho-solids`` immediately
        after — bundled here to avoid a second round-trip.
    marked_test_ids : list[str]
        Investigation ids dropped from the model floor (too shallow to
        anchor the bottom surface); the UI marks them so the engineer
        knows which tests were excluded from the geological bounding.
        Empty when no tests were dropped.
    uncovered_test_ids : list[str]
        Investigation ids that fall OUTSIDE the model footprint and got no
        3-D model at all — the data footprint fragmented and only its largest
        component was modelled.  Non-empty means the build is INCOMPLETE even
        though it succeeded, so the client must not report a plain success:
        the toast's severity is derived from this list, the same way the
        geotech verbs derive theirs from ``lost_tie_count`` /
        ``review_tie_reasons``.  Empty on the happy path.
    """

    bodies_considered: int
    bodies_built: int
    bodies_skipped_checksum: int
    bodies_flagged: int
    orphans_deleted: int
    solids: list[LithoBodySolidResponse]
    marked_test_ids: list[str] = Field(default_factory=list)
    """Investigation ids dropped from the model floor (too shallow); UI marks them."""
    uncovered_test_ids: list[str] = Field(default_factory=list)
    """Investigations outside the model footprint — they got no 3-D model at all."""
