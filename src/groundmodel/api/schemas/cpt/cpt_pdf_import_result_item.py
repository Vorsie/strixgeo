"""Pydantic schema: what happened to one sounding of a PDF import."""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema


class CptPdfImportResultItem(BaseModel):
    """One sounding's outcome.

    Parameters
    ----------
    sounding_id:
        The sounding's key.
    status:
        ``imported`` / ``refreshed`` / ``confirmation_required`` /
        ``refused`` / ``failed``.
    name:
        The CPT name (the printed sounding id).
    cpt_id:
        The created or refreshed CPT, or the existing one a consent concerns.
    code:
        Machine code of a refusal or question: ``cpt_refresh_confirmation_
        required`` (the GEF import's 409 code), ``cpt_refresh_refused``,
        ``pdf_no_xy``, ``pdf_sounding_not_offered``, ``pdf_sounding_unreadable``.
    message:
        The sentence to show.
    diff:
        Old-vs-new numbers when consent is asked (``old_/new_max_depth_m``,
        ``old_/new_n_rows``, ``n_errors``, ``n_warnings``).
    issues:
        The digitised sounding's validation issues.
    """

    sounding_id: str
    status: str
    name: str
    cpt_id: UUID | None = None
    code: str | None = None
    message: str | None = None
    diff: dict[str, Any] | None = None
    issues: list[ValidationIssueSchema] = Field(default_factory=list)
