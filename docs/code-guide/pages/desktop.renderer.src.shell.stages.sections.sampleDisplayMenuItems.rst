desktop.renderer.src.shell.stages.sections.sampleDisplayMenuItems
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/sampleDisplayMenuItems.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/sampleDisplayMenuItems.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sampleDisplayMenuItems.tsx
   :language: tsx
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for a helper that builds the two lab-sample view toggles — 'show sample markers' and 'show grain-size preview on hover' — as toolbar menu rows.

**Why it is here.** The sample markers and their grain-size card draw on BOTH the litho and geotech axes, so both switches must be reachable from both axes' menus. That is two identical blocks, so they live here once (extract on the second copy) rather than being pasted into each menu. The two menus differ only in icon size and a test-id prefix, both passed in.

.. CG-EXPLANATION-END id=module-header

``interface SampleDisplayMenuItemsInput``
-----------------------------------------

.. CG-BLOCK id=interface:SampleDisplayMenuItemsInput lines=22-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sampleDisplayMenuItems.tsx
   :language: tsx
   :lines: 22-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleDisplayMenuItemsInput

**What this does.** The inputs a calling menu supplies: the translator, the current on/off state of the two toggles, a test-id prefix ('geotech' or 'litho'), and the icon pixel size.

**Why it is here.** Threading the translator in from the caller means a language flip re-renders both items in one pass. The prefix and size are the only real differences between the two menus, so they are parameters.

.. CG-EXPLANATION-END id=interface:SampleDisplayMenuItemsInput

``function sampleDisplayMenuItems``
-----------------------------------

.. CG-BLOCK id=function:sampleDisplayMenuItems lines=45-70

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sampleDisplayMenuItems.tsx
   :language: tsx
   :lines: 45-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleDisplayMenuItems

**What this does.** Returns the two menu rows: a markers toggle (with an eye / crossed-eye icon and a keyboard hint of 'p') and a grain-size-preview toggle, each labelled with the state a click will move it TO, and each wired to flip its shared store.

**Why it is here.** The dropdown control has no checkmark, so — like every sibling toggle here — the label names the state the click will produce. A store is a small shared value the whole app can read and flip; the toggles flip the markers and preview stores.

.. CG-EXPLANATION-END id=function:sampleDisplayMenuItems

