groundmodel.application.import_borehole_dov_result
==================================================

.. CG-PAGE source=src/groundmodel/application/import_borehole_dov_result.py complete=true

*Source file:* ``src/groundmodel/application/import_borehole_dov_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov_result.py
   :language: python
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the dataclass helpers for the borehole result below.

**Why it is here.** A small module holding one result shape.

.. CG-EXPLANATION-END id=module-header

Class ``ImportBoreholeDovResult``
---------------------------------

.. CG-BLOCK id=class:ImportBoreholeDovResult lines=7-94

.. literalinclude:: ../../../src/groundmodel/application/import_borehole_dov_result.py
   :language: python
   :lines: 7-94
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportBoreholeDovResult

**What this does.** The summary a borehole bbox import returns. Alongside the imported / duplicates / failed counts and the borehole ids, it carries a full attached-and-failed breakdown for every child collection: interpretations (with a separate WFS-gap count), samples, grain-sizes, and the four scalar lab-test families plus the catch-all.

**Why it is here.** The docstring records the reasons: the shape mirrors the CPT result so the API can show a unified summary; the WFS-gap count is surfaced separately because it is a routine upstream condition, not a failure of ours, and the engineer must be told that descriptions are simply not there rather than reading ``Import complete`` as ``DOV has none`` (audit 2026-08-02); child failures are counted apart from ``failed`` because they do not roll back the parent borehole row.

.. CG-EXPLANATION-END id=class:ImportBoreholeDovResult

