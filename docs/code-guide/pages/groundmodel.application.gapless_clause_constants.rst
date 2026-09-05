groundmodel.application.gapless_clause_constants
================================================

.. CG-PAGE source=src/groundmodel/application/gapless_clause_constants.py complete=true

*Source file:* ``src/groundmodel/application/gapless_clause_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-97

.. literalinclude:: ../../../src/groundmodel/application/gapless_clause_constants.py
   :language: python
   :lines: 1-97
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The whole file: the definitions of the seven-clause gapless-gate — the clause key type, the status and verdict and measure-unit types, the ordered clause list, the human titles, which clauses each half of the build owns, and the honest not-evaluated reasons.

**Why it is here.** The docstring records that the seven promises live here and nowhere else: the renderer computes four clauses and the backend three, but the backend re-stamps every clause's number and title from these tables so a title cannot drift between the two languages. It sits in the application layer, not beside the API schemas, because the report-assembling use case needs it and application code must never import from the API. The clause order is the numbering, which is quoted in owner conversations and the banner, so it is part of the contract. The titles are written as promises kept, not defects found, so a passing report reads as a list of guarantees.

.. CG-EXPLANATION-END id=module-header

