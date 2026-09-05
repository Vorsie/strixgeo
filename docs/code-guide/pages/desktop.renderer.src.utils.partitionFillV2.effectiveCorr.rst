desktop.renderer.src.utils.partitionFillV2.effectiveCorr
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the single source of the 2/1/0 tie arithmetic: for one unit, in one gap, on one side, how many of its two contacts are effectively tied -- collapsed to the owner's 2 (band), 1 (onlap), 0 (lens). Both the engine's termination drawing and the conformance test consume it.

**Why it is here.** The docstring explains extracting it here means the engine and the test cannot drift -- the test verifies exactly the outcome the engine emitted against. It records ruling 8l: corr is the LITERAL count of a unit's own tied contacts, so the old matched-pair promote-to-band rule is deleted and the band look is emergent (two facing onlaps meet and the merge welds them). Pure module.

.. CG-EXPLANATION-END id=module-header

``interface CorrColumn``
------------------------

.. CG-BLOCK id=interface:CorrColumn lines=33-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 33-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CorrColumn

**What this does.** A minimal column view -- just the units' soil ids in stack order.

**Why it is here.** The arithmetic needs only the soils in order, so this narrow view keeps it decoupled from the full column type.

.. CG-EXPLANATION-END id=interface:CorrColumn

``type TieRef``
---------------

.. CG-BLOCK id=type:TieRef lines=49-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 49-53
   :lineno-match:

.. CG-EXPLANATION-START id=type:TieRef

**What this does.** A type carrying the EXACT provenance of a tied contact: either a resolved tie (with which of this unit's contacts rides it) or the top-band implicit tie (no drawn edge -- the surface polyline is the tie).

**Why it is here.** The docstring explains a corr-1 onlap must follow ITS OWN tie, not whichever tie sits at that elevation -- the elevation-guessing approach matched the wrong tie (the wrong-tie bug, audit item 6). A shared contact hands both adjacent units the same resolved tie, differing only in which contact rides it.

.. CG-EXPLANATION-END id=type:TieRef

``interface EffectiveCorr``
---------------------------

.. CG-BLOCK id=interface:EffectiveCorr lines=54-76

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 54-76
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EffectiveCorr

**What this does.** A type holding a unit-in-a-gap's effective top-tied and base-tied flags, the collapsed 2/1/0 outcome, and the exact provenance of each tie (or null when untied).

**Why it is here.** It is the full verdict both the engine and the gate read for one unit-side.

.. CG-EXPLANATION-END id=interface:EffectiveCorr

``function tiedFlags``
----------------------

.. CG-BLOCK id=function:tiedFlags lines=77-124

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 77-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:tiedFlags

**What this does.** Computes, per unit index on a column, whether its top and base contacts are directly or derived tied: a TOP tie on unit k sets k's top AND unit k-minus-1's base (the derived base-tie); a BASE tie sets only that unit's base. It also folds in jump-tie bridge anchors.

**Why it is here.** The docstring notes this is the single definition of the direct and derived flags -- the engine's tiler and the conformance test both delegate here, so they cannot drift. The comment explains the bridge folding (ruling 8i(e)): a drawn correlation is a tie regardless of how far it reaches, but only toward the gap and side the bridge spans, so pass-through columns stay untied.

.. CG-EXPLANATION-END id=function:tiedFlags

``function derivedBandTies``
----------------------------

.. CG-BLOCK id=function:derivedBandTies lines=125-163

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 125-163
   :lineno-match:

.. CG-EXPLANATION-START id=function:derivedBandTies

**What this does.** Reports whether a unit's contact is tied INDIRECTLY through a shared contact with a directly-adjacent same-side, same-soil tied band above or below it (ruling 8a's derived tie).

**Why it is here.** The docstring explains the side check is load-bearing: ruling 8a derives only through the shared physical surface (an above-neighbour shares my top via ITS base), and without the side check a band above once leaked a derived tie onto this unit's top through a contact metres away -- the contradiction the owner caught on CS1 (2026-07-16).

