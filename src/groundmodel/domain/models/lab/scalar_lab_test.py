"""Generic scalar laboratory test — a single (parameter, value, unit) tuple.

This is the catch-all family for DOV scalar lab observations that don't
fit one of the typed families (``GrainSize``, ``AtterbergLimits``,
``CaCO3Content``, ``OrganicContent``, ``WaterContent``). It captures
parameters like grain density, ASTM classification, descriptive
calcareous content, mineralogy fractions, pH, and any future scalar test
DOV publishes — without a per-parameter migration cycle.

Numeric vs text values
----------------------
DOV's ``resultaat`` is always a string in the WFS row, but represents
numbers most of the time. We attempt a numeric parse first
(``value_numeric``) and fall through to ``value_text`` for non-numeric
results — most importantly the ASTM classification codes
(``"CL"`` / ``"SP"`` / ``"GW"`` / …) which are 2–3-char tokens, not
numbers.

At least one of ``value_numeric`` and ``value_text`` is always set
(unless ``detection_condition`` flags the row as not-measurable, in
which case both are ``None``).
"""

from dataclasses import dataclass
from datetime import date

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class ScalarLabTest(LabTest):
    """A scalar-valued lab measurement on a sample.

    Parameters
    ----------
    parameter_group : str
        Source-vocabulary group (DOV ``parametergroep``), e.g.
        ``"Volumemassa-watergehalte "``, ``"Onderkenning-grondsoort"``.
    parameter : str
        Source-vocabulary parameter (DOV ``parameter``), e.g.
        ``"Korrelvolumemassa (korrelvolumemassa)"`` or
        ``"Grondsoort volgens ASTM, de code (ASTM_code)"``. Stored
        verbatim including DOV's doubled token in parens.
    value_numeric : float | None
        Parsed numeric value. ``None`` when the source value is non-
        numeric (use ``value_text`` instead) or when
        ``detection_condition`` flags the row as not-measurable.
    value_text : str | None
        Raw text value when the source result isn't a number — the
        canonical example is the ASTM classification code. ``None``
        when ``value_numeric`` is set.
    unit : str | None
        Source-vocabulary unit (DOV ``eenheid``). Pass-through; the
        domain doesn't normalise across units.
    method : str | None
        Source-vocabulary measurement method (DOV ``methode``).
        Translation is a presentation concern.
    test_date : date | None
        Date the test was performed (DOV ``fenomeentijd``).
    detection_condition : str | None
        DOV's not-measurable code: ``"NM"`` / ``"<"`` / ``None``.
        Pass-through for downstream consumers; we don't reinterpret it.
    """

    parameter_group: str = ""
    parameter: str = ""
    value_numeric: float | None = None
    value_text: str | None = None
    unit: str | None = None
    method: str | None = None
    test_date: date | None = None
    detection_condition: str | None = None
