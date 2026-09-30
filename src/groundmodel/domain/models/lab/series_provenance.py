"""Provenance of a stored lab-series channel or lab result (Data Integrity §1-2)."""

from enum import StrEnum


class SeriesProvenance(StrEnum):
    """Where a stored lab value came from.

    * MEASURED — what the machine logged (force, displacement, dial, pressures,
      settlement, time). Pass-through.
    * LAB_DERIVED — a per-reading column the lab software computed (strain,
      stresses in a triaxial dump). Stored pass-through, never shown or
      exported as a measurement.
    * DERIVED — computed by Strix from measured channels, with its formula and
      inputs recorded on the channel (the oedometer vertical strain).
    * LAB_REPORTED — a summary value the lab reported (e, Cc, failure values):
      listed read-only, never fed into any Strix computation (owner
      2026-09-29: "don't use default values, you can list them but we'll be
      doing our own interpretations").
    """

    MEASURED = "measured"
    LAB_DERIVED = "lab_derived"
    DERIVED = "derived"
    LAB_REPORTED = "lab_reported"
