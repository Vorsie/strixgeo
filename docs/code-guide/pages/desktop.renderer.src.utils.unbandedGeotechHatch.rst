desktop.renderer.src.utils.unbandedGeotechHatch
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/unbandedGeotechHatch.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/unbandedGeotechHatch.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines the "correlate me" texture for un-banded ground on the geotech axis. The docstring explains the case: a column can carry a classified packing band while the area beside it has no packing region at that elevation, because no accepted tie reaches across; the litho frame then paints that area in plain lithology colour, so the same clay meets itself in two tones at the card edge, which is a lie about lithology.

**Why it is here.** The docstring cites the owner ruling verbatim (2026-08-14): "sure read as correlate me on the extra ruling is fine" — keep both truths (the derived class stays, the lithology stays) and stop the un-banded area impersonating a class by giving it a texture that reads as unfinished work and fades as he correlates. Two rejected options are named so they are not re-proposed: letting the classified card fall back too (which hides real derived data), and letting the bare area take the card's class (which invents a correlation nobody drew). The texture is a back-slash hatch — the deliberate mirror of the forward-slash "not committed yet" ghosts and the DOV clay pattern — at wider spacing, in slate rather than black, and fainter, so it is unmistakable at a glance yet stays quiet over large areas. The module is pure: the caller owns projection and paint, this owns the rule and the constants.

.. CG-EXPLANATION-END id=module-header

``const UNBANDED_HATCH_PATTERN_ID``
-----------------------------------

.. CG-BLOCK id=const:UNBANDED_HATCH_PATTERN_ID lines=40-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 40-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNBANDED_HATCH_PATTERN_ID

**What this does.** The single SVG pattern id for the texture, followed by the hover-label docstring.

**Why it is here.** The docstring records that there is deliberately one id for the whole app — unlike the litho ghosts, which use one per investigation — because every instance of this pattern is byte-identical, so two overlays colliding on the id simply resolve to the same paint.

.. CG-EXPLANATION-END id=const:UNBANDED_HATCH_PATTERN_ID

``const UNBANDED_HATCH_LABEL``
------------------------------

.. CG-BLOCK id=const:UNBANDED_HATCH_LABEL lines=50-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 50-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNBANDED_HATCH_LABEL

**What this does.** The text the engineer reads on hover — "No packing bands here yet — not correlated yet" — followed by the spacing docstring.

**Why it is here.** The docstring records that it says what is true and never says "fallback": that word is an internal identifier, never UI text, because to an engineer it would read as a failure rather than as work he has not done yet.

.. CG-EXPLANATION-END id=const:UNBANDED_HATCH_LABEL

``const UNBANDED_HATCH_SPACING_PX``
-----------------------------------

.. CG-BLOCK id=const:UNBANDED_HATCH_SPACING_PX lines=59-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 59-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNBANDED_HATCH_SPACING_PX

**What this does.** The hatch line spacing, 12 px, followed by the stroke-width docstring.

**Why it is here.** The docstring records that it is wider than the "not committed yet" ghosts (3 and 6 px) and the DOV clay pattern (6 px), so the textures never read alike even side by side and so the texture stays a whisper over a whole un-correlated section.

.. CG-EXPLANATION-END id=const:UNBANDED_HATCH_SPACING_PX

``const UNBANDED_HATCH_STROKE_WIDTH``
-------------------------------------

.. CG-BLOCK id=const:UNBANDED_HATCH_STROKE_WIDTH lines=62-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 62-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNBANDED_HATCH_STROKE_WIDTH

**What this does.** The hatch stroke width, 0.9 px, followed by the stroke-opacity docstring.

**Why it is here.** The comment records that it is thinner than the ghosts' 1.4 px.

.. CG-EXPLANATION-END id=const:UNBANDED_HATCH_STROKE_WIDTH

``const UNBANDED_HATCH_STROKE_OPACITY``
---------------------------------------

.. CG-BLOCK id=const:UNBANDED_HATCH_STROKE_OPACITY lines=65-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 65-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNBANDED_HATCH_STROKE_OPACITY

