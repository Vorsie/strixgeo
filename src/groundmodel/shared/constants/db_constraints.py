"""Names of the DB constraints the API translates into user-visible answers.

A constraint name is the only handle Postgres gives us on *which* rule a write
broke — the driver reports it as a substring of the error text. Every layer that
turns an ``IntegrityError`` into an HTTP answer therefore has to match on that
literal, which puts the same string in the application layer (use cases that
translate the violation into a domain exception) and in the API layer (routers
that map it to a status code).

It lives in ``shared/constants/`` for the same reason the litho codelist does:
it is consumed across layers, and the API layer must not import from the
application layer to get it. Renaming a constraint in a migration means editing
this file and nothing else.
"""

from __future__ import annotations

# Partial, deferrable GiST exclusion installed by migration
# ``f7a8b9c0d1e2_litho_layer_no_overlap`` — no two ACCEPTED litho layers may
# overlap in depth on the same (model, investigation). Checked at COMMIT, so it
# surfaces from ``session.commit()``, never from the flush that wrote the row.
LITHO_LAYER_NO_OVERLAP_CONSTRAINT = "litho_layer_accepted_no_overlap"
