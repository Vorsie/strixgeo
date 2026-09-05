desktop.renderer.src.components.borelog.components.SelectedSampleMarker
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/SelectedSampleMarker.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/SelectedSampleMarker.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/SelectedSampleMarker.tsx
   :language: tsx
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the sample type and the ``usePxPerM`` scale helper. The comment says this draws a translucent yellow band across the full width of the log marking the selected sample's depth interval, with small triangular markers on each edge; it is drawn after every track so it sits on top, uses a low opacity so the patterns beneath stay readable, gives a spot sample a minimum height so it does not vanish, and lets clicks pass through to the sample row beneath.

**Why it is here.** The band is a highlight overlay rather than a track — an *overlay* being a drawing layer painted on top of the others. The comment records the reasons for its choices: low opacity keeps the underlying lithology legible, the minimum height keeps a zero-thickness point sample visible, and letting clicks pass through preserves the ability to click the sample row it covers.

.. CG-EXPLANATION-END id=module-header

``function SelectedSampleMarker``
---------------------------------

.. CG-BLOCK id=function:SelectedSampleMarker lines=21-64

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/SelectedSampleMarker.tsx
   :language: tsx
   :lines: 21-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:SelectedSampleMarker

**What this does.** The component. It reads the pixels-per-metre scale, converts the sample's top depth and thickness to pixels (with a minimum height), and draws across the full width a translucent yellow rectangle, a solid line on its top and bottom edges, and a small triangle pointing inward on each side.

**Why it is here.** ``usePxPerM`` places the band at the sample's true depth on the shared rail. The specific yellow — a vivid fill at low opacity with a stronger edge — is chosen to be easy to spot yet still see through, and the edge triangles sharpen the "you are here" signal, both recorded in the comment. The whole group ignores pointer events so the sample beneath stays clickable.

.. CG-EXPLANATION-END id=function:SelectedSampleMarker

