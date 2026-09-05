desktop.renderer.src.components.sections.useContactPicker
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useContactPicker.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useContactPicker.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useContactPicker.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A hook for the click-to-place formation-contact picker: click a depth on a CPT data band or a borehole strip, choose a formation in a modal, and a contact is created there.

**Why it is here.** Debt #30. It encapsulates the panel's previous inline pick-context state and its three handlers. The snapped flag flows from the click site all the way through to the create handler, so the caller can stamp the contact's source and confidence based on whether the depth came from a snap to a stratigraphy boundary or from a free click (debt #22 and #23).

.. CG-EXPLANATION-END id=module-header

``interface PickContextState``
------------------------------

.. CG-BLOCK id=interface:PickContextState lines=26-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useContactPicker.ts
   :language: typescript
   :lines: 26-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PickContextState

**What this does.** The open picker's state: kind, the anchor's id and name, the depth, the elevation, and whether the depth was snapped.

**Why it is here.** It pre-seeds the formation-picker modal with the click's own metadata.

.. CG-EXPLANATION-END id=interface:PickContextState

``interface CptPickAnchor``
---------------------------

.. CG-BLOCK id=interface:CptPickAnchor lines=35-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useContactPicker.ts
   :language: typescript
   :lines: 35-43
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptPickAnchor

**What this does.** The anchor a CPT-band click supplies, with snapped always false.

**Why it is here.** A CPT band has no stratigraphy boundaries to snap to, so its clicks are always free depths.

.. CG-EXPLANATION-END id=interface:CptPickAnchor

``interface BoreholePickAnchor``
--------------------------------

.. CG-BLOCK id=interface:BoreholePickAnchor lines=44-58

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useContactPicker.ts
   :language: typescript
   :lines: 44-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholePickAnchor

**What this does.** The anchor a borehole-strip click supplies, carrying a snapped flag.

**Why it is here.** A borehole strip has stratigraphy boundaries to snap to, and the snap flag decides the stamped source and confidence.

.. CG-EXPLANATION-END id=interface:BoreholePickAnchor

``type OnCreateContact``
------------------------

.. CG-BLOCK id=type:OnCreateContact lines=59-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useContactPicker.ts
   :language: typescript
   :lines: 59-66
   :lineno-match:

.. CG-EXPLANATION-START id=type:OnCreateContact

**What this does.** The caller-supplied create hook: given the anchor kind, id, depth, chosen formation and the snapped flag, it makes the contact.

**Why it is here.** The caller uses the snapped flag to set the new contact's source and confidence (debt #22 and #23).

.. CG-EXPLANATION-END id=type:OnCreateContact

``interface UseContactPickerResult``
------------------------------------

.. CG-BLOCK id=interface:UseContactPickerResult lines=67-86

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useContactPicker.ts
   :language: typescript
   :lines: 67-86
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseContactPickerResult

**What this does.** What the hook returns: the pick context, the two click handlers, the modal-commit handler, and a cancel.

**Why it is here.** The modal commit forwards to the create hook and then clears the state; cancel clears the state without committing.

.. CG-EXPLANATION-END id=interface:UseContactPickerResult

``function useContactPicker``
-----------------------------

.. CG-BLOCK id=function:useContactPicker lines=87-138

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useContactPicker.ts
   :language: typescript
   :lines: 87-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:useContactPicker

**What this does.** Holds the pick context, opens it from a CPT or borehole click, commits by calling the create hook and then clearing, and cancels by clearing.

**Why it is here.** When the section is mounted read-only, with no active geological model, the create hook is absent and the commit simply clears the state without calling back, which matches the previous inline behaviour.

.. CG-EXPLANATION-END id=function:useContactPicker

