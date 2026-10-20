"""Join names for a log line, capped so a long list stays readable."""

from __future__ import annotations

from collections.abc import Sequence

from groundmodel.shared.logging.logging_constants import MAX_LOGGED_NAMES


def capped_name_list(names: Sequence[str], limit: int = MAX_LOGGED_NAMES) -> str:
    """Return ``names`` comma-joined, the first ``limit`` only, then ``+N more``.

    Parameters
    ----------
    names : Sequence[str]
        Names to show, in the order they should read.
    limit : int, optional
        How many names to spell out (default ``MAX_LOGGED_NAMES``).

    Returns
    -------
    str
        E.g. ``"GEO-1, GEO-2"`` or ``"GEO-1, …, GEO-20 +5 more"``.
    """
    shown = ", ".join(names[:limit])
    if len(names) <= limit:
        return shown
    return f"{shown} +{len(names) - limit} more"
