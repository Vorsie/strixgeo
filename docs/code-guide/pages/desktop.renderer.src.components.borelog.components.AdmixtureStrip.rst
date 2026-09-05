desktop.renderer.src.components.borelog.components.AdmixtureStrip
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/AdmixtureStrip.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/AdmixtureStrip.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/AdmixtureStrip.tsx
   :language: tsx
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's two imports: the ``soilStyle`` colour lookup and ``pctForAmount``, a helper that turns an amount word into a percentage weight.

**Why it is here.** The same shared borehole-log picture introduced on the ``desktop.renderer.src.components.borelog.components.AdmixtureChips`` page: this file draws part of a lithology layer with SVG, and ``soilStyle`` maps each raw soil token to its colour at the presentation boundary.

.. CG-EXPLANATION-END id=module-header

``const ADMIX_AREA_CAP_PCT``
----------------------------

.. CG-BLOCK id=const:ADMIX_AREA_CAP_PCT lines=11-12

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/AdmixtureStrip.tsx
   :language: tsx
   :lines: 11-12
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIX_AREA_CAP_PCT

**What this does.** A constant, 45, with a comment: at most 45 percent of a layer's width may be given to admixture strips, so the main soil fill always keeps at least 55 percent.

**Why it is here.** The cap guarantees the main lithology stays the visually dominant part of every layer, no matter how many admixtures it carries; the exact arithmetic is in ``mainLithologyFraction`` below.

.. CG-EXPLANATION-END id=const:ADMIX_AREA_CAP_PCT

``interface Admixture``
-----------------------

.. CG-BLOCK id=interface:Admixture lines=13-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/AdmixtureStrip.tsx
   :language: tsx
   :lines: 13-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Admixture

**What this does.** Describes one admixture — its ``soil_code``, an ``amount`` word and a ``locally`` flag — followed by the documentation comment for the strip component. The comment explains that each admixture is drawn as a full-height vertical strip on the right side of the layer, with a width proportional to its DOV amount word ("veel", much, counts three times "weinig", little), arranged left to right in source order, and it gives worked examples of how the on-page area comes out.

**Why it is here.** The strips follow DOV's own convention of listing the primary admixture first, so the on-screen order matches the source data. The worked examples in the comment record the intended reading: a layer's composition — main soil plus its admixtures in proportion — should be legible at a glance from the widths alone.

.. CG-EXPLANATION-END id=interface:Admixture

``function AdmixtureStrip``
---------------------------

.. CG-BLOCK id=function:AdmixtureStrip lines=36-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/AdmixtureStrip.tsx
   :language: tsx
   :lines: 36-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:AdmixtureStrip

**What this does.** The component. It turns each admixture's amount word into a percentage weight, sums them, then draws one full-height strip per admixture whose width is that admixture's share of the total, laid left to right. Each strip is filled with its soil colour and carries a hover title naming the amount, code and locality; a thin line closes the left edge of the strip group.

**Why it is here.** The widths are shares of the total weight, so the strips always fill the space allotted to them regardless of how many there are. The comment notes the half-pixel overlap added to inner strips: without it the drawing engine's edge-smoothing can leave a one-pixel gap between neighbouring fills. The hover title carries the full raw tokens so the exact composition is always inspectable, matching the translate-at-the-boundary rule.

.. CG-EXPLANATION-END id=function:AdmixtureStrip

``function mainLithologyFraction``
----------------------------------

.. CG-BLOCK id=function:mainLithologyFraction lines=115-124

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/AdmixtureStrip.tsx
   :language: tsx
   :lines: 115-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:mainLithologyFraction

**What this does.** A pure function that returns the fraction of a layer's width to give the main soil fill. It assigns each admixture a fixed percentage from its amount word (little 5 percent, moderate 10, much 15), sums them, caps the sum at 45 percent, and returns one minus that.

**Why it is here.** This is the arithmetic behind the cap constant above: the main fill is whatever is left after the admixture strips, and because the total is capped at 45 percent the main fill never drops below 55 percent. The docstring lists the resulting main-fill fractions for common compositions, so the behaviour is pinned by example.

.. CG-EXPLANATION-END id=function:mainLithologyFraction

