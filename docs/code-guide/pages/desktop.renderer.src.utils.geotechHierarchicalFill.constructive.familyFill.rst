desktop.renderer.src.utils.geotechHierarchicalFill.constructive.familyFill
==========================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module that fills ONE litho family — a chain of litho units of the same soil. Its three jobs in order: split the family's banded tests into runs (maximal stretches with no un-divided test of its own soil between them), resolve each run's lines (the packing ties, the litho cover lines, and the crossings that suspend a pair), and per gap work out which two tests the ground runs between and hand it to the per-gap fill. It imports the constructive helpers it orchestrates.

**Why it is here.** The docstring names the three jobs and cites owner ruling 2026-08-15: an un-divided test of the family's soil blocks a run, while a test that never had this soil is simply spanned. The section-level assembly decides what each family is; this module fills one.

.. CG-EXPLANATION-END id=module-header

``interface FamilyFillContext``
-------------------------------

.. CG-BLOCK id=interface:FamilyFillContext lines=36-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts
   :language: typescript
   :lines: 36-71
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FamilyFillContext

**What this does.** Everything one family's fill needs from the section around it: the along-section metres, the litho model's approved edges, the packing edges that may bound a contact, band-by-layer-id lookups for both models, the section-wide stacks, the mass-of-a-band function, the litho paint per gap, and the adopted-bands function.

**Why it is here.** The field comments record two subtleties. The far-end read needs the neighbouring family's bands too, because a tie lands on a shared contact. And adoption exists because the litho fill merges a same-soil sandwich into one host region, so a unit can lose its cover to a neighbour; its bands are then lent to whoever holds the ground, same soil only, or the test that measured them would show another unit's classes at its own edge (the owner's arrow, 2026-08-20).

.. CG-EXPLANATION-END id=interface:FamilyFillContext

``interface FamilyPlanResult``
------------------------------

.. CG-BLOCK id=interface:FamilyPlanResult lines=72-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts
   :language: typescript
   :lines: 72-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FamilyPlanResult

**What this does.** What the planning pass produced: this family's gap plans minus the closure bars, the crossing conflicts found, the count of gaps with no run over them, the cover this family could never plan for, and that fallback cover's area.

**Why it is here.** It separates the planning output from the fill output, which is what lets the closure bars be computed once across every family before any family fills.

.. CG-EXPLANATION-END id=interface:FamilyPlanResult

``interface FillPlansResult``
-----------------------------

.. CG-BLOCK id=interface:FillPlansResult lines=85-119

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts
   :language: typescript
   :lines: 85-119
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FillPlansResult

**What this does.** What the fill pass produced: the emitted regions, the pre-merge loops each tagged with its role, the 'correlate me' hatch, the area the dominant-mass step classified, the count of loops that needed the vertical line to decide, the area left unclassed, and the totality violations.

**Why it is here.** The field comments note two things: the totality-violations list being empty is the contract since the least-dense ruling of 2026-08-26, and the pre-merge loops are the audit's surface.

.. CG-EXPLANATION-END id=interface:FillPlansResult

``function planFamily``
-----------------------

.. CG-BLOCK id=function:planFamily lines=120-359

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts
   :language: typescript
   :lines: 120-359
   :lineno-match:

.. CG-EXPLANATION-START id=function:planFamily

**What this does.** Plans one family's gaps through the law's lines but stops short of the actual fill. It gathers each column's adoptable bands and resolves each run's ties against the augmented columns and against the litho cover lines, recording every crossing on the frame gap holding its midpoint. It computes the band continuations (carries across blind columns) and where their shape must taper, then for every gap it falls back to hatch where a flank is un-divided (owner 2026-08-15), finds the run whose two banded tests bracket the ground, augments those flanks with adopted, continuation and carried bands, and pushes a plan.

**Why it is here.** Owner code-hunt finding F7 (2026-08-22): planning is split from filling so the closure bars can be computed once, over every family's plans together, before any family fills. Adoption is made visible to tie resolution at the run level (owner 2026-08-21, the S8|S6 deep very dense sand) so an adopted band's tie line is drawn in every gap it needs, not only where a flank happens to carry the band. The blind-column splice ports the litho arm's continuation law, which the geotech arm's gap-by-gap architecture realises with just the one new idea.

.. CG-EXPLANATION-END id=function:planFamily

``function closureBarsFor``
---------------------------

.. CG-BLOCK id=function:closureBarsFor lines=360-397

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts
   :language: typescript
   :lines: 360-397
   :lineno-match:

.. CG-EXPLANATION-START id=function:closureBarsFor

**What this does.** Computes, over every family's plans together, where each band's closed loops pinch — a map from a band's layer id to the along-x apex of every gap it closed a loop in, lens or onlap alike.

**Why it is here.** Owner code-hunt finding F7 plus 2026-08-21 night ('the dense sand onlaps so the MD should fill') and finding B1b (2026-08-22, a lens closes as absolutely as an onlap). A band never answers remainder ground on the far side of one of its own bars, in any gap, in any family — so the bars must be computed over the union of every family's plans, because a band adopted across a family boundary has to carry its true closure wherever it is consulted rather than a re-derivation scoped to whichever family is asking.

.. CG-EXPLANATION-END id=function:closureBarsFor

``function fillPlans``
----------------------

.. CG-BLOCK id=function:fillPlans lines=398-425

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/familyFill.ts
   :language: typescript
   :lines: 398-425
   :lineno-match:

.. CG-EXPLANATION-START id=function:fillPlans

**What this does.** Fills every plan, with each gap seeing the same run-wide closures, accumulating the regions, the pre-merge loops, the hatch fallback, the areas and the totality violations. It threads the engineer's 'Separate' rulings into every gap's merge.

**Why it is here.** It is family-agnostic because a plan already carries everything its own fill needs, so it can run flat over the plans of every family together. The separated pairs come from owner 2026-08-31 (debt #278 R5); absent, they leave the fill byte-identical.

.. CG-EXPLANATION-END id=function:fillPlans

