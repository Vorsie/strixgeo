groundmodel.api.schemas.project.litho_layer.litho_layer_batch_update_request
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_request.py
   :language: python
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the atomic multi-row patch, then imports UUID, ``Field`` and ``model_validator``, the three value-lists, and the strict base class.

**Why it is here.** A *model validator* is a check that runs on the whole object after its fields are set (as opposed to one field at a time). The docstring records that this mirrors the existing formation-contact batch-update so the desktop can swap one for the other without changing the all-or-nothing contract its multi-drag gestures depend on (the don't-repeat rule).

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerBatchUpdateItem`` — header
--------------------------------------------

.. CG-BLOCK id=class:LithoLayerBatchUpdateItem lines=24-45

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_request.py
   :language: python
   :lines: 24-45
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerBatchUpdateItem

**What this does.** One row's patch inside a batch: the target layer id, plus every editable field as optional (formation, top and base depth, status, source, confidence, the two anchor ids, the parent geological contact, and notes).

**Why it is here.** A layer is *anchored* to exactly one investigation — a borehole OR a CPT, never both and never neither. Only fields present in the body are written (a partial update), so all but the id are optional.

.. CG-EXPLANATION-END id=class:LithoLayerBatchUpdateItem

Method ``LithoLayerBatchUpdateItem``. ``def _xor_when_anchor_touched``
----------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerBatchUpdateItem._xor_when_anchor_touched lines=46-68

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_request.py
   :language: python
   :lines: 46-68
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerBatchUpdateItem._xor_when_anchor_touched

**What this does.** The anchor rule for one item: if the patch touches either anchor field, both must be present and exactly one must be non-null.

**Why it is here.** This is the early, clear ``422`` for the anchor invariant; the database still has the final say with its own check, but a Pydantic-level rejection gives a readable message instead of a raw database error. This same anchor-XOR rule recurs on the single-row update and the bulk create in this package.

.. CG-EXPLANATION-END id=method:LithoLayerBatchUpdateItem._xor_when_anchor_touched

Method ``LithoLayerBatchUpdateItem``. ``def _depth_ordering``
-------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerBatchUpdateItem._depth_ordering lines=69-79

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_request.py
   :language: python
   :lines: 69-79
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerBatchUpdateItem._depth_ordering

**What this does.** The depth rule: when both depths are given, the top must be strictly shallower than the base.

**Why it is here.** An inverted interval is meaningless, so it is caught here rather than left to fail deeper. This same depth-ordering rule recurs across the litho-layer write schemas.

.. CG-EXPLANATION-END id=method:LithoLayerBatchUpdateItem._depth_ordering

Class ``LithoLayerBatchUpdateRequest``
--------------------------------------

.. CG-BLOCK id=class:LithoLayerBatchUpdateRequest lines=80-90

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_batch_update_request.py
   :language: python
   :lines: 80-90
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerBatchUpdateRequest

**What this does.** The whole batch: a list of per-row patches. An empty list is a no-op.

**Why it is here.** All-or-nothing — every id must exist and belong to the model in the address before any row changes; a missing id fails the whole batch with ``422`` and no side effects. This replaces the per-row update loop the desktop used to run.

.. CG-EXPLANATION-END id=class:LithoLayerBatchUpdateRequest

