groundmodel.api.schemas.project.litho_layer.litho_layer_batch_update_response
=============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_response.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the base model and the layer response shape.

**Why it is here.** Same pattern as the batch-status response — reuse the standard row shape.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerBatchUpdateResponse``
---------------------------------------

.. CG-BLOCK id=class:LithoLayerBatchUpdateResponse lines=12-21

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_response.py
   :language: python
   :lines: 12-21
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerBatchUpdateResponse

**What this does.** The reply: the updated count and every mutated row, in the same order as the request.

**Why it is here.** Returning the changed rows in input order lets the desktop apply the new values in place without a re-list, same as the other batch responses.

.. CG-EXPLANATION-END id=class:LithoLayerBatchUpdateResponse

