desktop.renderer.src.utils.partitionFillV2.faceLayerIds
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/faceLayerIds.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/faceLayerIds.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faceLayerIds.ts
   :language: typescript
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module works out which drilled units' layer ids produced a coloured face's paint. The rule: a face's layers are the drilled units matching the face's OWN soil; a bounding unit of a different soil merely abuts the face and does not name its layer. It reads two sources — the bounding column-edge unit references, and, on the seed path, an enclosed-lens seed reference.

**Why it is here.** The docstring records why layer ids are used, not body ids: layer ids never change, whereas body id is the label the body recompute itself rewrites, and body-labelled evidence fed back on itself oscillated in production (facts flapping live, dogfeed 2026-08-12 evening). Naming a different-soil bounding unit would state a false cross-soil connectivity fact.

.. CG-EXPLANATION-END id=module-header

``function faceLayerIds``
-------------------------

.. CG-BLOCK id=function:faceLayerIds lines=49-91

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faceLayerIds.ts
   :language: typescript
   :lines: 49-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:faceLayerIds

**What this does.** Returns the de-duplicated layer ids of the drilled units matching a face's soil among its bounding unit references (and any enclosed-lens seed references), in a deterministic order.

**Why it is here.** The docstring notes the enclosed-lens seed form is consulted because the ruling-8r id-split gave a lens's sub-segment its own column edge, and its minority unit was spliced out of the column stack, so only that reference form can resolve it. The ordering matches the body-id pick so the two stay aligned.

.. CG-EXPLANATION-END id=function:faceLayerIds

``function withFaceLayerIds``
-----------------------------

.. CG-BLOCK id=function:withFaceLayerIds lines=92-96

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faceLayerIds.ts
   :language: typescript
   :lines: 92-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:withFaceLayerIds

**What this does.** Sets a face's ``layerIds`` when the list is non-empty and deletes the field when empty, then returns the face.

**Why it is here.** The docstring records the absent-when-empty contract keeps deep-equal pins on layerless output byte-identical, and clears any stale ids a spread may have inherited from a base labelled under a different soil.

.. CG-EXPLANATION-END id=function:withFaceLayerIds

