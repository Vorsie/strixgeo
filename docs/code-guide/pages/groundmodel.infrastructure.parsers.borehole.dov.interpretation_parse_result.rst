groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result
===========================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_parse_result.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_parse_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_parse_result.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the observation domain type and the shared validation types.

**Why it is here.** A finished interpretation parse produces one observation with its layers, plus findings; the next block bundles those together, reusing the same validation types as everywhere else so the screen shows one merged problem list.

.. CG-EXPLANATION-END id=module-header

Class ``InterpretationParseResult`` — header
--------------------------------------------

.. CG-BLOCK id=class:InterpretationParseResult lines=15-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_parse_result.py
   :language: python
   :lines: 15-44
   :lineno-match:

.. CG-EXPLANATION-START id=class:InterpretationParseResult

**What this does.** The object an interpretation parse hands back: one observation (with its layers, each with its admixtures) plus the list of findings.

**Why it is here.** It mirrors the borehole and CPT results so all three feed one uniform validation view. The parent borehole id is supplied by the caller, not read from the XML, because the orchestrator already knows which borehole this interpretation belongs to.

.. CG-EXPLANATION-END id=class:InterpretationParseResult

Method ``InterpretationParseResult``. ``def has_errors``
--------------------------------------------------------

.. CG-BLOCK id=method:InterpretationParseResult.has_errors lines=45-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_parse_result.py
   :language: python
   :lines: 45-49
   :lineno-match:

.. CG-EXPLANATION-START id=method:InterpretationParseResult.has_errors

**What this does.** A read-only shortcut answering whether any finding is error-level.

**Why it is here.** So a caller can ask the one yes/no question without looping the list.

.. CG-EXPLANATION-END id=method:InterpretationParseResult.has_errors

Method ``InterpretationParseResult``. ``def warnings``
------------------------------------------------------

.. CG-BLOCK id=method:InterpretationParseResult.warnings lines=50-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_parse_result.py
   :language: python
   :lines: 50-53
   :lineno-match:

.. CG-EXPLANATION-START id=method:InterpretationParseResult.warnings

**What this does.** A read-only shortcut returning just the warnings.

**Why it is here.** So warnings can be listed on their own.

.. CG-EXPLANATION-END id=method:InterpretationParseResult.warnings

