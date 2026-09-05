desktop.renderer.src.components.borelog.components.LegendChip
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/LegendChip.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/LegendChip.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/LegendChip.tsx
   :language: tsx
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one import and its documentation comment. The comment says this is a single entry inside a legend section, laid out as a small preview, a code and a label; the preview is any drawing (a soil-pattern square, a colour swatch or a test icon) so the chip stays generic, and the code is drawn in a fixed-width font.

**Why it is here.** The code is shown in a fixed-width font so the raw DOV vocabulary tokens line up neatly down the rows — this is the raw-token side of the translate-at-the-presentation-boundary rule: the original token is shown alongside its translated label, so a domain expert can verify the mapping. Keeping the preview arbitrary lets one chip serve every legend category.

.. CG-EXPLANATION-END id=module-header

``function LegendChip``
-----------------------

.. CG-BLOCK id=function:LegendChip lines=13-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/LegendChip.tsx
   :language: tsx
   :lines: 13-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:LegendChip

**What this does.** The component. It draws the optional preview, then the code in a muted fixed-width font, then the label.

**Why it is here.** A single small reusable chip keeps every legend entry consistent across categories, the shared-primitive idea introduced on the ``desktop.renderer.src.components.ui.Button`` page. Showing the raw code next to the readable label lets the engineer confirm what each token means without leaving the log.

.. CG-EXPLANATION-END id=function:LegendChip

