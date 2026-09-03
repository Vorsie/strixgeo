"""Base model for every request / write schema the API accepts.

Two invariants every inbound write body must uphold, both enforced here so a
schema opts in by inheritance rather than by remembering a config line:

* **No unknown fields** (``extra="forbid"``). Pydantic's default is
  ``extra="ignore"``, which turns a renamed or mistyped key into a silent
  no-op: ``PATCH /projects/{id}`` with ``default_horizonal_epsg`` returns 200
  and writes nothing, and the caller never learns the field was dropped. On a
  loopback, single-seat API a strict body is pure upside — it surfaces client
  bugs as a 422 instead of a data-loss-shaped success.
* **No non-finite floats** (``allow_inf_nan=False``). ``NaN`` / ``±inf`` are
  valid IEEE-754 doubles that JSON can carry (``Infinity`` / ``NaN`` literals,
  or an over/underflowing decimal), and they poison everything downstream: a
  ``NaN`` depth sorts undefined, an ``inf`` coordinate breaks every spatial
  query, and neither round-trips through strict JSON. Rejecting them at the
  request boundary keeps the stored model finite by construction.

Why a base class and not a per-field ``Field(...)``: the config propagates to
every field of a subclass automatically, but it does NOT propagate into a
NESTED model. A request schema that embeds an item model (e.g. a list of
control nodes) must have that item model inherit ``StrictRequestModel`` too, or
the nested body stays lenient. Response schemas do not inherit this — they are
built by us, not validated from client input, so strictness buys nothing there.

The legacy bundle-intake schemas (``ProjectBundleRequest`` and its
``StratigraphyLumping`` sub-object) deliberately stay lenient: tolerating
unknown fields on ``.strix`` restore is documented forward-compatibility policy
(``docs/backwards-compat.md`` / ``docs/gmproj-format.md``) — an older bundle
carrying a since-renamed top-level key must still open.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class StrictRequestModel(BaseModel):
    """Reject unknown fields and non-finite floats on every inbound write body.

    Subclass this for any Pydantic model used as a request body or a write
    payload, including item models nested inside such a body (the config does
    not reach nested models on its own).
    """

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
