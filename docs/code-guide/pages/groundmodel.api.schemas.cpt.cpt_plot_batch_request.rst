groundmodel.api.schemas.cpt.cpt_plot_batch_request
==================================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/cpt_plot_batch_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/cpt_plot_batch_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_plot_batch_request.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring, imports of ``UUID``, ``Field``, and the strict base, and a private constant capping the batch at 500 ids.

**Why it is here.** A request schema, so it inherits the strict base; the cap guards against one giant request (a typical section calls with fewer than 30).

.. CG-EXPLANATION-END id=module-header

Class ``CptPlotBatchRequest``
-----------------------------

.. CG-BLOCK id=class:CptPlotBatchRequest lines=17-39

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_plot_batch_request.py
   :language: python
   :lines: 17-39
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptPlotBatchRequest

**What this does.** Two fields: the list of CPT ids (1 to 500) and a REQUIRED ``app_project_id``.

**Why it is here.** ``app_project_id`` is the project-scope guard: the endpoint returns only CPTs in that project so a caller cannot fetch a foreign CPT's series by guessing its id (VULN-5). The docstring records that response order is not guaranteed and that unknown or series-less CPTs are dropped, matching the section panel's render-time behaviour.

.. CG-EXPLANATION-END id=class:CptPlotBatchRequest

