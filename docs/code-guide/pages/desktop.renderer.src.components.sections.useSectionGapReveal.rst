desktop.renderer.src.components.sections.useSectionGapReveal
============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useSectionGapReveal.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useSectionGapReveal.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionGapReveal.ts
   :language: typescript
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A tiny hook holding the one-shot state for the model-check gap marker in a section view.

**Why it is here.** It drives the brief pulse that lands on the ground between two columns when a model-check finding is revealed.

.. CG-EXPLANATION-END id=module-header

``function useSectionGapReveal``
--------------------------------

.. CG-BLOCK id=function:useSectionGapReveal lines=6-32

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionGapReveal.ts
   :language: typescript
   :lines: 6-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionGapReveal

**What this does.** Holds the pair of investigations to flash, exposes a flashGap callback to set them, and clears them after the flash timeout, cancelling any prior timer first.

**Why it is here.** The timer is cleared on unmount and on a repeat flash so an old pulse never lingers, and it uses the shared flash duration so the pulse matches the Ctrl+F column pulse.

.. CG-EXPLANATION-END id=function:useSectionGapReveal

