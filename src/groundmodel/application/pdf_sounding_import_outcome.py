"""PdfSoundingImportOutcome: what happened to one sounding of a PDF import."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue


@dataclass(frozen=True)
class PdfSoundingImportOutcome:
    """The per-sounding answer of ``POST /cpt/pdf/import``.

    Parameters
    ----------
    key : str
        The sounding's key in the report.
    status : str
        ``"imported"`` (new CPT), ``"refreshed"`` (existing CPT replaced with
        consent), ``"confirmation_required"`` (already in the project; nothing
        written, ``diff`` says what would change), ``"refused"`` (cannot or
        may not be imported, ``code`` says why) or ``"failed"``.
    name : str
        The CPT name (the sounding id).
    cpt_id : UUID or None
        The created / refreshed CPT, or the existing one when consent is asked.
    issues : list of ValidationIssue
        The digitised sounding's validation issues.
    code : str or None
        Machine code of a refusal / question (``"pdf_no_xy"``,
        ``"cpt_refresh_confirmation_required"``, ...).
    message : str or None
        The sentence to show.
    diff : dict or None
        Old-vs-new numbers of a refresh awaiting consent.
    """

    key: str
    status: str
    name: str
    cpt_id: UUID | None = None
    issues: list[ValidationIssue] = field(default_factory=list)
    code: str | None = None
    message: str | None = None
    diff: dict[str, Any] | None = None
