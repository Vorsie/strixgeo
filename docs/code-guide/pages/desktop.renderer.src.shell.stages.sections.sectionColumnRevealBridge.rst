desktop.renderer.src.shell.stages.sections.sectionColumnRevealBridge
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/sectionColumnRevealBridge.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/sectionColumnRevealBridge.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionColumnRevealBridge.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A second shared box, this one from the whole app shell down to the canvas: 'bring this test's column on screen'. Two callers on the Geotechnical stage — the Build pre-flight's one-click visit and the gapless-build report's 'Show me' — have to land on the Sections stage and centre a column.

**Why it is here.** Switching stage and selecting the section is the shell's job, but the pan and the pulse belong to the surface that draws the columns, and nothing between them shares a React parent. Callers name only INVESTIGATIONS, never a column index or position: naming a gap by its index has already caused one real bug, so a gap is always named by its two end columns, which the panel resolves against its own column list. Null while the canvas is not mounted means a caller that asked too early simply gets false back.

.. CG-EXPLANATION-END id=module-header

``const sectionsRevealColumnCallback``
--------------------------------------

.. CG-BLOCK id=const:sectionsRevealColumnCallback lines=40-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionColumnRevealBridge.ts
   :language: typescript
   :lines: 40-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:sectionsRevealColumnCallback

**What this does.** The shared box holding the canvas's 'reveal these investigations' function, or null. One id centres and pulses that one column; two ids centre on the midpoint of the gap between them.

**Why it is here.** Registered by the canvas while it is mounted and called by the shell once a deep-link's stage switch and section select have settled — same passive-when-null contract as the pending-tie bridge above.

.. CG-EXPLANATION-END id=const:sectionsRevealColumnCallback

