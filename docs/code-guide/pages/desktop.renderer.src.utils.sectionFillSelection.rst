desktop.renderer.src.utils.sectionFillSelection
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionFillSelection.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionFillSelection.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillSelection.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file decides which single fill the section view should paint, if any. The docstring records the history that shaped the rule.

**Why it is here.** The docstring cites two owner directives. Dogfeed 2026-08-06: on the geotech axis only one fill may render at a time and the litho fill is opt-in there — before this, the geotech axis defaulted to showing bands and, with no packing model, fell through to painting the litho partition, so a cleared model still looked filled ("thought u cleared the model, why is there fill?"). Ruling 2026-08-13: the geotech axis's default fill is now the direct geotech partition, so the "Show litho fill" toggle swaps the partition's source model rather than withholding a refinement pass. The module is kept pure so this exclusivity can be unit-tested without mounting the large SectionPanel component.

.. CG-EXPLANATION-END id=module-header

``type SectionFillAxis``
------------------------

.. CG-BLOCK id=type:SectionFillAxis lines=21-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillSelection.ts
   :language: typescript
   :lines: 21-23
   :lineno-match:

.. CG-EXPLANATION-START id=type:SectionFillAxis

**What this does.** Names the three section axes whose fill this rule can choose between: geological, lithostratigraphic and geotechnical.

**Why it is here.** This is a *union* — it lists the exact set of allowed axis values, so the code cannot be handed an axis name that does not exist.

.. CG-EXPLANATION-END id=type:SectionFillAxis

``interface SectionFillInputs``
-------------------------------

.. CG-BLOCK id=interface:SectionFillInputs lines=24-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillSelection.ts
   :language: typescript
   :lines: 24-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionFillInputs

**What this does.** The inputs to the rule: the current axis, the three fill toggles (the litho "Fill bands" toggle, the geotech "Hide fill" toggle, and the geotech "Show litho fill" toggle), and two counts — how many geotech units (packing bands) this section actually carries, and how many accepted packing ties it carries.

**Why it is here.** The comments record why the counts are numbers, not simple yes/no flags: the canvas assembles the geotech axis whenever that axis is active, even with zero bands, so zero units means a clean slate and no fill (dogfeed 2026-08-06); and with zero accepted ties every band pinches mid-gap, which is "useless clutter before the ties are there" (owner, dogfeed 2026-08-14 night), so the first pipeline step alone must not turn the fill on.

.. CG-EXPLANATION-END id=interface:SectionFillInputs

``interface SectionFillSelection``
----------------------------------

.. CG-BLOCK id=interface:SectionFillSelection lines=49-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillSelection.ts
   :language: typescript
   :lines: 49-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionFillSelection

**What this does.** The output shape: ``showBands`` (whether any fill paints at all) and ``showLithoFillInstead`` (on the geotech axis, whether the partition is framed by the litho model instead of the geotech one). It is followed by the docstring listing the rules in the order they are applied.

**Why it is here.** The comment records the one-fill-at-a-time rule: when ``showLithoFillInstead`` is true the litho fill is the only fill, because the partition itself swaps to the litho model and so the packing fill cannot stack under or over it.

.. CG-EXPLANATION-END id=interface:SectionFillSelection

``function selectSectionFill``
------------------------------

.. CG-BLOCK id=function:selectSectionFill lines=85-104

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFillSelection.ts
   :language: typescript
   :lines: 85-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:selectSectionFill

**What this does.** The rule. On any non-geotech axis, ``showBands`` simply follows the litho "Fill bands" toggle. On the geotech axis with "Show litho fill" on, it always paints, with the litho model framing the partition. On the geotech axis otherwise, it paints only when there is at least one packing unit AND at least one accepted tie AND the geotech "Hide fill" toggle allows it.

**Why it is here.** The docstring records the reasoning for the guards: a geotech model with no units — no model at all, or one not yet subdivided — shows no fill so a clean slate looks clean, and a model with units but no ties would pinch everything mid-gap, which is clutter rather than information.

.. CG-EXPLANATION-END id=function:selectSectionFill

