"""Pydantic schema for creating a new project."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

# Lifecycle vocabularies. Stored as plain VARCHAR in the DB so adding a
# bucket here doesn't need a migration; the Pydantic layer is the only
# enforcement point.
ProjectPhase = Literal["feasibility", "design", "construction", "monitoring"]
ProjectStatus = Literal["active", "on_hold", "completed"]


class ProjectCreateRequest(StrictRequestModel):
    """Body of ``POST /projects``.

    ``name`` is the only required field — every other piece of metadata is
    optional so the user can create a project quickly and fill in details
    later via the metadata editor.
    """

    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def name_must_not_be_whitespace_only(cls, v: str) -> str:
        """Reject names that are entirely whitespace.

        Parameters
        ----------
        v : str
            The incoming name value (already checked for min_length=1
            by the Field constraint, so it is at least one character).

        Returns
        -------
        str
            The original (un-stripped) name value when valid.

        Raises
        ------
        ValueError
            When the name is non-empty but consists only of whitespace.
        """
        # Pydantic's min_length=1 passes a single space — add an explicit
        # strip check so whitespace-only strings are rejected with 422.
        if not v.strip():
            raise ValueError("name must not be whitespace-only")
        return v

    project_number: str | None = Field(default=None, max_length=80)
    client: str | None = Field(default=None, max_length=200)
    site_label: str | None = Field(default=None, max_length=200)
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    default_horizontal_epsg: int | None = None
    default_vertical_epsg: int | None = None
    phase: ProjectPhase | None = None
    status: ProjectStatus = "active"
