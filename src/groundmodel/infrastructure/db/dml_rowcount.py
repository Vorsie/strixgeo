"""Typed access to the affected-row count of an executed DML statement."""

from typing import Any, cast

from sqlalchemy import CursorResult, Result


def dml_rowcount(result: Result[Any]) -> int:
    """Return the ``rowcount`` of an executed INSERT / UPDATE / DELETE.

    ``AsyncSession.execute`` is typed to return ``Result``, but for a DML
    statement SQLAlchemy returns a ``CursorResult`` at runtime, which is the
    class that carries ``rowcount``. The cast only tells mypy what the runtime
    object already is; the value is read unchanged.

    Parameters
    ----------
    result : Result[Any]
        The object ``session.execute(<DML statement>)`` returned.

    Returns
    -------
    int
        The driver's ``rowcount`` as-is (callers keep their own ``or 0``).
    """
    return cast("CursorResult[Any]", result).rowcount
