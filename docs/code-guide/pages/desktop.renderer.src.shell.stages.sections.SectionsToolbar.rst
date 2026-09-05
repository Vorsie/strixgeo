desktop.renderer.src.shell.stages.sections.SectionsToolbar
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-86

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx
   :language: tsx
   :lines: 1-86
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the Sections stage's top action row. It brings in the shell bus, the responsive-row primitive that lays verbs out, the store hooks for every view toggle, the three bare-key accelerators (P, L, F), and the several extracted hooks and pure builders that hold the litho, geotech, export and shared verbs.

**Why it is here.** The verbs are declared as data (item specs) rather than drawn straight into a row, so the responsive row can decide what fits — after the owner saw the axis pill read 'Geology | Litho | Geote' on a fullscreen laptop (dogfeed 2026-08-26). Almost all of this component's machinery has been pulled into the imported hooks and builders because the file crossed the god-component threshold (debt #201).

.. CG-EXPLANATION-END id=module-header

``function SectionsToolbar``
----------------------------

.. CG-BLOCK id=function:SectionsToolbar lines=87-959

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx
   :language: tsx
   :lines: 87-959
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionsToolbar

**What this does.** The toolbar component. It reads dozens of pieces of state and handlers off the shell bus, binds the three accelerator keys (each announcing its new state through a replace-keyed toast), derives everything the verb builders need — the axis flags, whether the section has litho contacts or packing bands, what a subdivide would destroy, whether ties block the divide, the pending-tie scope — then calls the four builders (head, litho, geotech, tail) to produce the item list, wires the bare-key shortcuts, and renders the responsive row followed by the dialog stack. It owns the create/delete/reset-boundaries handlers and the recompute-bodies escape hatch.

**Why it is here.** The three accelerator hooks sit AFTER the shell destructure on purpose: they read the toast function, and hoisting them up with the other store hooks would be a temporal-dead-zone crash that no type check catches. Several derived consts (the pending scope, the subdivide scope) are declared before the gates that read them for the same reason — a read above a const's declaration is a runtime ReferenceError that tsc and unit tests miss until the toolbar actually renders. The three axis blocks are kept as separate consts, each defined before the array that spreads it, to avoid that same dead-zone read. The section-has-bands and re-subdivide-scope derivations use one shared reading of 'does this section have bands' so the gates and the confirmation dialog cannot disagree.

.. CG-EXPLANATION-END id=function:SectionsToolbar

