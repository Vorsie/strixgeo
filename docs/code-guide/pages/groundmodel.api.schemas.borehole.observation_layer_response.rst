groundmodel.api.schemas.borehole.observation_layer_response
===========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/observation_layer_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/observation_layer_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/observation_layer_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``UUID``, ``BaseModel``, ``ConfigDict``, and the admixture response.

**Why it is here.** The response-schema pattern; it composes the admixture list.

.. CG-EXPLANATION-END id=module-header

Class ``ObservationLayerResponse``
----------------------------------

.. CG-BLOCK id=class:ObservationLayerResponse lines=10-29

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/observation_layer_response.py
   :language: python
   :lines: 10-29
   :lineno-match:

.. CG-EXPLANATION-START id=class:ObservationLayerResponse

**What this does.** One depth interval within an observation: id, top and base, an optional colour, the main soil codes, an optional description, a layer index, and the admixtures. Reads off the row.

**Why it is here.** It carries both a lithology sub-shape (colour, soil codes, admixtures) and a stratigraphy sub-shape (description); the parent observation's type decides which is populated, matching the storage layout.

.. CG-EXPLANATION-END id=class:ObservationLayerResponse

