"""Unit tests for the application-layer project-scope guard (#166)."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from groundmodel.application.scope_guard import load_scoped_or_raise


class _Row:
    """Minimal stand-in for an ORM row carrying a project-id attribute."""

    def __init__(self, app_project_id: UUID | None = None, model_id: UUID | None = None) -> None:
        self.app_project_id = app_project_id
        self.model_id = model_id


class _StubSession:
    """Async session stub whose ``get`` returns a preset row (or None)."""

    def __init__(self, row: object | None) -> None:
        self._row = row
        self.calls: list[tuple[type, UUID]] = []

    async def get(self, orm_class: type, entity_id: UUID) -> object | None:
        """Record the lookup and return the preset row."""
        self.calls.append((orm_class, entity_id))
        return self._row


@pytest.mark.asyncio
async def test_returns_row_when_in_project() -> None:
    """A row whose ``app_project_id`` matches is returned unchanged."""
    project_id = uuid4()
    row = _Row(app_project_id=project_id)
    session = _StubSession(row)

    result = await load_scoped_or_raise(
        session,  # type: ignore[arg-type]
        _Row,
        uuid4(),
        project_id,
        label="Row",
    )
    assert result is row


@pytest.mark.asyncio
async def test_raises_when_row_missing() -> None:
    """A missing row raises ValueError mentioning 'not found in project'."""
    session = _StubSession(None)
    entity_id = uuid4()
    with pytest.raises(ValueError, match="not found in project"):
        await load_scoped_or_raise(
            session,  # type: ignore[arg-type]
            _Row,
            entity_id,
            uuid4(),
            label="Row",
        )


@pytest.mark.asyncio
async def test_raises_when_row_in_other_project() -> None:
    """A row from another project raises — the cross-project leak guard.

    The message must be identical to the missing-row case so a caller cannot
    distinguish 'wrong project' from 'does not exist'.
    """
    row = _Row(app_project_id=uuid4())  # belongs to some OTHER project
    session = _StubSession(row)
    entity_id = uuid4()
    with pytest.raises(ValueError, match=f"Row {entity_id} not found in project"):
        await load_scoped_or_raise(
            session,  # type: ignore[arg-type]
            _Row,
            entity_id,
            uuid4(),
            label="Row",
        )


@pytest.mark.asyncio
async def test_honours_custom_attr() -> None:
    """The ``attr`` override scopes on a different column name."""
    scope = uuid4()
    row = _Row()
    row.model_id = scope
    session = _StubSession(row)

    result = await load_scoped_or_raise(
        session,  # type: ignore[arg-type]
        _Row,
        uuid4(),
        scope,
        label="Row",
        attr="model_id",
    )
    assert result is row
