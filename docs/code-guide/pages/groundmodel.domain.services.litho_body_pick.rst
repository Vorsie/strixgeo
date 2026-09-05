groundmodel.domain.services.litho_body_pick
===========================================

.. CG-PAGE source=src/groundmodel/domain/services/litho_body_pick.py complete=true

*Source file:* ``src/groundmodel/domain/services/litho_body_pick.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_body_pick.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the shared data class carried across the litho-3D builder pipeline, and imports the dataclass tool. It lives on its own so several modules can import it without an import cycle.

**Why it is here.** The pick is one body member-layer at one investigation, loaded by the repository and consumed by the geology-bounding transforms, the voxel builder's honoured-borehole columns, and the geotech subdivision. Keeping it in its own module means the repository and the geo-bounding service can both import it without one importing the other.

.. CG-EXPLANATION-END id=module-header

Class ``BodyLayerPick``
-----------------------

.. CG-BLOCK id=class:BodyLayerPick lines=15-60

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_body_pick.py
   :language: python
   :lines: 15-60
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyLayerPick

**What this does.** A frozen data holder for one member-layer of a body at one investigation: the investigation id, its map position, its surface elevation, the body and formation it belongs to, the layer's top and base depth, the investigation kind, and the litho-layer id it corresponds to.

**Why it is here.** The docstring notes the depth-to-elevation conversion (elevation equals surface minus depth) and two load-bearing extras. The kind (cpt or borehole) is carried so the voxel builder can decide which investigation is honoured when two share one grid column (debt #241). The litho-layer id is the covering band a geotech split stamps as its parent, so no midpoint re-derivation is needed; it is nothing for callers that never persist it.

.. CG-EXPLANATION-END id=class:BodyLayerPick

