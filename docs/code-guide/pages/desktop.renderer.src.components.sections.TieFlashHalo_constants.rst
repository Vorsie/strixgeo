desktop.renderer.src.components.sections.TieFlashHalo_constants
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/TieFlashHalo_constants.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/TieFlashHalo_constants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieFlashHalo_constants.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the small file holding the three visual constants for the tie landing pulse.

**Why it is here.** Constants live in their own file next to the component that uses them, per the project's constants convention.

.. CG-EXPLANATION-END id=module-header

``const TIE_FLASH_COLOR``
-------------------------

.. CG-BLOCK id=const:TIE_FLASH_COLOR lines=14-16

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieFlashHalo_constants.ts
   :language: typescript
   :lines: 14-16
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_FLASH_COLOR

**What this does.** The pulse colour, amber-500.

**Why it is here.** The docstring: the same value the pending-tie colour and the column-landing flash use, so the highlight belongs to the same family; a literal rather than a utility class because SVG stroke cannot be set by a class.

.. CG-EXPLANATION-END id=const:TIE_FLASH_COLOR

``const TIE_FLASH_WIDTH_PX``
----------------------------

.. CG-BLOCK id=const:TIE_FLASH_WIDTH_PX lines=17-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieFlashHalo_constants.ts
   :language: typescript
   :lines: 17-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_FLASH_WIDTH_PX

**What this does.** The stroke width, 7 px.

**Why it is here.** The comment: fat enough to find on a busy section from across the canvas.

.. CG-EXPLANATION-END id=const:TIE_FLASH_WIDTH_PX

``const TIE_FLASH_OPACITY``
---------------------------

.. CG-BLOCK id=const:TIE_FLASH_OPACITY lines=25-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieFlashHalo_constants.ts
   :language: typescript
   :lines: 25-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_FLASH_OPACITY

**What this does.** The stroke opacity, 0.45.

**Why it is here.** The docstring: low enough that the tie's own thin dashes stay legible through the halo — a highlight that hides its subject has not highlighted anything.

.. CG-EXPLANATION-END id=const:TIE_FLASH_OPACITY

