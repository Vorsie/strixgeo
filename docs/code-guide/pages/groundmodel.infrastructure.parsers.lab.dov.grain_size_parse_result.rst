groundmodel.infrastructure.parsers.lab.dov.grain_size_parse_result
==================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/lab/dov/grain_size_parse_result.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/lab/dov/grain_size_parse_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/grain_size_parse_result.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the grain-size domain type and the shared validation types.

**Why it is here.** A finished grain-size parse produces one grain-size entity plus findings; the next block bundles those, reusing the same validation types as everywhere else so all three ingestion paths share one problem queue.

.. CG-EXPLANATION-END id=module-header

Class ``GrainSizeParseResult`` — header
---------------------------------------

.. CG-BLOCK id=class:GrainSizeParseResult lines=15-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/grain_size_parse_result.py
   :language: python
   :lines: 15-45
   :lineno-match:

.. CG-EXPLANATION-START id=class:GrainSizeParseResult

**What this does.** The object a grain-size parse hands back: one grain-size entity (the curve, method, date, and pre-treatment flags) plus the findings.

**Why it is here.** The grain-size entity always exists, even when the source curve could not be recovered — in that case its arrays are empty and an error finding says so, and the orchestrator reads the error status to decide whether to store it. The parent sample id is supplied by the caller, not read from the XML, since the orchestrator already knows which sample the observation belongs to.

.. CG-EXPLANATION-END id=class:GrainSizeParseResult

Method ``GrainSizeParseResult``. ``def has_errors``
---------------------------------------------------

.. CG-BLOCK id=method:GrainSizeParseResult.has_errors lines=46-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/grain_size_parse_result.py
   :language: python
   :lines: 46-50
   :lineno-match:

.. CG-EXPLANATION-START id=method:GrainSizeParseResult.has_errors

**What this does.** A read-only shortcut answering whether any finding is error-level.

**Why it is here.** So the orchestrator can ask its one yes/no question without looping the list.

.. CG-EXPLANATION-END id=method:GrainSizeParseResult.has_errors

Method ``GrainSizeParseResult``. ``def warnings``
-------------------------------------------------

.. CG-BLOCK id=method:GrainSizeParseResult.warnings lines=51-54

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/grain_size_parse_result.py
   :language: python
   :lines: 51-54
   :lineno-match:

.. CG-EXPLANATION-START id=method:GrainSizeParseResult.warnings

**What this does.** A read-only shortcut returning just the warnings.

**Why it is here.** So warnings can be listed on their own.

.. CG-EXPLANATION-END id=method:GrainSizeParseResult.warnings