**What this does.** The hatch stroke opacity, 0.22, followed by the ink docstring.

**Why it is here.** The comment records that it sits below the ghosts' 0.28-0.38 — quiet, not shouting.

.. CG-EXPLANATION-END id=const:UNBANDED_HATCH_STROKE_OPACITY

``const UNBANDED_HATCH_INK``
----------------------------

.. CG-BLOCK id=const:UNBANDED_HATCH_INK lines=68-76

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 68-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNBANDED_HATCH_INK

**What this does.** The hatch ink colour, slate-600 (#475569), followed by the rotation docstring.

**Why it is here.** The comment records that the slate is chosen so the texture never reads as the ghosts' black.

.. CG-EXPLANATION-END id=const:UNBANDED_HATCH_INK

``const UNBANDED_HATCH_ROTATION_DEG``
-------------------------------------

.. CG-BLOCK id=const:UNBANDED_HATCH_ROTATION_DEG lines=77-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 77-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNBANDED_HATCH_ROTATION_DEG

**What this does.** The pattern rotation, minus 45 degrees, followed by the candidate-fill docstring.

**Why it is here.** The comment records that a negative angle is a back-slash — the mirror of every 45-degree forward-slash hatch already on the section canvas — and that direction is the primary channel that separates this texture from "not committed yet".

.. CG-EXPLANATION-END id=const:UNBANDED_HATCH_ROTATION_DEG

``interface HatchCandidateFill``
--------------------------------

.. CG-BLOCK id=interface:HatchCandidateFill lines=80-93

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 80-93
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HatchCandidateFill

**What this does.** One projected fill the rule judges: the caller's key for the element, its SVG path data, and its kind — ``'unbanded'`` for an area the packing model has no bands for (the litho frame resolves it to lithology) or ``'packed'`` for a fill carrying a derived packing class. It is followed by the inputs docstring.

**Why it is here.** Names exactly what the rule needs about each fill: its shape, so the texture can be drawn over the same path, and whether it is un-banded.

.. CG-EXPLANATION-END id=interface:HatchCandidateFill

``interface UnbandedHatchInputs``
---------------------------------

.. CG-BLOCK id=interface:UnbandedHatchInputs lines=94-108

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 94-108
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnbandedHatchInputs

**What this does.** The inputs to the rule: the section axis, whether the geotech partition is framed by the litho model, and every fill the overlay is about to paint with its kind.

**Why it is here.** The comment records why the framed flag matters: it is false in the "Show litho fill" view, where the litho model IS the fill by request — a deliberate lithology view that must stay untextured — as opposed to genuinely un-banded ground.

.. CG-EXPLANATION-END id=interface:UnbandedHatchInputs

``interface UnbandedHatchFill``
-------------------------------

.. CG-BLOCK id=interface:UnbandedHatchFill lines=109-133

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 109-133
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnbandedHatchFill

**What this does.** The output shape — a key plus the geometry — for a fill to draw the texture over. It is followed by the selector's docstring, which lists the rule in the order it binds.

**Why it is here.** The minimal pair the caller needs to paint the texture over the right shape.

.. CG-EXPLANATION-END id=interface:UnbandedHatchFill

``function selectUnbandedHatchFills``
-------------------------------------

.. CG-BLOCK id=function:selectUnbandedHatchFills lines=134-141

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unbandedGeotechHatch.ts
   :language: typescript
   :lines: 134-141
   :lineno-match:

.. CG-EXPLANATION-START id=function:selectUnbandedHatchFills

**What this does.** The rule. Off the geotech axis it selects nothing. On the geotech axis without the litho frame (the "Show litho fill" view) it also selects nothing. Otherwise it selects exactly the ``'unbanded'`` candidates, in the caller's order.

**Why it is here.** The docstring records that the litho axis is untouched entirely and the "Show litho fill" view is lithology by request, so the texture only ever marks genuinely un-banded ground on the litho-framed geotech partition.

.. CG-EXPLANATION-END id=function:selectUnbandedHatchFills

