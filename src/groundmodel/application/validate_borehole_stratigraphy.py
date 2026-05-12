"""Validate-borehole-stratigraphy use case.

Routes the editor's "are this borehole's contacts internally
consistent?" check through the application layer. The loader
(``GeologyRepository.validate_no_gaps``) wraps both the DB fetch
and the call into :class:`GeologyValidator`; this use case adds
the application-boundary log entry that mirrors the other
use-case classes and gives the geological-model editor a single
stable hook for future extensions (e.g. batch-validate every
borehole in a section before save).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.value_objects.gap_issue import GapIssue
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ValidateBoreholeStratigraphy(GroundModelLogger):
    """Run the no-gaps validator for one borehole in one model."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._repo = GeologyRepository(session)

    async def execute(self, model_id: UUID, borehole_id: UUID) -> list[GapIssue]:
        """Return the validator's issues for ``(model_id, borehole_id)``.

        Read-only — never raises, never commits. An empty list means
        the contacts form a clean contiguous stratigraphy; any
        non-empty list is a soft warning the editor surfaces inline.
        """
        self.info(f"Validating stratigraphy: model={model_id}, borehole={borehole_id}")
        issues = await self._repo.validate_no_gaps(model_id, borehole_id)
        self.debug(f"validate_borehole_stratigraphy: {len(issues)} issue(s)")
        return issues
