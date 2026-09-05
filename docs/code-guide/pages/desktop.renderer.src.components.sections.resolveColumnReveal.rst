desktop.renderer.src.components.sections.resolveColumnReveal
============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/resolveColumnReveal.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/resolveColumnReveal.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/resolveColumnReveal.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A pure helper that turns a request to reveal some investigations into a single screen X to centre the camera on, using the section panel's own list of drawn columns.

**Why it is here.** The docstring makes the rule explicit: resolving where a column is drawn belongs to the surface that drew it, and only that surface. Handing a position or a column index across a surface boundary already cost a real bug on the crossing chip, where a conflict's ``gapIndex`` indexed the litho frame's column list rather than the caller's. Being pure means the rule can be pinned in a test without mounting the four-thousand-line panel.

.. CG-EXPLANATION-END id=module-header

``interface ColumnPosition``
----------------------------

.. CG-BLOCK id=interface:ColumnPosition lines=20-27

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/resolveColumnReveal.ts
   :language: typescript
   :lines: 20-27
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnPosition

**What this does.** One drawn column reduced to just what centring needs: the investigation id and the screen X it is actually drawn at, after packing and nudging.

**Why it is here.** The centre must be computed from the true drawn position, not the raw projected one, or it would miss where the column really sits.

.. CG-EXPLANATION-END id=interface:ColumnPosition

``interface ResolvedReveal``
----------------------------

.. CG-BLOCK id=interface:ResolvedReveal lines=28-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/resolveColumnReveal.ts
   :language: typescript
   :lines: 28-54
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ResolvedReveal

**What this does.** The result: the screen X to centre on, or nothing when anything asked for is not drawn, plus the requested ids that had no drawn column, in the order they were asked.

**Why it is here.** It returns nothing rather than a best effort, because panning to the one end that IS drawn would falsely tell the engineer the whole tie is on screen when half of it is not.

.. CG-EXPLANATION-END id=interface:ResolvedReveal

``function resolveColumnReveal``
--------------------------------

.. CG-BLOCK id=function:resolveColumnReveal lines=55-72

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/resolveColumnReveal.ts
   :language: typescript
   :lines: 55-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveColumnReveal

**What this does.** Looks up each requested investigation's drawn X; if any is missing, or none were asked for, it returns nothing plus the missing ids; otherwise it returns the midpoint of their span.

**Why it is here.** It uses the midpoint of the span, not the average of the positions, because with three or more columns the average drifts toward wherever they cluster, and the whole point of the pan is to frame the entire tie.

.. CG-EXPLANATION-END id=function:resolveColumnReveal

