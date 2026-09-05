groundmodel.application.import_samples_dov_result
=================================================

.. CG-PAGE source=src/groundmodel/application/import_samples_dov_result.py complete=true

*Source file:* ``src/groundmodel/application/import_samples_dov_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov_result.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the dataclass helper for the sample result below.

**Why it is here.** A small module holding one result shape.

.. CG-EXPLANATION-END id=module-header

Class ``ImportSamplesDovResult``
--------------------------------

.. CG-BLOCK id=class:ImportSamplesDovResult lines=8-75

.. literalinclude:: ../../../src/groundmodel/application/import_samples_dov_result.py
   :language: python
   :lines: 8-75
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportSamplesDovResult

**What this does.** The sample-import summary: attached / skipped / failed counts for samples, grain-sizes, and each scalar lab-test family, plus the fetched grain-size total.

**Why it is here.** The docstring records that attached counts are subsets (only children whose parent was just persisted attach), that the ``skipped_already_present`` fields are the refresh-on-duplicate counters, and that per-row failures are isolated so one bad row never aborts the batch.

.. CG-EXPLANATION-END id=class:ImportSamplesDovResult

