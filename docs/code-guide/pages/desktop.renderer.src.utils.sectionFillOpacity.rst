desktop.renderer.src.utils.sectionFillOpacity
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionFillOpacity.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionFillOpacity.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The single source of the section view's fill transparency. The docstring explains the problem: the partition fill paints the gaps between investigation columns, while each column's own band stack paints the card, and for the section to read as one continuous geology both halves must be handled — the stack must paint at the fill's own opacity, and the card behind it must drop to at most a very light veil. It then works through the arithmetic showing the gap tone and the card tone are equal only when that veil is exactly zero, and states plainly what is lost at zero.

**Why it is here.** The docstring cites the owner rulings: dogfeed 2026-08-14 ("same transparency everywhere"), and that the veil must be zero because any non-zero veil leaves a visible step at the card edge — the owner still read one even at 0.18 (dogfeed 2026-08-15). The stated price is that at veil zero a borehole's DOV log pattern and a CPT's white track backing are invisible while a fill is on; hiding the fill brings both straight back. The geological axis is deliberately excluded because nothing paints over its columns and its faint backdrop bands sit under contact lines that need the contrast. The pure tone functions at the bottom make the equality checkable, so a future veil tweak breaks a test instead of silently reintroducing the step.

.. CG-EXPLANATION-END id=module-header

``type SectionAxisMode``
------------------------

.. CG-BLOCK id=type:SectionAxisMode lines=44-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 44-50
   :lineno-match:

.. CG-EXPLANATION-START id=type:SectionAxisMode

**What this does.** The three axes a section can be edited on — geological, lithostratigraphic, geotechnical — followed by the docstring for the fill opacity below.

**Why it is here.** A union naming the exact set of axes the opacity rules branch on.

.. CG-EXPLANATION-END id=type:SectionAxisMode

``const SECTION_FILL_OPACITY``
------------------------------

.. CG-BLOCK id=const:SECTION_FILL_OPACITY lines=51-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 51-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTION_FILL_OPACITY

**What this does.** The partition fill's opacity, 0.62 — and also the opacity a column's own stack must use so the two meet seamlessly — followed by the lens-opacity docstring.

**Why it is here.** The docstring records that the gap fill and the column stack deliberately share one opacity so they meet without a visible seam.

.. CG-EXPLANATION-END id=const:SECTION_FILL_OPACITY

``const SECTION_LENS_FILL_OPACITY``
-----------------------------------

.. CG-BLOCK id=const:SECTION_LENS_FILL_OPACITY lines=57-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 57-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTION_LENS_FILL_OPACITY

**What this does.** The opacity a lens is drawn at, 0.85 — a touch more solid than the ordinary fill — followed by the geological-backdrop docstring.

**Why it is here.** The docstring records the reason: a lens (a one-test body enclosed in a matrix — the 0-tie case of the 2/1/0 contact-correlation model) is drawn more solid so it reads as a unit cut out of the continuous matrix, not as a faint wash.

.. CG-EXPLANATION-END id=const:SECTION_LENS_FILL_OPACITY

``const GEOLOGICAL_BACKDROP_OPACITY``
-------------------------------------

.. CG-BLOCK id=const:GEOLOGICAL_BACKDROP_OPACITY lines=65-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 65-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOLOGICAL_BACKDROP_OPACITY

**What this does.** The backdrop-band opacity on the geological axis, 0.18, followed by the docstring for the card veil below.

**Why it is here.** The docstring records that it is lower than the fill because those bands are a backdrop for contact lines and labels, not the subject of the view.

.. CG-EXPLANATION-END id=const:GEOLOGICAL_BACKDROP_OPACITY

``const STACK_CARD_VEIL_OPACITY``
---------------------------------

.. CG-BLOCK id=const:STACK_CARD_VEIL_OPACITY lines=76-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 76-78
   :lineno-match:

.. CG-EXPLANATION-START id=const:STACK_CARD_VEIL_OPACITY

**What this does.** The veil left behind a column card on the axes where the stack paints over it — zero.

**Why it is here.** The docstring records that it has to be zero: any card underlay at all composites the fill to a different tone than the same fill over the plot background, which is the step at the card edge the owner keeps seeing.

.. CG-EXPLANATION-END id=const:STACK_CARD_VEIL_OPACITY

``const CPT_TRACK_VEIL_OPACITY``
--------------------------------

.. CG-BLOCK id=const:CPT_TRACK_VEIL_OPACITY lines=79-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 79-84
   :lineno-match:

.. CG-EXPLANATION-START id=const:CPT_TRACK_VEIL_OPACITY

**What this does.** The opacity of the CPT track's white background on the geological axis, 0.7, followed by the interpretation-stack docstring.

**Why it is here.** This is the readable track backing used on the axes and in the states where no fill paints over the card.

.. CG-EXPLANATION-END id=const:CPT_TRACK_VEIL_OPACITY

``const INTERPRETATION_STACK_OPACITY``
--------------------------------------

.. CG-BLOCK id=const:INTERPRETATION_STACK_OPACITY lines=85-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 85-94
   :lineno-match:

