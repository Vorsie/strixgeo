desktop.renderer.src.utils.psdCurve
===================================

.. CG-PAGE source=desktop/src/renderer/src/utils/psdCurve.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/psdCurve.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the pure maths behind the grain-size-distribution mini-chart. A lab grain-size test arrives from DOV as two matched lists — grain diameters in millimetres and, for each, the percentage of the sample by weight larger than it. The conventional plot wants the grain diameter on a logarithmic left-to-right axis and "percentage finer" up the side, so this file converts the reported "percentage larger" into "percentage finer" and turns the numbers into chart geometry.

**Why it is here.** The comment records that a log grain axis makes the clay, silt, sand and gravel decades each take the same width, and that the axis window is worked out across every test on a sample so two curves on one popup share an x axis and can be compared by eye. Everything is a *pure function* — output depends only on the inputs, with no screen drawing — so the chart geometry can be unit-tested without rendering anything (``psdCurve.test.ts``).

.. CG-EXPLANATION-END id=module-header

``interface PsdSample``
-----------------------

.. CG-BLOCK id=interface:PsdSample lines=22-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 22-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PsdSample

**What this does.** The two matched lists a grain-size lab test reports: the sieve or sedimentation diameters in millimetres, and the percentage by weight larger than each.

**Why it is here.** It names the raw shape the DOV lab result arrives in, so the conversion below has a declared input to read.

.. CG-EXPLANATION-END id=interface:PsdSample

``interface PsdPoint``
----------------------

.. CG-BLOCK id=interface:PsdPoint lines=30-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 30-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PsdPoint

**What this does.** One plotted point on a distribution curve: a grain diameter (always above zero, because the axis is logarithmic) and the percentage of the sample finer than it.

**Why it is here.** It is the converted point the curve is actually drawn from, after "percentage larger" has been turned into "percentage finer".

.. CG-EXPLANATION-END id=interface:PsdPoint

``interface PsdLogDomain``
--------------------------

.. CG-BLOCK id=interface:PsdLogDomain lines=38-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 38-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PsdLogDomain

**What this does.** The inclusive grain-diameter span the log x axis covers: a left-edge diameter and a larger right-edge diameter.

**Why it is here.** It is the shared window that lets two curves on the same card sit on one axis.

.. CG-EXPLANATION-END id=interface:PsdLogDomain

``interface PsdViewBox``
------------------------

.. CG-BLOCK id=interface:PsdViewBox lines=46-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 46-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PsdViewBox

**What this does.** The pixel rectangle the curve is drawn into — a width and a height, with the origin at the top-left corner. The block ends with the documentation for the fixed axis window below.

**Why it is here.** It gives the geometry a target box, so the same curve maths can serve any size of card.

.. CG-EXPLANATION-END id=interface:PsdViewBox

``const PSD_FIXED_DOMAIN``
--------------------------

.. CG-BLOCK id=const:PSD_FIXED_DOMAIN lines=60-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 60-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:PSD_FIXED_DOMAIN

**What this does.** The one x-axis window every PSD card shares: 0.001 mm to 63 mm. The block ends with the documentation for the fraction zones below.

**Why it is here.** The comment records the owner's dogfeed on 2026-08-14 asking for a fixed axis scale so the sand, silt and clay fractions are always easy to see; 0.001–63 mm covers hydrometer clay up to coarse gravel, and any diameter outside it is pinned to the wall rather than drawn outside the box.

.. CG-EXPLANATION-END id=const:PSD_FIXED_DOMAIN

``const PSD_FRACTION_ZONES``
----------------------------

.. CG-BLOCK id=const:PSD_FRACTION_ZONES lines=67-89

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 67-89
   :lineno-match:

.. CG-EXPLANATION-START id=const:PSD_FRACTION_ZONES

**What this does.** The four soil-fraction bands of the fixed axis — clay, silt, sand and gravel — each with its diameter range. The block ends with the documentation for the point-conversion function below.

**Why it is here.** The comment records that the band boundaries follow the ISO 14688 standard (clay/silt at 2 micrometres, silt/sand at 63 micrometres, sand/gravel at 2 mm) and are drawn as fixed gridlines and labels so the fraction can be read at a glance on every card.

.. CG-EXPLANATION-END id=const:PSD_FRACTION_ZONES

``function psdCurvePoints``
---------------------------

.. CG-BLOCK id=function:psdCurvePoints lines=90-123

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 90-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:psdCurvePoints

**What this does.** Turns one lab test into plottable points: it pairs the two lists position by position, converts each percentage-larger into percentage-finer, drops any point the log axis cannot place, and returns the rest ordered smallest grain first.

**Why it is here.** The docstring records the drops: a log axis has no place for a zero or negative diameter, and a non-finite percentage cannot be plotted at all. A mismatched pair of lists contributes only the positions present in both, and the sort makes the line run fine-to-coarse no matter what order the lab wrote its sieve stack in.

.. CG-EXPLANATION-END id=function:psdCurvePoints

``function psdPolyline``
------------------------

.. CG-BLOCK id=function:psdPolyline lines=124-154

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdCurve.ts
   :language: typescript
   :lines: 124-154
   :lineno-match:

.. CG-EXPLANATION-START id=function:psdPolyline

**What this does.** Turns a curve's points into the text an SVG line needs: for each point it places the diameter along the log axis and the percentage-finer up the box, then joins the coordinates into one string. Percentages outside 0–100 from malformed data are pinned to the box edge.

**Why it is here.** The comment records the owner's 2026-08-14 ruling that the x axis is inverted — coarse grains at the left wall, fines at the right, the sieve-curve convention the engineer reads. Because the axis window is fixed, real data can fall outside it (a 100 mm cobble sieve), so it is clamped to the wall rather than drawn outside; a degenerate window with no span is pinned to the left wall to avoid dividing by zero; and the honest value always stays on the point itself.

.. CG-EXPLANATION-END id=function:psdPolyline

