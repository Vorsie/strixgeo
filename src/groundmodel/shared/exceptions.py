"""Domain and infrastructure exception hierarchy."""

from __future__ import annotations

from uuid import UUID


class GroundModelError(Exception):
    """Base exception for all ground model errors."""


class ParseError(GroundModelError):
    """Raised when a data file cannot be parsed."""


class DomainValidationError(GroundModelError):
    """Raised when domain invariants are violated."""


class NotFoundError(GroundModelError):
    """Raised when a requested resource does not exist."""


class RepositoryError(GroundModelError):
    """Raised on unexpected database or repository failures."""


class DuplicateCptError(GroundModelError):
    """Raised when a CPT with the same project_id + test_id already exists in this project."""

    def __init__(self, message: str, existing_id: UUID) -> None:
        """Initialise with a human-readable message and the ID of the existing record."""
        super().__init__(message)
        self.existing_id = existing_id


class LithoLayerOverlapError(GroundModelError):
    """Raised when a litho-layer edit would overlap an accepted sibling on its column.

    The ``litho_layer_accepted_no_overlap`` exclusion constraint is the hard
    guarantee; this exception is the clean translation of that DB violation so
    the API answers 409 instead of a raw 500. Carries the offending layer id.
    """

    def __init__(self, layer_id: UUID) -> None:
        """Initialise with the id of the layer whose edit was rejected."""
        super().__init__(
            f"litho layer {layer_id} edit would overlap an accepted layer on the same investigation"
        )
        self.layer_id = layer_id


class VoxelGridTooLargeError(GroundModelError):
    """Raised when a requested 3-D voxel build resolves to more cells than the budget.

    Deliberately NOT a ``ValueError``: ``BuildVoxelLithoModel`` treats a
    ``ValueError`` out of the labeller as "this model is unbuildable" and CLEARS
    the stored 3-D solids, so a spacing the engineer can simply retype must not
    travel that path.

    The router maps this exception to HTTP 422 (Unprocessable Entity).

    Parameters
    ----------
    message : str
        Human-readable refusal naming the resolved grid and a spacing that fits.
    suggested_horizontal_m : float
        The horizontal spacing at which the same model WOULD fit the budget, so
        the client can offer it rather than making the engineer guess.
    """

    def __init__(self, message: str, suggested_horizontal_m: float) -> None:
        """Initialise with the refusal message and the spacing that would fit."""
        super().__init__(message)
        self.suggested_horizontal_m = suggested_horizontal_m


class CrossLithoBodyCorrelationError(GroundModelError):
    """Raised when a geotech packing correlation crosses lithostratigraphic body boundaries.

    A NAD packing class is always a subdivision inside ONE lithostratigraphic
    body; a packing edge must never connect two bands that belong to different
    litho bodies.  "Same lithology" alone is insufficient — two separate sand
    bodies must not be allowed to merge into one packing body.

    The router maps this exception to HTTP 422 (Unprocessable Entity).
    """

    def __init__(self) -> None:
        """Initialise with a fixed diagnostic message."""
        super().__init__(
            "these bands are in different litho bodies — "
            "correlate the lithology first in the litho stage"
        )
