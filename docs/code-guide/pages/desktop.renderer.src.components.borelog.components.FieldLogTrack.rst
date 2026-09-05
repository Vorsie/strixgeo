desktop.renderer.src.components.borelog.components.FieldLogTrack
================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/FieldLogTrack.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/FieldLogTrack.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/FieldLogTrack.tsx
   :language: tsx
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the field-log interval type, three colour lookups (for colour, moisture and consistency), a track width constant, and the ``truncate`` and ``usePxPerM`` helpers. The comment says the track shows three side-by-side sub-stripes summarising the driller's per-interval log, each with its own colour mapper because the source vocabulary differs per stripe.

**Why it is here.** Another of the depth tracks introduced on the ``desktop.renderer.src.components.borelog.components.AdmixtureChips`` page. Each stripe needs its own mapper because the raw DOV-Vlaanderen tokens are different vocabularies — colour words, moisture words, consistency words — and each is translated to a fill at the presentation boundary.

.. CG-EXPLANATION-END id=module-header

``function FieldLogTrack``
--------------------------

.. CG-BLOCK id=function:FieldLogTrack lines=18-59

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/FieldLogTrack.tsx
   :language: tsx
   :lines: 18-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:FieldLogTrack

**What this does.** The track component. It splits the intervals into the three kinds — colour, moisture, consistency — and draws each kind as its own vertical stripe placed side by side, handing each stripe its matching colour mapper.

**Why it is here.** Separating the three kinds into three stripes lets an engineer read each field-log dimension independently down the hole, and passing each its own mapper keeps the three vocabularies from being confused with one another.

.. CG-EXPLANATION-END id=function:FieldLogTrack

``function FieldLogStripe``
---------------------------

.. CG-BLOCK id=function:FieldLogStripe lines=60-109

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/FieldLogTrack.tsx
   :language: tsx
   :lines: 60-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:FieldLogStripe

**What this does.** A single column inside the track. It reads the shared pixels-per-metre scale and draws one rectangle per interval, placed at its top depth and sized by its thickness, filled by the passed-in mapper; it prints a short label inside tall-enough intervals and gives every interval a hover tooltip with its depth range and value.

**Why it is here.** Sharing one stripe component across all three kinds means the depth placement and labelling are written once and only the colour mapper differs. ``usePxPerM`` provides the same mTAW-to-pixel scale as every other track, so the stripes line up at true depth.

.. CG-EXPLANATION-END id=function:FieldLogStripe

