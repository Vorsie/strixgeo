desktop.renderer.src.components.borelog.components.LegendSection
================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/LegendSection.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/LegendSection.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/LegendSection.tsx
   :language: tsx
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one import and its documentation comment. The comment says this draws one section of the bottom-of-log legend — a small-caps title above a wrapping row of chips — used once per category, and that the parent legend leaves a section out entirely when there is nothing to show so the row never lands empty.

**Why it is here.** Grouping chips under a titled heading keeps each legend category separated and scannable, and the empty-section omission is enforced by the parent, matching the collapse-around-content behaviour described on the ``desktop.renderer.src.components.borelog.components.Legend`` page.

.. CG-EXPLANATION-END id=module-header

``function LegendSection``
--------------------------

.. CG-BLOCK id=function:LegendSection lines=12-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/LegendSection.tsx
   :language: tsx
   :lines: 12-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:LegendSection

**What this does.** The component. It draws a small uppercase title, then a wrapping container holding the chips passed to it.

**Why it is here.** A tiny reusable wrapper so every legend section has the same title style and chip layout; it holds no data of its own and only arranges what it is given.

.. CG-EXPLANATION-END id=function:LegendSection

