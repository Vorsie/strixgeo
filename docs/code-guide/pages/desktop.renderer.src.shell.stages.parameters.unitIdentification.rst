desktop.renderer.src.shell.stages.parameters.unitIdentification
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that pools identification-test values from borehole samples inside a unit's bands, and imports the borehole and sample types and the label-translation helper. Identification tests are the Dutch "onderkenningsproeven" (OKP) — water content, Atterberg limits, carbonate content, and similar per-sample classification numbers.

**Why it is here.** The header records the design. Where the qc/fs/Rf statistics read the cone inside the unit's CPT bands, this is the sibling for the LAB: every numeric classification value on every sample whose depth-interval midpoint falls inside the unit's borehole bands. Grain-size CURVES are deliberately out of this module (a distribution per sieve is a different chart family, pooled elsewhere), while the scalar fractions DOV ships pool here like any other value. Each point carries elevation in mTAW, not depth, converted exactly as the borelog draws its layers (elevation = collar minus depth), because depth frames differ per hole but elevation is the one axis a pooled scatter can share; a hole with no collar elevation cannot be placed and is skipped and counted. Labels are the presentation-boundary translations with the raw Dutch token carried alongside for the tooltip.

.. CG-EXPLANATION-END id=module-header

``interface UnitBoreholeBandInterval``
--------------------------------------

.. CG-BLOCK id=interface:UnitBoreholeBandInterval lines=30-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 30-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitBoreholeBandInterval

**What this does.** Declares the shape of one borehole-anchored band of the unit: the borehole id it hangs off, and the band's top and base in metres below the collar. An interface names the shape of an object.

**Why it is here.** This is the minimal description of a band the pooling needs — which hole, and the depth window — keyed by borehole id so the sample loop can find the right hole's details.

.. CG-EXPLANATION-END id=interface:UnitBoreholeBandInterval

``interface IdentificationPoint``
---------------------------------

.. CG-BLOCK id=interface:IdentificationPoint lines=40-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 40-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:IdentificationPoint

**What this does.** Declares one plotted value: the numeric test result, the sample midpoint's elevation in mTAW, the sample id (the colour key), the borehole name, and the sample number when the lab recorded one.

**Why it is here.** The sample id is carried as the colour key so a dot and its sample's grain-size curve wear the same colour (owner, 2026-08-28); the borehole name and sample number are carried so the dot's tooltip can name where the value came from.

.. CG-EXPLANATION-END id=interface:IdentificationPoint

``interface IdentificationPanel``
---------------------------------

.. CG-BLOCK id=interface:IdentificationPanel lines=58-74

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 58-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:IdentificationPanel

**What this does.** Declares one per-parameter scatter panel: a stable grouping key, the English display label, the raw upstream token for the tooltip (or nothing for a typed family), the unit string, and every pooled value.

**Why it is here.** Only parameters that actually have data become a panel (the no-empty-jars rule). The raw token is kept beside the translated label so a domain expert can verify the translation from the tooltip, and a typed family carries no single source token so its raw field is empty.

.. CG-EXPLANATION-END id=interface:IdentificationPanel

``interface IdentificationPool``
--------------------------------

.. CG-BLOCK id=interface:IdentificationPool lines=75-103

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 75-103
   :lineno-match:

.. CG-EXPLANATION-START id=interface:IdentificationPool

**What this does.** Declares the pooling result: the panels in display order (typed families first, then scalars by label) plus the count of samples skipped because their borehole had no collar elevation. The documentation below it describes the band-selecting function that follows.

**Why it is here.** The skipped count is carried, not swallowed, so the panel can tell the engineer that some samples could not be placed rather than silently thinning the pool.

.. CG-EXPLANATION-END id=interface:IdentificationPool

``function unitBoreholeBands``
------------------------------

.. CG-BLOCK id=function:unitBoreholeBands lines=104-137

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 104-137
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitBoreholeBands

**What this does.** From a scope's bands, keeps only the ones the OKP pool may read: accepted bands, anchored on a borehole, and (when a member set is given) belonging to the pooling population. It returns each as a borehole-band interval. The documentation below it describes the midpoint rule that follows.

**Why it is here.** The scope selection itself already happened in ``bandsForScope`` — the single authority — so this applies only the population filters that stay per spec: accepted-only (defensive), borehole-anchored-only (the CPT anchor is the sibling function's job), and the member set, so off-section, hidden and removed holes contribute nothing to the pooled statistics.

.. CG-EXPLANATION-END id=function:unitBoreholeBands

``function midpointInBand``
---------------------------

.. CG-BLOCK id=function:midpointInBand lines=138-142

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 138-142
   :lineno-match:

.. CG-EXPLANATION-START id=function:midpointInBand

**What this does.** Answers whether a sample's midpoint depth falls inside a band, treating the band as half-open — the top is included, the base is not.

**Why it is here.** Half-open matching is the same rule the CPT statistics use, for the same reason: bands are gap-free, so a closed interval would claim a sample sitting exactly on a contact for both neighbours. It is exported so the grain-size pooling uses the identical rule and two copies cannot drift.

.. CG-EXPLANATION-END id=function:midpointInBand

``function typedFamilyValues``
------------------------------

.. CG-BLOCK id=function:typedFamilyValues lines=143-176

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 143-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:typedFamilyValues

**What this does.** Pulls the fixed families of lab tests off one sample — water content, the two Atterberg limits, carbonate, organic carbon and organic matter — and returns each present value with its grouping key, English label, unit and number.

**Why it is here.** These families have dedicated typed slots on a sample (rather than arriving as generic scalars), so they are read explicitly here and given stable keys and fixed labels; a value that was not measured is simply not emitted.

.. CG-EXPLANATION-END id=function:typedFamilyValues

``const TYPED_ORDER``
---------------------

.. CG-BLOCK id=const:TYPED_ORDER lines=177-202

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 177-202
   :lineno-match:

.. CG-EXPLANATION-START id=const:TYPED_ORDER

**What this does.** The fixed display order of the typed families — water content, liquid limit, plastic limit, carbonate, organic carbon, organic matter. The documentation below it describes the main pooling function that follows.

**Why it is here.** Pinning the order means the typed panels always appear in a familiar sequence, with any scalar parameters sorted after them by label.

.. CG-EXPLANATION-END id=const:TYPED_ORDER

``function poolIdentificationPanels``
-------------------------------------

.. CG-BLOCK id=function:poolIdentificationPanels lines=203-281

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitIdentification.ts
   :language: typescript
   :lines: 203-281
   :lineno-match:

.. CG-EXPLANATION-START id=function:poolIdentificationPanels

**What this does.** The main pooler. It groups the bands by borehole, then for each hole's samples whose midpoint lands in a band, converts the midpoint to elevation (collar minus depth) and appends every typed-family value and every finite numeric scalar value onto its parameter's panel. A sample with a value but no collar elevation is counted as skipped. Finally it sorts the panels — typed families in their fixed order, scalars after by label — and returns them with the skipped count.

**Why it is here.** Only parameters with at least one value become a panel (no empty jars). A hole whose details have not arrived yet contributes nothing rather than erroring. Non-numeric values (ASTM codes, descriptive classes) are dropped because they have no place on a value axis, and grain-size curves never reach here at all — they live on their own field and pool elsewhere. A skip is counted only when the sample actually carried a value that would have been plotted, so a value-less sample costs nothing.

.. CG-EXPLANATION-END id=function:poolIdentificationPanels

