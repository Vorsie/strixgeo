groundmodel.infrastructure.parsers.lab.dov.dov_constants
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/lab/dov/dov_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/lab/dov/dov_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-253

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_constants.py
   :language: python
   :lines: 1-253
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the fixed values the lab DOV code reads against. It re-exports the shared DOV values and defines the lab-specific ones: the single observations WFS layer, the filter that selects grain-size tests, the URL prefixes, the observation XML element-name tags, the pre-treatment vocabulary, the WFS property names, and the exact parameter strings for the scalar lab tests plus a registry of extra ones.

**Why it is here.** The comments capture a stack of hard-won facts about DOV's real data. All lab tests share one WFS layer of about seven and a half million rows, so an import must filter by test type on the server before fetching anything. The grain-size filter string has a trailing space that is really in DOV's data — omit it and the filter matches nothing. Each scalar parameter string carries its token repeated in brackets at the end, and that doubled form is inconsistent enough that every parameter had to be probed live rather than guessed. Keeping the extra parameters as an append-only list means a new test type is captured by adding a line, with no database change — the catch-all pattern the platform uses for scalar lab tests.

.. CG-EXPLANATION-END id=module-header

