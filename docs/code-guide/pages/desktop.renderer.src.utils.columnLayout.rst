desktop.renderer.src.utils.columnLayout
=======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/columnLayout.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/columnLayout.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLayout.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing the column-nudging problem and its fix. When several investigations project to almost the same distance along a cross-section, their columns overlap into an unreadable stack; this module pushes each crowded column rightward just enough to fit a minimum gap, while the renderer draws a tie-back diagonal from the moved column to a tick at its true projected position, so the reader sees both where the column is drawn and where it really projects.

**Why it is here.** The comment records the decisions: the spacing rule is edge-to-edge (each column declares its own width) rather than centre-to-centre, because once qc curves and interpretation tracks land inside columns their widths vary, and a fixed centre-gap would either waste space or under-space wide columns; and the algorithm is a single left-to-right pass that cascades a tight cluster rightward, leaving a fancier centre-on-mean distribution for later since the tie-backs already make the asymmetry inspectable.

.. CG-EXPLANATION-END id=module-header

``interface NudgeInput``
------------------------

.. CG-BLOCK id=interface:NudgeInput lines=33-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLayout.ts
   :language: typescript
   :lines: 33-42
   :lineno-match:

.. CG-EXPLANATION-START id=interface:NudgeInput

**What this does.** Describes what each column contributes to the layout: the pixel position where it would naturally land, and its visible width at its widest point.

**Why it is here.** The comments record that the width is needed because the nudge enforces clear space between adjacent edges, so mixed-width columns space correctly.

.. CG-EXPLANATION-END id=interface:NudgeInput

``interface NudgeResult``
-------------------------

.. CG-BLOCK id=interface:NudgeResult lines=43-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLayout.ts
   :language: typescript
   :lines: 43-75
   :lineno-match:

.. CG-EXPLANATION-START id=interface:NudgeResult

**What this does.** Describes what comes back per column: the column itself, its true (un-moved) position, its drawn position after nudging, and whether it was displaced.

**Why it is here.** The comments record that the true position is surfaced at the top level so callers need not reach into the generic, and the displaced flag tells the renderer whether to draw a tie-back — it is true only when the column moved more than half a pixel.

.. CG-EXPLANATION-END id=interface:NudgeResult

``function nudgeColumns``
-------------------------

.. CG-BLOCK id=function:nudgeColumns lines=76-115

.. literalinclude:: ../../../desktop/src/renderer/src/utils/columnLayout.ts
   :language: typescript
   :lines: 76-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:nudgeColumns

**What this does.** Takes the columns, a minimum edge gap, and an optional per-pair gap override, and returns them in left-to-right order with each column's drawn position. It sorts a copy by true position, then walks it once, pushing each column to keep at least the required clear space from the previous column's edge; the first column stays at its true position and each later one moves only if it must.

**Why it is here.** The docstring records that the original array is not changed, and that the per-pair override exists so a correlation linking two columns can request a larger gap to leave room for the ribbon between them; the comment on the displaced test records that half a pixel is below screen granularity, so anything smaller counts as effectively at the true position.

.. CG-EXPLANATION-END id=function:nudgeColumns

