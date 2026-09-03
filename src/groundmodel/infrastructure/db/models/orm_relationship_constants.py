r"""Configurable lazy-load policy for every ORM relationship (audit M4).

Every ``relationship()`` under this package passes ``lazy=RELATIONSHIP_LAZY``
so the loader strategy has ONE switch instead of forty.

Why the switch exists
---------------------
Async SQLAlchemy cannot lazy-load: a relationship access that was not
eager-loaded fires from a context with no greenlet and raises
``MissingGreenlet`` as a runtime 500 (see CLAUDE.md "Async ORM + Pydantic
``from_attributes``"). That failure is invisible until the exact response
schema that walks the un-loaded relationship is served in production.
Setting ``lazy="raise"`` turns the same mistake into an immediate, legible
``InvalidRequestError`` at the access site — ideally surfaced by an integration
test walking that response schema, not by a user.

Why it ships OFF by default
---------------------------
The unit suite does not walk relationships against a database, so it cannot
prove ``lazy="raise"`` safe for the WRITE paths — in particular a
``back_populates`` assignment that would load an as-yet-unloaded collection to
keep both sides in sync can newly raise under ``"raise"``. Per the audit's own
guidance the tripwire therefore defaults to the current behaviour (``"select"``)
and is opt-in:

    # PowerShell, for one integration run:
    $env:STRIX_ORM_RELATIONSHIP_LAZY = "raise"
    .\scripts\run-integration-tests.ps1
    Remove-Item Env:\STRIX_ORM_RELATIONSHIP_LAZY

Run the integration suite with it set to ``"raise"`` to surface any response
schema missing a ``selectinload``; a green run promotes the default here to
``"raise"`` with confidence. The value is read once at import time.
"""

import os
from typing import Literal, cast

# Environment variable that flips the whole codebase's relationship loader
# strategy. Kept as a single name so the two processes (app + tests) cannot
# drift and so a reviewer greps one place.
RELATIONSHIP_LAZY_ENV_VAR = "STRIX_ORM_RELATIONSHIP_LAZY"

# The string loader strategies SQLAlchemy accepts for ``relationship(lazy=...)``.
# Typed as a Literal so ``relationship(lazy=RELATIONSHIP_LAZY)`` type-checks
# against SQLAlchemy's own ``Literal[...]`` parameter — a bare ``str`` read from
# the environment would be rejected by mypy.
LazyStrategy = Literal[
    "select",
    "joined",
    "selectin",
    "subquery",
    "raise",
    "raise_on_sql",
    "noload",
    "immediate",
    "write_only",
    "dynamic",
]

# Loader strategy for every mapped relationship. Defaults to SQLAlchemy's
# historical ``"select"`` (current behaviour) so nothing changes for the
# packaged app until an integration run proves ``"raise"`` safe end to end. The
# env value is ``cast`` to the Literal — the valid values are documented above,
# and an unknown one surfaces as a SQLAlchemy error at mapper configuration, not
# a silent wrong strategy.
RELATIONSHIP_LAZY: LazyStrategy = cast(
    LazyStrategy, os.environ.get(RELATIONSHIP_LAZY_ENV_VAR, "select")
)
