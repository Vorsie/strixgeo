desktop.renderer.src.shell.stages.geotechnical.geotechUnitTree
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the pure calculation module behind the Geotech-units pane tree: soil header, then litho body, then packing body. The long docstring records the owner's wording of the three-level shape, explains that a packing body homes under the litho body it was carved out of (and, if that parent is not yet stamped, falls into an "ungrouped" bucket rather than disappearing), and notes that all the arithmetic — grouping, band-count roll-up, per-body badges, ordering, the group tag — lives here rather than in the screen code. It pulls in the confidence type, the label helpers, the soil and NAD-colour helpers, and the litho-body label helper.

**Why it is here.** The owner replaced the middle level (previously grouped by soil-and-NAD-class) with the litho body in a 2026-08-31 walk interview, so identity now reads from the resolver bodies the engineer sees on the section — the pane, the fence, the 3-D build and the cross-section body menu all name the same masses. It is a plain module, not a component, precisely so the grouping and roll-up can be tested without a browser.

.. CG-EXPLANATION-END id=module-header

``type ClassProvenance``
------------------------

.. CG-BLOCK id=type:ClassProvenance lines=44-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 44-52
   :lineno-match:

.. CG-EXPLANATION-START id=type:ClassProvenance

**What this does.** Names the three possible origins of a packing class: ``'cpt'`` (from a real cone window), ``'partial'`` (some cone, some fallback), or ``'none'`` (no cone behind the class at all).

**Why it is here.** A ``type`` here is just a note listing the only allowed values, so the rest of the file — and the badge that reads it — can never invent a fourth. It is the vocabulary the provenance badge shows.

.. CG-EXPLANATION-END id=type:ClassProvenance

``const PROVENANCE_SEVERITY``
-----------------------------

.. CG-BLOCK id=const:PROVENANCE_SEVERITY lines=53-59

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 53-59
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROVENANCE_SEVERITY

**What this does.** Ranks the three provenance values by severity, higher being worse: cone is 0, partial is 1, no-cone is 2.

**Why it is here.** A litho-body node rolls up its packing bodies to the WORST provenance among them, and this rank is what "worst" means — so the ordering lives in one place instead of being re-decided wherever a comparison is made.

.. CG-EXPLANATION-END id=const:PROVENANCE_SEVERITY

``const CONFIDENCE_SEVERITY``
-----------------------------

.. CG-BLOCK id=const:CONFIDENCE_SEVERITY lines=60-66

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 60-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONFIDENCE_SEVERITY

**What this does.** The companion rank for the confidence tiers, again higher-is-worse: high 0, medium 1, low 2.

**Why it is here.** Same reason as the provenance rank: the roll-up needs one agreed "worse" ordering for confidence so a collapsed node shows the weakest confidence among its leaves.

.. CG-EXPLANATION-END id=const:CONFIDENCE_SEVERITY

``function worseProvenance``
----------------------------

.. CG-BLOCK id=function:worseProvenance lines=67-76

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 67-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:worseProvenance

**What this does.** Returns the worse of two provenance values, using the severity rank.

**Why it is here.** It is the one operation the litho-body roll-up applies across its packing bodies, so the worst-wins rule is stated once and reused.

.. CG-EXPLANATION-END id=function:worseProvenance

``function worseConfidence``
----------------------------

.. CG-BLOCK id=function:worseConfidence lines=77-90

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 77-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:worseConfidence

**What this does.** Returns the worse of two confidence values, treating a missing value as "says nothing" rather than as a weak opinion.

**Why it is here.** A layer set with no opinion must not drag a body's confidence down, because having no opinion about the class is different from having a weak one — so a null is passed over rather than counted as the worst.

.. CG-EXPLANATION-END id=function:worseConfidence

``interface GeotechUnitRef``
----------------------------

.. CG-BLOCK id=interface:GeotechUnitRef lines=91-102

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 91-102
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechUnitRef

**What this does.** Names the fields of a geotech formation the tree reads: its id, NAD class, main soil code, name, stratigraphic display order, source litho formation, and the engineer's picked colour.

**Why it is here.** An ``interface`` is a written note about an object's shape. Listing only the fields the tree actually uses keeps the builder decoupled from the full formation row, so a change elsewhere in the formation shape does not ripple in here.

.. CG-EXPLANATION-END id=interface:GeotechUnitRef

``interface GeotechContactRef``
-------------------------------

.. CG-BLOCK id=interface:GeotechContactRef lines=103-107

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 103-107
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechContactRef

**What this does.** Names the one field of an accepted geotech contact the tree reads — the formation it belongs to.

