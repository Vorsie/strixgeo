desktop.renderer.src.components.borelog.components.GroundwaterLine
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/GroundwaterLine.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/GroundwaterLine.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/GroundwaterLine.tsx
   :language: tsx
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the ``usePxPerM`` scale helper and the translation helper. The comment says this draws a horizontal dashed line marking the water table across the track band, with a small labelled marker above it, and that it is skipped entirely when the water table is below the deepest drawn depth.

**Why it is here.** The water table is a single depth line rather than a track, so it spans across the tracks. The comment records why it is skipped when below the drawn extent: drawing it past the bottom of the canvas would only confuse.

.. CG-EXPLANATION-END id=module-header

``function GroundwaterLine``
----------------------------

.. CG-BLOCK id=function:GroundwaterLine lines=16-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/GroundwaterLine.tsx
   :language: tsx
   :lines: 16-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:GroundwaterLine

**What this does.** The component. It reads the translation helper and the pixels-per-metre scale; if the water depth is deeper than the drawn extent it draws nothing. Otherwise it converts the water depth to a pixel height and draws a blue dashed line across the band with a small italic label naming the level above it.

**Why it is here.** Returning nothing for an out-of-range water table is the skip rule from the comment. ``usePxPerM`` converts the water depth to the same pixel scale the tracks use, so the line sits at the correct true depth across all of them; the label is translated text so it follows the interface language.

.. CG-EXPLANATION-END id=function:GroundwaterLine

