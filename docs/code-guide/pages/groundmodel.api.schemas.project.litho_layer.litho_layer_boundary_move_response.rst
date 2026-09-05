groundmodel.api.schemas.project.litho_layer.litho_layer_boundary_move_response
==============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_boundary_move_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_boundary_move_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_boundary_move_response.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the base model and the layer response shape.

**Why it is here.** Reuse of the standard row shape, as elsewhere in this package.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerBoundaryMoveResponse``
----------------------------------------

.. CG-BLOCK id=class:LithoLayerBoundaryMoveResponse lines=12-20

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_boundary_move_response.py
   :language: python
   :lines: 12-20
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerBoundaryMoveResponse

**What this does.** The reply: both layers after the move, the upper and the lower.

**Why it is here.** Returning both changed rows lets the desktop refresh in place without a second request.

.. CG-EXPLANATION-END id=class:LithoLayerBoundaryMoveResponse