**Why it is here.** The contacts feed only the header count, so the tree needs nothing more from a contact than which unit it belongs to.

.. CG-EXPLANATION-END id=interface:GeotechContactRef

``interface GeotechLayerRef``
-----------------------------

.. CG-BLOCK id=interface:GeotechLayerRef lines=108-117

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 108-117
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLayerRef

**What this does.** Names the fields of a geotech layer the tree reads: its formation, its confidence, the resolver body it belongs to, and its status.

**Why it is here.** Layers feed the leaf band counts and the badges, so the tree needs the confidence (for the badge), the body id (to count bands per body) and the status (only accepted layers count toward a body's bands).

.. CG-EXPLANATION-END id=interface:GeotechLayerRef

``interface GeotechBodyRef``
----------------------------

.. CG-BLOCK id=interface:GeotechBodyRef lines=118-136

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 118-136
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBodyRef

**What this does.** Names the fields of a geotech packing body the tree reads: the resolver body id, the unit it homes to, its ordinal within that unit's naming group, the engineer's name for it, the litho body it was carved out of, and the geological formations it crosses shallowest-first.

**Why it is here.** The bodies are the leaves of the tree, so the tree reads the id (the selection currency), the home unit (its class, soil and colour), the ordinal (for ordering and labelling), the parent litho body (its middle-level home, debt #278), and the crossed formations (the leaf subtitle, R2).

.. CG-EXPLANATION-END id=interface:GeotechBodyRef

``interface GeotechUnitTreeInput``
----------------------------------

.. CG-BLOCK id=interface:GeotechUnitTreeInput lines=137-164

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 137-164
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechUnitTreeInput

**What this does.** Names everything the builder needs in one bundle: the geotech units, contacts and layers; the geotech bodies; the parent litho model's bodies keyed by id; a litho-unit-id-to-name map; and the geotech-body-to-group-number map.

**Why it is here.** Gathering the builder's inputs into one shape keeps its signature simple and documents which pieces are optional — the tree is body-driven, so with no bodies there is nothing to show, and the litho-body map and group map each degrade the labels or tags gracefully when absent rather than breaking the tree.

.. CG-EXPLANATION-END id=interface:GeotechUnitTreeInput

``interface GeotechPackingBody``
--------------------------------

.. CG-BLOCK id=interface:GeotechPackingBody lines=165-197

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 165-197
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechPackingBody

**What this does.** Names the shape of one bottom-level leaf the builder produces: the body id, its display label, its NAD class, its accepted band count, its provenance and confidence, the crossed geological formations, the home unit id and its class-level label, the colour to draw and whether it is an override, and the manual-group number.

**Why it is here.** This is the finished, screen-ready description of a leaf, so the row renderer draws straight from it without further computation. The class-level unit label is carried separately because the colour swatch edits the whole unit, so its accessible name must name the unit, not the single body (ux-reviewer 2026-09-01).

.. CG-EXPLANATION-END id=interface:GeotechPackingBody

``interface GeotechLithoBodyNode``
----------------------------------

.. CG-BLOCK id=interface:GeotechLithoBodyNode lines=198-225

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 198-225
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLithoBodyNode

**What this does.** Names the shape of one middle-level node: the litho body id (or null for the ungrouped bucket), a stable React key, its label, its summed band count, its worst-case rolled-up provenance and confidence, a representative NAD class, and its packing-body leaves.

**Why it is here.** The rolled-up provenance and confidence are carried on the node so a collapsed node still shows the "No CPT" exception without being expanded (ux-reviewer 2026-09-01), and the representative class lets the badge decide whether to draw — it is suppressed for an unclassified row.

.. CG-EXPLANATION-END id=interface:GeotechLithoBodyNode

``interface GeotechSoilGroup``
------------------------------

.. CG-BLOCK id=interface:GeotechSoilGroup lines=226-233

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 226-233
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechSoilGroup

**What this does.** Names the shape of one top-level group: its soil, its summed band count, and its litho-body nodes.

**Why it is here.** The soil is the outermost grouping level the owner named, so the finished tree is a list of these, each carrying its own total and its child nodes.

.. CG-EXPLANATION-END id=interface:GeotechSoilGroup

``interface GeotechUnitTree``
-----------------------------

.. CG-BLOCK id=interface:GeotechUnitTree lines=234-253

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 234-253
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechUnitTree

**What this does.** Names the builder's whole output: the soil groups plus two header counters — the count of units that describe something, and the total accepted contacts across those units.

**Why it is here.** The header counters describe the geotech UNITS, unchanged from before the tree was body-driven, so the "N with bands" figure at the top of the pane reads exactly as it always did even though the body of the tree is now built from bodies.

.. CG-EXPLANATION-END id=interface:GeotechUnitTree

``function bodyProvenance``
---------------------------

.. CG-BLOCK id=function:bodyProvenance lines=254-261

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 254-261
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyProvenance

**What this does.** Decides where one packing body's class came from by looking at its layers' confidences: no layers means none; any medium-or-high confidence means a cone touched it; a mix of cone and a low-confidence fallback is partial; cone with no fallback is pure cpt.

**Why it is here.** The confidence a band persists IS its provenance — the cone fill writes medium or high from a real cone window, the borehole fallbacks write low — so provenance is read straight off the confidences. A body with cone bands and a fallback is called partial because labelling it "No CPT" would be as untrue as stamping "CPT est." on a pure fallback.

.. CG-EXPLANATION-END id=function:bodyProvenance

``function bodyConfidence``
---------------------------

.. CG-BLOCK id=function:bodyConfidence lines=262-271

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 262-271
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyConfidence

**What this does.** Returns the worst confidence across one body's layers, or nothing when it has none.

**Why it is here.** A body's badge should show its weakest confidence, so this folds the layers together with the worse-of rule, and a body with no layers has no confidence to state.

.. CG-EXPLANATION-END id=function:bodyConfidence

``function compareId``
----------------------

.. CG-BLOCK id=function:compareId lines=272-280

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 272-280
   :lineno-match:

.. CG-EXPLANATION-START id=function:compareId

**What this does.** Compares two id strings for a stable, locale-independent ordering tiebreak.

**Why it is here.** When two bodies share an ordinal, they must still sort in a fixed order that does not change with the machine's language settings, so a plain string comparison is used as the tiebreak.

.. CG-EXPLANATION-END id=function:compareId

``const UNGROUPED_KEY``
-----------------------

.. CG-BLOCK id=const:UNGROUPED_KEY lines=281-282

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 281-282
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNGROUPED_KEY

**What this does.** The key used for the ungrouped bucket — a body whose litho parent is not yet stamped — chosen to sort after every real body.

**Why it is here.** The leading space makes it sort last, so the ungrouped bucket always sits at the bottom of its soil group rather than jumping around among the named litho bodies.

.. CG-EXPLANATION-END id=const:UNGROUPED_KEY

``const UNGROUPED_SORT_ORDINAL``
--------------------------------

.. CG-BLOCK id=const:UNGROUPED_SORT_ORDINAL lines=283-310

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 283-310
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNGROUPED_SORT_ORDINAL

**What this does.** A sentinel ordinal (the largest safe integer) standing in for the ungrouped bucket's litho ordinal, so it sorts last within its soil; the block also carries the opening docstring of the tree builder that follows.

**Why it is here.** The ungrouped bucket has no real litho ordinal to sort by, so a maximal value forces it to the end; the docstring records the builder's ordering rules and that it never throws — an empty input yields an empty tree.

.. CG-EXPLANATION-END id=const:UNGROUPED_SORT_ORDINAL

``function buildGeotechUnitTree``
---------------------------------

.. CG-BLOCK id=function:buildGeotechUnitTree lines=311-472

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechUnitTree.ts
   :language: typescript
   :lines: 311-472
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGeotechUnitTree

**What this does.** The one function the module exports — it turns the units, contacts, layers, bodies and maps into the finished three-level tree. It counts contacts and layers per unit for the header figures, drops units that describe nothing, gathers each layer's accepted-band count and confidences per body, buckets the bodies into soil then litho-body, maps each raw body to a screen-ready leaf, rolls up the worst provenance and confidence per node, and sorts every level — soil groups by stratigraphic order, litho bodies by their ordinal with the ungrouped bucket last, and packing bodies by their own ordinal with the id as tiebreak.

**Why it is here.** It is body-driven: only geotech bodies produce nodes, so before the resolver stamps any body there is simply nothing to show. A body whose home unit is not on the roster is skipped as an orphan, and a body with no stamped litho parent goes to the ungrouped bucket rather than vanishing, so nothing the model holds goes invisible. The header counters still describe the geotech UNITS (a unit with no bands and no layers is not counted), so "N with bands" reads the same as before the tree was rebuilt around bodies. The worst-wins roll-ups on each node are what let a collapsed node still surface the "No CPT" exception (ux-reviewer 2026-09-01).

.. CG-EXPLANATION-END id=function:buildGeotechUnitTree

