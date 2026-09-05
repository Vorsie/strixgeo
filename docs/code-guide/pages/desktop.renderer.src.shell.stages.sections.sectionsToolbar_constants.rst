desktop.renderer.src.shell.stages.sections.sectionsToolbar_constants
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/sectionsToolbar_constants.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/sectionsToolbar_constants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsToolbar_constants.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for a tiny file of fixed pixel widths. The toolbar has an automatic estimator that works out how wide each button is from its icon and label; this file holds the widths for the two controls the estimator cannot guess.

**Why it is here.** The estimator models icon-plus-label buttons. The axis pill (three buttons inside one bordered group) and the pending-tie chip (whose text count changes) are neither, so they declare their width by hand. Every number here is a deliberate slight over-estimate: too wide means the toolbar folds a control a few pixels early, which is invisible; too narrow means it clips, which is the bug the whole overflow system exists to prevent.

.. CG-EXPLANATION-END id=module-header

``const AXIS_PILL_FULL_PX``
---------------------------

.. CG-BLOCK id=const:AXIS_PILL_FULL_PX lines=22-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsToolbar_constants.ts
   :language: typescript
   :lines: 22-29
   :lineno-match:

.. CG-EXPLANATION-START id=const:AXIS_PILL_FULL_PX

**What this does.** The axis pill's width at full labels, 210 pixels.

**Why it is here.** It is the character count of 'Stratigraphy | Litho | Geotech' at the toolbar's per-character width, plus the three segments' padding and the group border, rounded up to keep the over-estimate. The comment records why 210 and not the old 172: the 2026-09-05 display rename of 'Geology' to 'Stratigraphy' widened the first segment, so the old value would now under-budget the row.

.. CG-EXPLANATION-END id=const:AXIS_PILL_FULL_PX

``const AXIS_PILL_COMPACT_PX``
------------------------------

.. CG-BLOCK id=const:AXIS_PILL_COMPACT_PX lines=30-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsToolbar_constants.ts
   :language: typescript
   :lines: 30-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:AXIS_PILL_COMPACT_PX

**What this does.** The pill's width in its designed short form, 146 pixels — 'Geo | Litho | Geotech'.

**Why it is here.** Only the first segment shortens. 'Litho' is already short and 'Geotech' is the segment the owner watched get cut, so it stays spelled out at every width.

.. CG-EXPLANATION-END id=const:AXIS_PILL_COMPACT_PX

``const PENDING_CHIP_BASE_PX``
------------------------------

.. CG-BLOCK id=const:PENDING_CHIP_BASE_PX lines=38-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsToolbar_constants.ts
   :language: typescript
   :lines: 38-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:PENDING_CHIP_BASE_PX

**What this does.** The fixed chrome width of the pending-tie chip — its padding, border and dot — without the label text, 26 pixels.

**Why it is here.** The count inside the chip changes between renders, so the caller adds the label's own width to this base rather than baking a single number in.

.. CG-EXPLANATION-END id=const:PENDING_CHIP_BASE_PX