.. CG-EXPLANATION-START id=const:INTERPRETATION_STACK_OPACITY

**What this does.** The original stack-band opacity on the interpretation axes, 0.55, restored whenever no fill paints over the columns.

**Why it is here.** The docstring records that this is the pre-2026-08-14 look: the veil serves the fill, so with the fill hidden the cards must look exactly as they always did — "the opacity of the columns is changed" was a dollar-grade defect (owner, 2026-08-14 late).

.. CG-EXPLANATION-END id=const:INTERPRETATION_STACK_OPACITY

``function stackPaintsOverColumns``
-----------------------------------

.. CG-BLOCK id=function:stackPaintsOverColumns lines=95-110

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 95-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:stackPaintsOverColumns

**What this does.** Returns true when a column's card is being painted over by the partition's own column strips — that is, when the axis is an interpretation axis (lithostratigraphic or geotechnical) AND a fill is actually shown.

**Why it is here.** The docstring records the guard's purpose: the veil serves the fill, so when the owner hides the fill, or a clean slate has none, the cards must look exactly as they always did.

.. CG-EXPLANATION-END id=function:stackPaintsOverColumns

``function columnStackFillOpacity``
-----------------------------------

.. CG-BLOCK id=function:columnStackFillOpacity lines=111-123

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 111-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnStackFillOpacity

**What this does.** The opacity for a column's own band stack: the geological backdrop opacity on the geological axis; zero while a fill paints on an interpretation axis; otherwise the original interpretation stack opacity.

**Why it is here.** The docstring records why it is zero while the fill paints: the partition's own column-strip quads carry the stack there, dissolved into the gap fill so the tone cannot step at a card edge, and a second coat would composite the card darker than the gap.

.. CG-EXPLANATION-END id=function:columnStackFillOpacity

``function columnCardVeilOpacity``
----------------------------------

.. CG-BLOCK id=function:columnCardVeilOpacity lines=124-142

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 124-142
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnCardVeilOpacity

**What this does.** The opacity for the white background behind a CPT column's data tracks: the very light veil (zero) only while a fill paints over the card, and the full readable track background the moment it does not.

**Why it is here.** The docstring records that the readable backing returns as soon as no fill covers it.

.. CG-EXPLANATION-END id=function:columnCardVeilOpacity

``function boreholeLogFillOpacity``
-----------------------------------

.. CG-BLOCK id=function:boreholeLogFillOpacity lines=143-147

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 143-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:boreholeLogFillOpacity

**What this does.** The opacity for a borehole column's own DOV log strips: the shared veil while a fill paints, fully opaque otherwise.

**Why it is here.** The docstring records the reasoning: while a fill paints, the driller's log is only reference (the full-detail read lives in the borelog panel) and dims to the same veil the CPT card uses, so a borehole card does not read brighter than a CPT card carrying the very same interpretation band.

.. CG-EXPLANATION-END id=function:boreholeLogFillOpacity

``type Rgb``
------------

.. CG-BLOCK id=type:Rgb lines=148-161

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 148-161
   :lineno-match:

.. CG-EXPLANATION-START id=type:Rgb

**What this does.** An sRGB colour as its three 0–255 channels, in the order the browser paints them, followed by the docstring for the compositing function.

**Why it is here.** Names the colour shape the tone maths below operates on.

.. CG-EXPLANATION-END id=type:Rgb

``function compositeOver``
--------------------------

.. CG-BLOCK id=function:compositeOver lines=162-178

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 162-178
   :lineno-match:

.. CG-EXPLANATION-START id=function:compositeOver

**What this does.** Alpha-composites one colour over another the way the browser does — a straight per-channel linear blend from the bottom colour toward the top colour by the top's opacity.

**Why it is here.** The docstring records the simplification: because the backdrop is fully opaque (the plot rectangle, or a layer already composited onto it), the usual alpha bookkeeping collapses to this simple linear blend.

.. CG-EXPLANATION-END id=function:compositeOver

``function gapFillTone``
------------------------

.. CG-BLOCK id=function:gapFillTone lines=179-198

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 179-198
   :lineno-match:

.. CG-EXPLANATION-START id=function:gapFillTone

**What this does.** The tone a fill region actually reads as in the gap between two columns — one coat: the partition region painted over the bare plot rectangle at the fill opacity. It is followed by the docstring for the column tone below.

**Why it is here.** This is the reference tone that the tone over a column card must match for the fill to look continuous.

.. CG-EXPLANATION-END id=function:gapFillTone

``function columnFillTone``
---------------------------

.. CG-BLOCK id=function:columnFillTone lines=199-212

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillOpacity.ts
   :language: typescript
   :lines: 199-212
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnFillTone

**What this does.** The tone the same fill reads as where it crosses an investigation column — two coats: the card's own backing veiled onto the plot rectangle first, then the partition's column strip painted over that at the fill opacity.

**Why it is here.** The docstring records that this equals ``gapFillTone`` only while the veil leaves the background untouched (veil zero), which is the whole point of the pairing and exactly what the opacity test pins — so a future veil tweak breaks that test instead of silently bringing back the card-edge step.

.. CG-EXPLANATION-END id=function:columnFillTone

