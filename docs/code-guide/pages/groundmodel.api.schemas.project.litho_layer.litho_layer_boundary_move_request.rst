groundmodel.api.schemas.project.litho_layer.litho_layer_boundary_move_request
=============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_boundary_move_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_boundary_move_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_boundary_move_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID, ``Field``, and the strict base class.

**Why it is here.** Standard imports for a small request schema.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerBoundaryMoveRequest``
---------------------------------------

.. CG-BLOCK id=class:LithoLayerBoundaryMoveRequest lines=12-38

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_boundary_move_request.py
   :language: python
   :lines: 12-38
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerBoundaryMoveRequest

**What this does.** The body for moving one shared boundary: the id of the layer above, the id of the layer below, and the new depth for the boundary between them.

**Why it is here.** Moving the shared edge is a two-row change in one transaction — the layer above gets a new base and the layer below a new top — so both ids travel together. The docstring records the guards the use case enforces: the two layers must share an anchor and be adjacent, and the new depth must lie strictly between the outer edges. The per-field descriptions spell those limits out.

.. CG-EXPLANATION-END id=class:LithoLayerBoundaryMoveRequest

