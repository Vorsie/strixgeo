groundmodel.api.schemas.project.litho_layer.litho_layer_response
================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_response.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring pointing at the design spec, then three fixed value-lists — the allowed status words, the allowed provenance (source) tokens, and the allowed confidence words — each documented as matching the database's own check.

**Why it is here.** A *value-list* (``Literal``) restricts a field to an exact set of allowed strings. Defining them once here, next to the row shape, and reusing them in every request schema means the web layer and the database agree on the vocabulary in one place (the don't-repeat rule).

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerResponse``
----------------------------

.. CG-BLOCK id=class:LithoLayerResponse lines=31-60

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_response.py
   :language: python
   :lines: 31-60
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerResponse

**What this does.** The full read shape of a litho-layer row: its id, model, formation, the two possible anchor ids, top and base depth, status/source/confidence, observation links, the parent geological contact, the body it belongs to, the parent litho band a geotech band subdivides, notes, and timestamps. It sets ``from_attributes=True``.

**Why it is here.** ``from_attributes=True`` lets Pydantic build the reply by reading the database row's attributes directly. Every column is exposed because the read path mirrors the stored shape. The comments explain the coupling fields: ``parent_geo_contact_id`` binds a litho layer to the geological contact above it (#162); ``body_id`` is null until the resolver groups layers into bodies; and ``parent_litho_layer_id`` lets the Parameters tree find the litho band a geotech band subdivides, null on litho rows and on a true orphan.

.. CG-EXPLANATION-END id=class:LithoLayerResponse

