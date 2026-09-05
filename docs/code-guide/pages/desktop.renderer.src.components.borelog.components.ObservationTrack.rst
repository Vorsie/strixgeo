desktop.renderer.src.components.borelog.components.ObservationTrack
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/ObservationTrack.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/ObservationTrack.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/ObservationTrack.tsx
   :language: tsx
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the observation types, the soil-pattern fill helper, the lithology and stratigraphy type sets, the ``truncate`` and ``usePxPerM`` helpers, and the three sibling pieces — admixture chips, admixture strips, and wrapped text. The comment says this draws one observation stream as a vertical column, with lithology streams using soil-pattern fills plus admixture chips and strips, stratigraphy streams using a soft tint with the formation code centred, and everything else falling through to a plain free-text card.

**Why it is here.** One observation stream is one of the depth tracks introduced on the ``desktop.renderer.src.components.borelog.components.AdmixtureChips`` page. Splitting the drawing into three styles matches the three kinds of content a borehole records — coded soil, formation names, and free description — so each reads in the form that suits it.

.. CG-EXPLANATION-END id=module-header

``function ObservationTrack``
-----------------------------

.. CG-BLOCK id=function:ObservationTrack lines=24-87

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/ObservationTrack.tsx
   :language: tsx
   :lines: 24-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:ObservationTrack

**What this does.** The track component. It reads the shared pixels-per-metre scale, decides whether this stream is lithology, stratigraphy or a plain text card, draws a full-depth background rectangle, and then draws each layer through the layer-block helper below.

**Why it is here.** Deciding the style once at the top and passing it down keeps every layer in the stream drawn the same way. ``usePxPerM`` supplies the shared depth scale so the track lines up with all the others.

.. CG-EXPLANATION-END id=function:ObservationTrack

``function ObservationLayerBlock``
----------------------------------

.. CG-BLOCK id=function:ObservationLayerBlock lines=88-242

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/ObservationTrack.tsx
   :language: tsx
   :lines: 88-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:ObservationLayerBlock

**What this does.** Draws one layer rectangle inside the track. It converts the layer's top and base depths to pixel positions, works out the main soil code and the admixture text, and builds a hover tooltip listing the layer's full facts. For a lithology layer it splits the width into a main soil-pattern fill on the left and an admixture strip on the right, adds a code badge at the top-left and a chip row along the bottom; for a stratigraphy layer it centres the wrapped formation code; for a card layer it writes the free-text label. Every variant prints the top and bottom depth labels in the corner.

**Why it is here.** Reserving a right-edge strip for admixtures means even a thin layer, too short for text chips, still shows visually that something is mixed in — the comment records this intent. The soil-pattern fills come from the pattern helper and are the domain patterns of the ISO 14688-1 standard, whose hues must not be changed; the badges and card backgrounds use theme colour variables so they stay legible on both the pattern fills and the dark track. Text and chips are drawn only when the layer is tall enough, so a short layer never shows clipped content while its tooltip still carries the full detail.

.. CG-EXPLANATION-END id=function:ObservationLayerBlock

