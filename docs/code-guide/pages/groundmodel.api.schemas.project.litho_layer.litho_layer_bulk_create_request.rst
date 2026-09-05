groundmodel.api.schemas.project.litho_layer.litho_layer_bulk_create_request
===========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_bulk_create_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_bulk_create_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_bulk_create_request.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID, ``Field`` and ``model_validator``, the three value-lists, and the strict base class.

**Why it is here.** Standard imports for a create schema that validates each item and the whole batch.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerCreateItem`` — header
---------------------------------------

.. CG-BLOCK id=class:LithoLayerCreateItem lines=17-35

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_bulk_create_request.py
   :language: python
   :lines: 17-35
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerCreateItem

**What this does.** One layer to create: its formation, top and base depth, status/source/confidence (each defaulting to a sensible value), the optional anchor ids and observation links, an optional parent geological contact, and notes.

**Why it is here.** The comment on the depth fields records why they explicitly forbid non-finite numbers: JSON can carry a bare ``NaN`` (not-a-number), every comparison against it is false, so without this guard a ``NaN`` depth would slip past the ordering check and only fail at the database as a ``500`` — a server error for a client typo. The defaults (segmenter/pending/medium) match how the segmenter's output is stored.

.. CG-EXPLANATION-END id=class:LithoLayerCreateItem

Method ``LithoLayerCreateItem``. ``def _xor_anchor_and_depth_order``
--------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerCreateItem._xor_anchor_and_depth_order lines=36-50

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_bulk_create_request.py
   :language: python
   :lines: 36-50
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerCreateItem._xor_anchor_and_depth_order

**What this does.** Checks that exactly one anchor is set and that the top is strictly shallower than the base.

**Why it is here.** Both are also enforced by database checks, but rejecting here gives a clear ``422`` message rather than a raw database error — the same early-reject reasoning as the update schemas.

.. CG-EXPLANATION-END id=method:LithoLayerCreateItem._xor_anchor_and_depth_order

Class ``LithoLayerBulkCreateRequest``
-------------------------------------

.. CG-BLOCK id=class:LithoLayerBulkCreateRequest lines=51-77

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_bulk_create_request.py
   :language: python
   :lines: 51-77
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerBulkCreateRequest

**What this does.** The whole create batch: a list of layers plus an optional section id. An empty list is a no-op.

**Why it is here.** Inserting many rows in one transaction serves both the segmenter-persistence path and the manual-draw path. The optional section id carries the *explicit-content invariant*: when the engineer draws a layer on a section, that layer's id is added to the section's shown-content list so the new layer appears on that section immediately — the same semantic as the contact-create endpoint.

.. CG-EXPLANATION-END id=class:LithoLayerBulkCreateRequest

