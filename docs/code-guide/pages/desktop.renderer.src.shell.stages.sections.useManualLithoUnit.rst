desktop.renderer.src.shell.stages.sections.useManualLithoUnit
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useManualLithoUnit.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useManualLithoUnit.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useManualLithoUnit.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the two handlers behind manually creating a litho unit on the litho axis — the composition picker's 'new unit' tab and its 'existing unit' tab.

**Why it is here.** Extracted verbatim from the canvas (debt #201 round 2). Owner dogfeed 2026-05-27: 'don't wire it through the suggestion — it immediately becomes an accepted litho layer, the user can always right-click delete anyway.' So the new-unit path direct-inserts a committed layer via two accept calls rather than a create-then-ghost-then-accept chain.

.. CG-EXPLANATION-END id=module-header

``interface UseManualLithoUnitDeps``
------------------------------------

.. CG-BLOCK id=interface:UseManualLithoUnitDeps lines=23-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useManualLithoUnit.ts
   :language: typescript
   :lines: 23-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseManualLithoUnitDeps

**What this does.** What the handlers consume: the active litho model, the selected section, the project id, the section-update and refetch callbacks, the litho contacts, and the two formation vocabularies.

**Why it is here.** The surrounding band's lithology is looked up from the contacts and formations, so the handler needs both; the section-update callback keeps the explicit-content filter current after the insert.

.. CG-EXPLANATION-END id=interface:UseManualLithoUnitDeps

``interface UseManualLithoUnitResult``
--------------------------------------

.. CG-BLOCK id=interface:UseManualLithoUnitResult lines=45-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useManualLithoUnit.ts
   :language: typescript
   :lines: 45-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseManualLithoUnitResult

**What this does.** The two handlers: create a new unit from a main soil code and admixtures at a depth, and pick an existing unit's formation and reuse the same insert.

**Why it is here.** The existing-unit path is just a lookup that feeds the new-unit path, so both live behind one hook.

.. CG-EXPLANATION-END id=interface:UseManualLithoUnitResult

``function useManualLithoUnit``
-------------------------------

.. CG-BLOCK id=function:useManualLithoUnit lines=74-334

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useManualLithoUnit.ts
   :language: typescript
   :lines: 74-334
   :lineno-match:

.. CG-EXPLANATION-START id=function:useManualLithoUnit

**What this does.** The new-unit handler snapshots the surrounding band before mutating, inserts the engineer's chosen layer as a top contact at the click depth, then — unless the surrounding is the same soil — inserts a restoration contact just below carrying the surrounding band's lithology so the original band continues underneath; it refetches formations and contacts afterwards. The existing-unit handler looks up the picked formation's soil and admixtures and calls the new-unit handler with them.

**Why it is here.** The result is three visible bands instead of two — the original split into top and bottom pieces with the new layer between — and no pending-ghost state, so the engineer can right-click Remove to undo and the same-litho merge re-fuses the surrounding pieces. The refetch is required or the in-corridor filter keeps the old contact list and renders nothing for the new contact (owner dogfeed 2026-05-27: 'select a unit but nothing is being rendered').

.. CG-EXPLANATION-END id=function:useManualLithoUnit

