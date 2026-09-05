groundmodel.api.schemas.project.litho_layer.litho_layer_update_request
======================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_layer/litho_layer_update_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_layer/litho_layer_update_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_update_request.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID and ``model_validator``, the three value-lists, and the strict base class.

**Why it is here.** Standard imports for a single-row patch schema with whole-object checks.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerUpdateRequest`` — header
------------------------------------------

.. CG-BLOCK id=class:LithoLayerUpdateRequest lines=17-37

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_update_request.py
   :language: python
   :lines: 17-37
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerUpdateRequest

**What this does.** The body for a single-row patch: every editable field is optional, and only the fields present are written. The anchor pair is editable.

**Why it is here.** Making the anchor pair editable lets a drag-to-re-anchor gesture work without deleting and recreating the row. Only present fields are written, matching PATCH semantics.

.. CG-EXPLANATION-END id=class:LithoLayerUpdateRequest

Method ``LithoLayerUpdateRequest``. ``def _xor_when_anchor_touched``
--------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerUpdateRequest._xor_when_anchor_touched lines=38-59

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_update_request.py
   :language: python
   :lines: 38-59
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerUpdateRequest._xor_when_anchor_touched

**What this does.** The same anchor rule as the batch item: touch either anchor field and both must be present with exactly one non-null.

**Why it is here.** Same early-clear-``422`` reasoning, mirroring the formation-contact update so the two behave identically (see the batch-update page for the full explanation of this rule).

.. CG-EXPLANATION-END id=method:LithoLayerUpdateRequest._xor_when_anchor_touched

Method ``LithoLayerUpdateRequest``. ``def _depth_ordering``
-----------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerUpdateRequest._depth_ordering lines=60-73

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_layer/litho_layer_update_request.py
   :language: python
   :lines: 60-73
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerUpdateRequest._depth_ordering

**What this does.** The same depth rule: when both depths are sent, top must be strictly shallower than base; when only one is sent, the stored other end is trusted.

**Why it is here.** Rejects an inverted interval at the boundary. When only one end is patched the caller is responsible for not crossing the stored end — the same depth-ordering rule as the other litho-layer write schemas.

.. CG-EXPLANATION-END id=method:LithoLayerUpdateRequest._depth_ordering

