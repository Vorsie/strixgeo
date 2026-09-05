groundmodel.application.import_cpt_result
=========================================

.. CG-PAGE source=src/groundmodel/application/import_cpt_result.py complete=true

*Source file:* ``src/groundmodel/application/import_cpt_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_result.py
   :language: python
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the dataclass helper and the validation-issue helpers used by the result object below. A dataclass is a small class whose only job is to hold named values together.

**Why it is here.** Keeping the result's shape in its own file lets both the GEF path and the DOV path return the identical object.

.. CG-EXPLANATION-END id=module-header

Class ``ImportCptResult`` — header
----------------------------------

.. CG-BLOCK id=class:ImportCptResult lines=13-43

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_result.py
   :language: python
   :lines: 13-43
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportCptResult

**What this does.** The value returned by a CPT import: the saved CPT id, the list of parse findings, a flag saying whether an existing row was refreshed instead of a new one created, and the display name.

**Why it is here.** The docstring records that the CPT is always saved even when it has errors — the caller decides whether to surface or hide it. The ``refreshed`` flag lets the desktop say ``refreshed from file`` rather than ``imported``, and the name is echoed so the toast can label the CPT without a second fetch.

.. CG-EXPLANATION-END id=class:ImportCptResult

Method ``ImportCptResult``. ``def has_errors``
----------------------------------------------

.. CG-BLOCK id=method:ImportCptResult.has_errors lines=44-48

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_result.py
   :language: python
   :lines: 44-48
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCptResult.has_errors

**What this does.** A read-only property that is true when any parse finding is an error.

**Why it is here.** A one-line convenience so callers ask ``result.has_errors`` instead of scanning the issue list themselves.

.. CG-EXPLANATION-END id=method:ImportCptResult.has_errors

Method ``ImportCptResult``. ``def warnings``
--------------------------------------------

.. CG-BLOCK id=method:ImportCptResult.warnings lines=49-52

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_result.py
   :language: python
   :lines: 49-52
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCptResult.warnings

**What this does.** A read-only property returning just the warning-level findings.

**Why it is here.** Same convenience: the desktop shows warnings differently from errors, so it needs them split out.

.. CG-EXPLANATION-END id=method:ImportCptResult.warnings

