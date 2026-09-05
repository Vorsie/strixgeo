desktop.renderer.src.utils.geotechHierarchicalFill.index
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
   :language: typescript
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the top file of the hierarchical geotech fill — it ties every other module in this folder together. It groups the section's litho units into families, pairs each packing band with the litho unit it subdivides, applies the 2/1/0 law inside each family to draw the LINES (bands, onlaps, lenses, vertical seams), fills and merges the loops those lines close, welds same-class masses across families, and cuts everything to each family's own litho cover. It imports every stage of that pipeline.

**Why it is here.** Owner, 2026-08-19, on the binding structure: "we said first draw all lines, lenses, onlaps, vertical lines, this makes closed loops, then we fill everything and merge it" and "the lines are the structural framework, the fill is to fill all gaps, the merge is to reduce the dimensions". Building the framework whole before any loop is labelled is what makes the guarantees structural: a packing class can never paint outside the litho soil it subdivides, a vacancy in a sand region can never read clay, and nothing depends on the order anything was emitted in.

.. CG-EXPLANATION-END id=module-header

``const COVER_EPS``
-------------------

.. CG-BLOCK id=const:COVER_EPS lines=53-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
   :language: typescript
   :lines: 53-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:COVER_EPS

**What this does.** A constant: the elevation tolerance, one micrometre, at which a band's contact IS its parent litho unit's own contact.

**Why it is here.** It decides whether an untied contact is a level the band chose or the point where the soil itself ends, which the litho model already governs.

.. CG-EXPLANATION-END id=const:COVER_EPS

``interface HierarchicalGeotechFillInput``
------------------------------------------

.. CG-BLOCK id=interface:HierarchicalGeotechFillInput lines=56-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
   :language: typescript
   :lines: 56-95
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HierarchicalGeotechFillInput

**What this does.** The data shape for everything one section's fill needs: the litho frame's columns, edges and regions; the packing bands and their edges aligned to the same columns; the along-section metres; the formation-to-class map; and the engineer's Separate rulings as cannot-link pairs.

**Why it is here.** The docstring explains the two subtle fields. The class map exists because the law compares the CLASS while the model stores one row per class and parent, so comparing rows would read two NAD-6 sands as different masses across a geological boundary ("one mass one body"). The separated pairs are threaded into both welds so two same-class masses the engineer split never re-weld, and passing none leaves the fill byte-identical.

.. CG-EXPLANATION-END id=interface:HierarchicalGeotechFillInput

``interface HierarchicalGeotechFillDiagnostics``
------------------------------------------------

.. CG-BLOCK id=interface:HierarchicalGeotechFillDiagnostics lines=96-165

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
   :language: typescript
   :lines: 96-165
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HierarchicalGeotechFillDiagnostics

**What this does.** The data shape reporting what the construction had to work around: counts of families, bands, straddling and unparented bands, cross-family and unresolved ties, unattributed regions, one-sided gaps, blocked columns, areas filled and left unclassified, cross-family welds, split remainders, and the two tripwire lists.

**Why it is here.** It is the honest accounting of what the fill knows and does not — for the gates and the console. The docstring flags that the totality and edge-reach lists are DEFECTS, not accounting lines: since the least-dense ruling of 2026-08-26 the fill owns every square metre of a banded gap, and the build must be able to read every emitting gap at its edges.

.. CG-EXPLANATION-END id=interface:HierarchicalGeotechFillDiagnostics

``interface HierarchicalGeotechFillResult``
-------------------------------------------

.. CG-BLOCK id=interface:HierarchicalGeotechFillResult lines=166-213

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
   :language: typescript
   :lines: 166-213
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HierarchicalGeotechFillResult

**What this does.** The result shape: the classed loops before the merge weld (each with its role), the merged classed faces the render draws, the crossing-tie conflicts, the litho cover no class reached, and the diagnostics.

**Why it is here.** The pre-merge surface is kept because audits that judge a band against its own 2/1/0 envelope must read it before the merge fuses shapes (owner: "why don't you count balloons before the fill merge step?"), while the render reads the merged regions. The unreached cover carries the LITHO formation id so it renders litho-coloured under the "correlate me" texture, never through the NAD colour map.

.. CG-EXPLANATION-END id=interface:HierarchicalGeotechFillResult

``function runsBetweenBlockers``
--------------------------------

.. CG-BLOCK id=function:runsBetweenBlockers lines=214-244

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
   :language: typescript
   :lines: 214-244
   :lineno-match:

.. CG-EXPLANATION-START id=function:runsBetweenBlockers

**What this does.** Given a family's banded columns and the columns that block, it returns the maximal runs of banded columns with no blocker between them, dropping any run shorter than two columns.

**Why it is here.** It encodes the owner ruling of 2026-08-15 that two bandless columns mean opposite things: a column carrying the family's litho unit but no band BLOCKS (nobody classified that ground, so the constructs stop and its cover reads "correlate me"), while a column carrying no unit of the family at all is EXCLUDED and the run spans it — the same span the litho stage draws over a test that lacks the unit.

.. CG-EXPLANATION-END id=function:runsBetweenBlockers

``function computeHierarchicalGeotechFill``
-------------------------------------------

.. CG-BLOCK id=function:computeHierarchicalGeotechFill lines=245-554

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
   :language: typescript
   :lines: 245-554
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeHierarchicalGeotechFill

**What this does.** The one public function that runs the whole fill for a section. It resolves band parents, builds families, indexes every band and litho unit, works out each band's mass and each family's columns and blockers, plans every family's constructs, computes the closure bars across all families, fills and merges the loops, welds same-class masses across families, and returns the classed faces, the unreached cover and the diagnostics.

**Why it is here.** The docstring records why the steps are ordered as they are. It plans every family BEFORE filling any, because the closure bars have to see every family's constructs first or a band adopted across a family boundary could be handed ground past a pinch it already made in its own family (owner code-hunt finding F7, 2026-08-22). A tie on a band's own contact counts for that band even when the far end sits in another family's litho unit ("two ties is two tied contacts", 2026-08-21), and a family with no cover of its own in a gap lends its bands to the family whose cover encloses them, so ground never reads the wrong test's classes at its own edge (the owner's arrow at GEO-23/125-S6). Mass is compared by soil and class and nothing else, honouring one-mass-one-body.

.. CG-EXPLANATION-END id=function:computeHierarchicalGeotechFill

