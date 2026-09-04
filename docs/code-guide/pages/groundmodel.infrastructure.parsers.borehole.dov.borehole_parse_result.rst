groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result
=====================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/borehole_parse_result.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/borehole_parse_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/borehole_parse_result.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the borehole domain types (the borehole itself, a drill segment, a field-log interval) and the shared validation types.

**Why it is here.** A finished borehole parse produces a header plus two lists of depth intervals plus a list of findings; the next block bundles those together, reusing the same validation types the CPT side uses so the screen can show one merged list of problems across both.

.. CG-EXPLANATION-END id=module-header

Class ``BoreholeParseResult`` — header
--------------------------------------

.. CG-BLOCK id=class:BoreholeParseResult lines=17-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/borehole_parse_result.py
   :language: python
   :lines: 17-67
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoreholeParseResult

**What this does.** The object a completed borehole parse hands back: the borehole header, the list of drill segments (which technique was used over which depth range), the field log (the driller's colour, moisture, and consistency notes per interval), and the validation findings.

**Why it is here.** It deliberately mirrors the CPT result — same shape, same problem-reporting — so both ingestion paths feed one uniform validation view. It carries only what lives inside the borehole's own XML; the extra bits that come from the WFS row or from separate interpretation files are merged in later by the orchestrator, keeping the parser to one job: bytes in, structured borehole out. Following the data-integrity rules, cross-field problems (a depth outside the total, an interval whose base is above its top) are reported as findings, not raised as crashes, so occasionally-messy real data still flows through.

.. CG-EXPLANATION-END id=class:BoreholeParseResult

Method ``BoreholeParseResult``. ``def has_errors``
--------------------------------------------------

.. CG-BLOCK id=method:BoreholeParseResult.has_errors lines=68-72

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/borehole_parse_result.py
   :language: python
   :lines: 68-72
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeParseResult.has_errors

**What this does.** A read-only shortcut answering whether any finding is error-level.

**Why it is here.** So the import step can ask its one yes/no question — store this borehole or refuse it — without looping the list itself.

.. CG-EXPLANATION-END id=method:BoreholeParseResult.has_errors

Method ``BoreholeParseResult``. ``def warnings``
------------------------------------------------

.. CG-BLOCK id=method:BoreholeParseResult.warnings lines=73-76

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/borehole_parse_result.py
   :language: python
   :lines: 73-76
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeParseResult.warnings

**What this does.** A read-only shortcut returning just the warnings.

**Why it is here.** So the screen and logs can list warnings on their own.

.. CG-EXPLANATION-END id=method:BoreholeParseResult.warnings

