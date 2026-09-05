desktop.renderer.src.components.sections.removeFromSectionCommand
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/removeFromSectionCommand.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/removeFromSectionCommand.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/removeFromSectionCommand.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A pure factory that builds the undo command for the Remove-from-section gesture, the Ctrl+Z that puts a removed test back on the section.

**Why it is here.** Extracted from the section panel so the undo wiring can be unit-tested without spinning up the whole render path. The command captures the pre-remove list, so if the user adds other exclusions between this remove and a later undo, those intermediate adds are lost; this is stated as acceptable for the first version (dogfeed 2026-05-23).

.. CG-EXPLANATION-END id=module-header

``interface RemoveFromSectionPatch``
------------------------------------

.. CG-BLOCK id=interface:RemoveFromSectionPatch lines=16-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/removeFromSectionCommand.ts
   :language: typescript
   :lines: 16-20
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RemoveFromSectionPatch

**What this does.** The small patch shape sent to the section: the updated excluded-CPT id list and excluded-borehole id list, either one optional.

**Why it is here.** A section hides investigations through these two id lists, so a remove just adds an id to the right one.

.. CG-EXPLANATION-END id=interface:RemoveFromSectionPatch

``interface RemoveFromSectionCommand``
--------------------------------------

.. CG-BLOCK id=interface:RemoveFromSectionCommand lines=21-58

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/removeFromSectionCommand.ts
   :language: typescript
   :lines: 21-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RemoveFromSectionCommand

**What this does.** The pair the factory hands back: ``firstApply`` to do the remove once, and ``undoCmd`` to push on the shared undo stack, which carries a description, a revert to the pre-remove list, and a reapply of the remove.

**Why it is here.** It matches the shared undo-stack contract of revert and reapply plus a human-readable description.

.. CG-EXPLANATION-END id=interface:RemoveFromSectionCommand

``function buildRemoveFromSectionCommand``
------------------------------------------

.. CG-BLOCK id=function:buildRemoveFromSectionCommand lines=59-87

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/removeFromSectionCommand.ts
   :language: typescript
   :lines: 59-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildRemoveFromSectionCommand

**What this does.** Builds that pair for a given kind (CPT or borehole) and id: it snapshots the current excluded list, appends the id with duplicates removed, and wires ``firstApply``, ``revert`` and ``reapply`` to patch the correct list.

**Why it is here.** Removing a test from a section is a reversible, project-local hide, not a database delete, so per the UX rules it fires immediately and provides an undo path; the captured snapshot is what lets ``revert`` restore exactly the pre-remove state.

.. CG-EXPLANATION-END id=function:buildRemoveFromSectionCommand

