groundmodel.api.schemas.project.litho_layer.litho_layer_batch_status_response
=============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_status_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_status_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_status_response.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the plain base model and the layer response shape.

**Why it is here.** The reply reuses the standard layer shape so a caller reads the same fields it reads everywhere else.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerBatchStatusResponse``
---------------------------------------

.. CG-BLOCK id=class:LithoLayerBatchStatusResponse lines=12-20

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_status_response.py
   :language: python
   :lines: 12-20
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerBatchStatusResponse

**What this does.** The reply for the batch-status change: how many rows were updated and every changed row in full.

**Why it is here.** Returning the mutated rows lets the desktop update its display immediately without asking for the whole list again.

.. CG-EXPLANATION-END id=class:LithoLayerBatchStatusResponse

