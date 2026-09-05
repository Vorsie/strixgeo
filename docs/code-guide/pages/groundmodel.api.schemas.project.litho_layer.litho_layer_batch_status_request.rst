groundmodel.api.schemas.project.litho_layer.litho_layer_batch_status_request
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_status_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_status_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_status_request.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID, ``Field``, the shared status value-list, and the strict base class.

**Why it is here.** It reuses the status value-list defined on the response page so "accept all" and the row shape cannot disagree on the allowed words.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerBatchStatusRequest``
--------------------------------------

.. CG-BLOCK id=class:LithoLayerBatchStatusRequest lines=15-28

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_status_request.py
   :language: python
   :lines: 15-28
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerBatchStatusRequest

**What this does.** A request body carrying a list of layer ids and one status to set on all of them. An empty list is a no-op.

**Why it is here.** Setting one status across many layers in a single database transaction is what the "accept all" / "reject all" buttons need — it replaces a loop of one-row updates. The status is limited to the three allowed words, so a bad value is rejected with a ``422`` (the status for "understood but invalid").

.. CG-EXPLANATION-END id=class:LithoLayerBatchStatusRequest

