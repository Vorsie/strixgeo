groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result
===========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/gef/gef_parse_result.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/gef/gef_parse_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parse_result.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the pieces the result needs: Polars (a fast table library — a Polars *DataFrame* is a table of columns, like a spreadsheet in memory), the two provenance labels, the CPT-type enum, the header, and the validation types.

**Why it is here.** A finished parse is more than a table of numbers — it is the table plus the header, the detected type, the list of findings, and a note of where certain values came from. The next block packages all of that into one object.

.. CG-EXPLANATION-END id=module-header

Class ``GEFParseResult`` — header
---------------------------------

.. CG-BLOCK id=class:GEFParseResult lines=20-61

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parse_result.py
   :language: python
   :lines: 20-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:GEFParseResult

**What this does.** The single object a completed GEF parse hands back: the parsed ``header``, the detected ``cpt_type``, the ``data`` table, the list of validation ``issues``, and two provenance flags. ``rf_source`` records whether the friction ratio Rf came straight from the file or was computed by the parser; ``elevation_source`` records which kind of source supplied the ground level.

**Why it is here.** *Provenance* means "where this number came from". The platform is strict about it (see ``docs/data-integrity.md``): a value the file measured is not the same as a value the software derived, and the two must never be confused. Rf is the telling case — some cones report a slightly different Rf than the textbook ``(fs / qc) x 100`` because of internal corrections, so if the file gave us Rf we keep it and stamp it ``MEASURED``, and only stamp ``COMPUTED`` when we did the division ourselves. The note explains why there is deliberately no ``qt_source`` field: this pipeline never computes qt or q_total itself, so there is nothing to flag.

.. CG-EXPLANATION-END id=class:GEFParseResult

Method ``GEFParseResult``. ``def has_errors``
---------------------------------------------

.. CG-BLOCK id=method:GEFParseResult.has_errors lines=62-66

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parse_result.py
   :language: python
   :lines: 62-66
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParseResult.has_errors

**What this does.** A read-only shortcut that answers "did this parse hit any error-level problem?" by checking the issue list. Writing ``@property`` above it lets callers read it as ``result.has_errors`` with no parentheses, as if it were a plain field.

**Why it is here.** The import step asks exactly this one question before deciding whether to store the CPT or refuse it, so the result offers it as a clean yes/no rather than making every caller loop the list itself.

.. CG-EXPLANATION-END id=method:GEFParseResult.has_errors

Method ``GEFParseResult``. ``def warnings``
-------------------------------------------

.. CG-BLOCK id=method:GEFParseResult.warnings lines=67-70

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_parse_result.py
   :language: python
   :lines: 67-70
   :lineno-match:

.. CG-EXPLANATION-START id=method:GEFParseResult.warnings

**What this does.** A read-only shortcut that returns just the warning-level findings.

**Why it is here.** So the screen and the logs can list warnings on their own without re-filtering the full issue list each time.

.. CG-EXPLANATION-END id=method:GEFParseResult.warnings

