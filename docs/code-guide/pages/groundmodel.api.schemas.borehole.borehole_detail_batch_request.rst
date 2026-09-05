groundmodel.api.schemas.borehole.borehole_detail_batch_request
==============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/borehole_detail_batch_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/borehole_detail_batch_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/borehole_detail_batch_request.py
   :language: python
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring (this folds many per-borehole detail fetches into one call, mirroring the CPT batch), imports of ``UUID``, ``Field``, and the strict base, and a private constant capping the batch at 500 ids.

**Why it is here.** This is a request schema, so it inherits the strict base. The 500 cap guards the endpoint against a runaway caller flooding it with one giant request; the docstring notes a typical section holds fewer than 30 boreholes (debt #39).

.. CG-EXPLANATION-END id=module-header

Class ``BoreholeDetailBatchRequest``
------------------------------------

.. CG-BLOCK id=class:BoreholeDetailBatchRequest lines=23-51

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/borehole_detail_batch_request.py
   :language: python
   :lines: 23-51
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoreholeDetailBatchRequest

**What this does.** Three fields: the list of borehole ids (1 to 500), a REQUIRED ``app_project_id``, and an optional ``include`` list naming which lab-test families to load.

**Why it is here.** ``app_project_id`` is the project-scope guard, required so a caller in one project cannot retrieve a foreign borehole's tree by guessing its id (debt #4 / VULN-6). The docstring notes the response order is not guaranteed to match the ids (callers index by id) and unknown ids are dropped silently, matching the render path's existing "detail exists?" check. The optional include list lets a section view skip the six lab-family lookups it does not draw.

.. CG-EXPLANATION-END id=class:BoreholeDetailBatchRequest

