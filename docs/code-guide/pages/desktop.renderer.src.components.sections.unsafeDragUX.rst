desktop.renderer.src.components.sections.unsafeDragUX
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/unsafeDragUX.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/unsafeDragUX.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unsafeDragUX.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The pure decision helpers behind the owner's red-handle-and-snapback drag feel.

**Why it is here.** When a live freedraw drag (a lens apex or a matched boundary) reaches a spot the partition engine refuses as unsafe (it would open a gap or an overlap), the engine keeps the never-a-gap-or-overlap guarantee by rendering the un-reshaped base fill on that frame, so the visible body already sits at its last safe shape, and it reports a rejected status. This module turns that per-frame status into the two owner-chosen responses: a red handle while rejected, and a snap back on release that discards the unsafe node. They are pure functions so the large overlay component only wires them and the decision logic is tested in isolation.

.. CG-EXPLANATION-END id=module-header

``type OverrideStatus``
-----------------------

.. CG-BLOCK id=type:OverrideStatus lines=25-46

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unsafeDragUX.ts
   :language: typescript
   :lines: 25-46
   :lineno-match:

.. CG-EXPLANATION-START id=type:OverrideStatus

**What this does.** The status a freedraw override pass reports: applied, rejected-unsafe, rejected-collapse, or unsupported.

**Why it is here.** ``rejected-unsafe`` means the reach would gap or overlap the partition; ``rejected-collapse`` (added S97, owner-locked 2026-07-23) means the reach was gap-safe but over-reached a column and flooded the edited tip into a full-width band. Both drive the same red-handle and snap-back response.

.. CG-EXPLANATION-END id=type:OverrideStatus

``type EditableTargetIdentity``
-------------------------------

.. CG-BLOCK id=type:EditableTargetIdentity lines=47-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unsafeDragUX.ts
   :language: typescript
   :lines: 47-67
   :lineno-match:

.. CG-EXPLANATION-START id=type:EditableTargetIdentity

**What this does.** A precise identifier for the ONE node a freedraw gesture operates on: either a lens node (body, gap, edge, node index) or a shared-boundary node (upper body, lower body, gap, node index).

**Why it is here.** This is the §87 fix. A rendered body carries many handles (both lens edges, several stacked tips across gaps, and its shared-boundary contact), so a body-level rejection reddened all of them at once, the reported many-markers-turn-red case measured at nine sibling handles on real CS1. This union pins the exact node. The per-frame region index is deliberately left out of the identity because it re-indexes as the partition regenerates mid-drag; the stable identity is body, gap, edge and node.

.. CG-EXPLANATION-END id=type:EditableTargetIdentity

``function sameEditableTarget``
-------------------------------

.. CG-BLOCK id=function:sameEditableTarget lines=68-110

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unsafeDragUX.ts
   :language: typescript
   :lines: 68-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:sameEditableTarget

**What this does.** Tests whether two of those identities are the exact same node, matching the kind and every discriminating field, with nothing on either side counting as not equal.

**Why it is here.** It is the one canonical equality helper the §87 brief mandates, used by the active-drag render, the red rejection render, the release snap-back, and the diagnostics, so all of them agree on one target.

.. CG-EXPLANATION-END id=function:sameEditableTarget

``function handleColorForTarget``
---------------------------------

.. CG-BLOCK id=function:handleColorForTarget lines=111-123

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unsafeDragUX.ts
   :language: typescript
   :lines: 111-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:handleColorForTarget

**What this does.** Returns red for a handle only when its identity IS the rejected target, and its normal colour otherwise.

**Why it is here.** So a sibling handle of the same body, its other lens edge or another gap's tip, stays its normal colour; this supersedes the older body-level colouring that reddened every handle sharing the dragged body's id.

.. CG-EXPLANATION-END id=function:handleColorForTarget

``const REJECT_COLOR``
----------------------

.. CG-BLOCK id=const:REJECT_COLOR lines=124-141

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unsafeDragUX.ts
   :language: typescript
   :lines: 124-141
   :lineno-match:

.. CG-EXPLANATION-START id=const:REJECT_COLOR

**What this does.** The red hue for a rejected drag.

**Why it is here.** It is the established danger-stroke colour used across the section overlays, and it reads clearly against both the amber lens handles and the sky-blue boundary handles.

.. CG-EXPLANATION-END id=const:REJECT_COLOR

``function isDragRejected``
---------------------------

.. CG-BLOCK id=function:isDragRejected lines=142-163

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unsafeDragUX.ts
   :language: typescript
   :lines: 142-163
   :lineno-match:

.. CG-EXPLANATION-START id=function:isDragRejected

**What this does.** Says whether the current live-drag outcome is a rejection, meaning either rejected-unsafe or rejected-collapse.

**Why it is here.** Both reddens and snaps back; the collapse case (owner-locked 2026-07-23) behaves exactly like the unsafe case, and in both the handle stays alive at the last-safe shape rather than being hidden.

.. CG-EXPLANATION-END id=function:isDragRejected

``function shouldPersistDrag``
------------------------------

.. CG-BLOCK id=function:shouldPersistDrag lines=164-166

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unsafeDragUX.ts
   :language: typescript
   :lines: 164-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldPersistDrag

**What this does.** Says whether a drag should persist on release or snap back; it returns false only for a rejection.

**Why it is here.** An unsafe node must never be saved; an applied drag is a genuine safe reshape and persists, and an unsupported result (no override present, or the older engine with no rejection model) keeps the pre-existing save behaviour.

.. CG-EXPLANATION-END id=function:shouldPersistDrag