.. CG-EXPLANATION-END id=function:derivedBandTies

``function isBandMember``
-------------------------

.. CG-BLOCK id=function:isBandMember lines=164-176

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 164-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:isBandMember

**What this does.** Reports whether a unit belongs to a matched-pair band across the gap (a same-side tie between two same-soil facing units).

**Why it is here.** The docstring notes this was the old 2-means-band signal; under ruling 8l it no longer drives the outcome (it is kept for signature stability) but the function survives as the engine's own band signal used elsewhere.

.. CG-EXPLANATION-END id=function:isBandMember

``function topBandTies``
------------------------

.. CG-BLOCK id=function:topBandTies lines=177-181

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 177-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:topBandTies

**What this does.** Reports whether a unit's top is implicitly tied by the top band -- true only for the first unit (index 0).

**Why it is here.** The docstring is ruling 8d: the top-band polyline spans every gap, so the first unit's top is tied by construction; its base still needs its own real or derived tie for a full band.

.. CG-EXPLANATION-END id=function:topBandTies

``function unitHasDirectTie``
-----------------------------

.. CG-BLOCK id=function:unitHasDirectTie lines=182-211

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 182-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitHasDirectTie

**What this does.** Reports whether any active tie in the gap touches this unit's own contact directly.

**Why it is here.** A simple predicate other logic uses to distinguish a real own-contact tie from a derived one.

.. CG-EXPLANATION-END id=function:unitHasDirectTie

``function tieRefForContact``
-----------------------------

.. CG-BLOCK id=function:tieRefForContact lines=212-264

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 212-264
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieRefForContact

**What this does.** Resolves the exact tie provenance for one of a unit's contacts: first a direct or shared-contact tie on that surface, then (for the base) the derived base-tie from a top tie on the unit below.

**Why it is here.** The docstring explains the priority -- a contact's own direct or shared edge always beats a further-away derivation -- so an onlap follows its literal edge, and a shared physical contact returns the same resolved tie to both adjacent units (ruling 8a expressed structurally).

.. CG-EXPLANATION-END id=function:tieRefForContact

``function effectiveCorrForUnit``
---------------------------------

.. CG-BLOCK id=function:effectiveCorrForUnit lines=265-335

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 265-335
   :lineno-match:

.. CG-EXPLANATION-START id=function:effectiveCorrForUnit

**What this does.** The core arithmetic for one unit-side: it combines the direct flags, the derived-band ties and the top-band implicit tie into effective top-tied and base-tied flags, then collapses to 2 (both contacts carry a REAL tie), 1 (one real tie, or any derived tie touches it), or 0 (no tie), and attaches the exact tie provenance for each tied contact.

**Why it is here.** The docstring carries ruling 8l verbatim (the three-clay column -- top tie, no tie, bottom tie means 1, 0, 1) and explains the crucial distinction it encodes: the band COUNT uses only real own-contact ties (a direct edge or bridge, or the top band), while a ruling-8a derived tie makes an onlap but never a band -- because two derived ties from different-soil neighbours are a mixed-bracket minority, not a band, and counting them as 2 would suppress a minority the design mandates render as a lens.

.. CG-EXPLANATION-END id=function:effectiveCorrForUnit

``function effectiveCorrForSide``
---------------------------------

.. CG-BLOCK id=function:effectiveCorrForSide lines=336-352

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/effectiveCorr.ts
   :language: typescript
   :lines: 336-352
   :lineno-match:

.. CG-EXPLANATION-START id=function:effectiveCorrForSide

**What this does.** A convenience wrapper computing every unit's effective corr for one whole side of one gap, gathering the gap's bands and tie flags itself so the caller supplies only the columns and ties.

**Why it is here.** The docstring notes the engine calls this once per gap-side to drive terminations-first emission, while the gate calls the per-unit version; the flags already fold the bridge anchors so the per-unit call needs no extra bridge argument.

.. CG-EXPLANATION-END id=function:effectiveCorrForSide

