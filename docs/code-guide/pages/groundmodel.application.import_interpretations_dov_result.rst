groundmodel.application.import_interpretations_dov_result
=========================================================

.. CG-PAGE source=src/groundmodel/application/import_interpretations_dov_result.py complete=true

*Source file:* ``src/groundmodel/application/import_interpretations_dov_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/application/import_interpretations_dov_result.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the dataclass helpers for the interpretation result below.

**Why it is here.** A small module holding one result shape.

.. CG-EXPLANATION-END id=module-header

Class ``ImportInterpretationsDovResult``
----------------------------------------

.. CG-BLOCK id=class:ImportInterpretationsDovResult lines=8-50

.. literalinclude:: ../../../src/groundmodel/application/import_interpretations_dov_result.py
   :language: python
   :lines: 8-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportInterpretationsDovResult

**What this does.** The interpretation-import summary: how many XMLs downloaded and parsed, how many observations were attached, how many were skipped (no matching borehole, or already present), how many failed, a per-stream breakdown, and a count of WFS gaps.

**Why it is here.** The docstring records that attached is a subset of fetched (interpretations for a borehole not in the caller's map are dropped), that ``skipped_already_present`` is the refresh-on-duplicate counter, and that each WFS gap emits a warning with the boring's DOV URL because DOV's WFS occasionally lags behind its own database (issue #6).

.. CG-EXPLANATION-END id=class:ImportInterpretationsDovResult

