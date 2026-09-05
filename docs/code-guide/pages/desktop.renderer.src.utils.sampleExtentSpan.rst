desktop.renderer.src.utils.sampleExtentSpan
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sampleExtentSpan.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sampleExtentSpan.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleExtentSpan.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file works out the vertical extent a lab sample should occupy on a section column — the marker runs from the sample's top depth to its base depth, because a sample covers an interval of the log, not a single point. The import brings in the two shared types it reuses, and re-exports them so callers can get them from here too.

**Why it is here.** The comment records that this supersedes the older mid-depth dot: the engineer needs to see which slice of the log a lab result speaks for. A spot sample (top equal to base) has no height, and a thin sample can shrink below one pixel when zoomed out, so any span shorter than a caller-supplied floor is opened up to that floor and centred on its own interval — findable without ever mis-stating where the sample sits. The horizontal position must go through the spacing-aware transform, never the raw one, so the marker follows the same column nudging every other section overlay applies (memory: the section-view spacing modifier matters for all geometry).

.. CG-EXPLANATION-END id=module-header

``interface SampleExtentSpan``
------------------------------

.. CG-BLOCK id=interface:SampleExtentSpan lines=26-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleExtentSpan.ts
   :language: typescript
   :lines: 26-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleExtentSpan

**What this does.** A declared shape for a marker's drawn extent: its horizontal pixel position, the pixel heights of its shallow and deep ends, and the pixel height between them. The block ends with the documentation for the function below.

**Why it is here.** It names exactly what the caller needs to draw the marker, with the shallow end always the smaller pixel value and the height never below the caller's minimum.

.. CG-EXPLANATION-END id=interface:SampleExtentSpan

``function sampleExtentScreenSpan``
-----------------------------------

.. CG-BLOCK id=function:sampleExtentScreenSpan lines=50-80

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleExtentSpan.ts
   :language: typescript
   :lines: 50-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleExtentScreenSpan

**What this does.** Computes one sample's screen extent on a column. It returns nothing when the borehole has no surface elevation; otherwise it turns the top and base depths into pixel heights, sorts them so the shallow end is on top, opens the span up to the minimum height (growing it evenly about its centre) when it is too short, and places it horizontally through the spacing-aware transform.

**Why it is here.** The docstring records that the horizontal transform MUST be the spacing-aware one so the marker stays aligned with the column glyph at any spacing setting, and that a missing surface elevation makes the vertical position undefined so the marker is skipped. The comment notes the heights are sorted rather than assumed, because a caller or a test may not invert the axis the way the real section does, and the span grows symmetrically so the marker still points at the depth it came from.

.. CG-EXPLANATION-END id=function:sampleExtentScreenSpan

