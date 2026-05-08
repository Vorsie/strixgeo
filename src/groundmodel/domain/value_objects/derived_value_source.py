"""Provenance enum — distinguishes measured values from values we computed."""

from enum import StrEnum


class DerivedValueSource(StrEnum):
    """Provenance of a stored value that COULD have been derived from other fields.

    When a quantity is recorded in the source data alongside the inputs that
    would let us recompute it, the recorded value carries information that a
    pure recomputation would lose — instrument-specific corrections, author
    rounding, alternative definitions. Storing the source value AND the inputs
    creates a drift risk if the inputs are ever edited and the dependent value
    is not, so we tag every such stored value with how it got there.

    * MEASURED — the value came straight from the source file or instrument.
      Treat it as authoritative and do NOT recompute, even if the inputs are
      available.
    * COMPUTED — the value was derived by our parser from other fields in the
      source. Safe to drop and recompute on demand; keeping it stored is purely
      a convenience for query speed.

    A ``None`` provenance means unknown — e.g. legacy rows persisted before this
    column existed. Treat as opaque: do not assume measured, do not assume
    computed.
    """

    MEASURED = "measured"
    COMPUTED = "computed"
