"""Mode enum for the auto-populate-from-stratigraphy write path.

Introduced 2026-08-03 after a live data-loss incident: the owner opened
"Fill from boreholes" intending to ADD one geological unit and lost four
saved units, because passing ``selected_keys`` implicitly meant "delete
every formation NOT in this set".  The destructive half of the operation
had no way to be declined.

The mode makes the intent explicit at the wire boundary.  ``ADD`` is the
default everywhere — an omitted field, an old client, or a request the
frontend forgot to annotate can no longer mass-delete a model.
"""

from __future__ import annotations

from enum import StrEnum


class AutoPopulateMode(StrEnum):
    """What auto-populate is allowed to do to formations it was not given.

    ADD       — create / update the selected keys only.  Formations whose key
                is NOT in ``selected_keys`` are left completely alone; the
                deletion pass is skipped entirely.  This is the DEFAULT.
    OVERWRITE — the model becomes exactly the selection: every formation with
                at least one contact in THIS model whose key is not in
                ``selected_keys`` is deleted in the same transaction.  The
                caller must have confirmed this with the user first.
    """

    ADD = "add"
    OVERWRITE = "overwrite"
