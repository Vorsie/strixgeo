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

from typing import Final

# Partial, deferrable GiST exclusion installed by migration
# ``f7a8b9c0d1e2_litho_layer_no_overlap`` — no two ACCEPTED litho layers may
# overlap in depth on the same (model, investigation). Checked at COMMIT, so it
# surfaces from ``session.commit()``, never from the flush that wrote the row.
LITHO_LAYER_NO_OVERLAP_CONSTRAINT = "litho_layer_accepted_no_overlap"

LITHO_LAYER_DEPTH_DECIMALS: Final[int] = 3
"""Millimetre precision for every persisted litho-layer / packing-band depth.

The ``litho_layer`` no-overlap exclusion constraint (above) compares
``round(depth, 3)``, so a write at finer precision can slip past the check that
is supposed to keep a column gap-free, and a raw depth strictly inside a band can
round ONTO its edge and reach the database as a zero-width row. Every use case
that validates, classifies, or persists a layer/band depth rounds through this
one value — split, merge, run-merge, move, restated-contact move, borehole
subdivision — because a copy of the same ``3`` in each is a copy that can drift.

This lives beside :data:`LITHO_LAYER_NO_OVERLAP_CONSTRAINT` so both the
application and domain layers can import the constraint's grain without a layer
violation. Keep it SEPARATE from ``LITHO_DIGEST_DEPTH_DECIMALS`` — that is the
same value today but a semantically different digest grain that may diverge.
"""

MIN_LAYER_THICKNESS_M: Final[float] = 0.001
"""Structural floor (metres) below which a litho-layer / packing-band row must not exist.

Depths are rounded to :data:`LITHO_LAYER_DEPTH_DECIMALS` (the millimetre grain
above), so a layer thinner than this collapses to a degenerate, zero-width range
at the database and trips ``litho_layer_accepted_no_overlap`` as an unhandled 500
(dogfeed 2026-06-06: a 1 µm layer). Split / boundary-move REJECT such a write
(router → 422); the borehole flank-donor DROPS a sub-millimetre band rather than
emitting noise. Distinct from the user-configurable ``DEFAULT_MIN_THICKNESS_M``
band preference (advisory, 0.35 m) and from the frontend drag clamp (0.01 m) —
this is the hard DB-grain floor, not a UX default.
"""
