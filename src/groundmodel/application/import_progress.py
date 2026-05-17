"""Re-export shim — import_progress lived here; implementation moved to shared.

The ``ProgressCallback`` type and ``fire_progress`` helper are now canonical in
``groundmodel.shared.progress`` so the infrastructure layer (parsers, clients)
can import them without violating the "infrastructure does not import from
application" dependency rule.

Existing callers within the application layer that imported from here continue
to work unchanged.
"""

from __future__ import annotations

from groundmodel.shared.progress import ProgressCallback as ProgressCallback
from groundmodel.shared.progress import fire_progress as fire_progress

__all__ = ["ProgressCallback", "fire_progress"]
