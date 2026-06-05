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
