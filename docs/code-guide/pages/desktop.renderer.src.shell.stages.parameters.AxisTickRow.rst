desktop.renderer.src.shell.stages.parameters.AxisTickRow
========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/AxisTickRow.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/AxisTickRow.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/AxisTickRow.tsx
   :language: tsx
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the shared component that draws the labelled tick row under a horizontal value axis. A tick is one labelled mark on an axis. It imports the tick-label formatter and the tick-step reader from the CPT axis-scale utilities.

**Why it is here.** One component for every panel that labels a horizontal value axis — the CPT distribution rows and the identification scatter panels — so the label treatment cannot drift between them. It is HTML text, not SVG text, because the plots stretch a user-space viewBox non-uniformly and that would distort the glyphs. This is the S3 ruling (owner 2026-08-27: 'I want more sublabels on all axis ticks not too many'); the tick values come from the one tick-step source and this row only places and formats them.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=16-58

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/AxisTickRow.tsx
   :language: tsx
   :lines: 16-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares the row's inputs: the ascending tick values, the axis-end value used as the position denominator, an optional unit string appended to the end label, test ids for the zero, end and interior labels, extra CSS classes, and an optional verbatim end label for axes whose end is not itself a tick.

**Why it is here.** The end-label option handles the identification panels, whose axis ends at the exact pooled maximum rather than on a round tick; there the last tick becomes an interior label and the supplied text anchors the right end instead.

.. CG-EXPLANATION-END id=interface:Props

``function AxisTickRow``
------------------------

.. CG-BLOCK id=function:AxisTickRow lines=59-102

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/AxisTickRow.tsx
   :language: tsx
   :lines: 59-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:AxisTickRow

**What this does.** Draws the label row: the first tick anchored left, the last anchored right (or the verbatim end label when one is given), and the interior ticks centred on their positions. Interior labels within 6 percent of either end are dropped, and the whole row renders nothing when there are too few ticks or the axis end is not positive.

**Why it is here.** Anchoring the ends inward stops them overhanging the row, and dropping the crowding interior labels keeps it to the owner's 'not too many'. Positioning each label at its value divided by the axis maximum, as a percentage, matches the same zero-anchored mapping the plot uses, so the labels line up with the marks above them.

.. CG-EXPLANATION-END id=function:AxisTickRow

