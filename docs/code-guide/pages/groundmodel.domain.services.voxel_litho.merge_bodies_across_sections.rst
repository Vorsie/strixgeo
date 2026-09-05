groundmodel.domain.services.voxel_litho.merge_bodies_across_sections
====================================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-83

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py
   :language: python
   :lines: 1-83
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces stage 2 of the body model: the pass that decides which per-section body ids are really the same physical body, so the 3-D voxel paint treats them as one. It imports the maths helpers, the snap-grid margins and the partition value objects, and sets the minimum elevation overlap that counts as a real shared band.

**Why it is here.** The frontend merges touching same-lithology regions into one body PER SECTION, so the same physical unit reaches the 3-D builder under a different id on every section it appears on (23 such cases on the real model). That matters because the blend matches the two nearest sections by body id and treats an unmatched body as a one-sided lens that pinches to nothing midway between the sections, which is exactly the invented lithology and the climbing lens the owner reported. The fix lives on the server because the id map must be applied to BOTH the section regions and the separately loaded honoured columns, and only the server holds both. The rule (owner directive 2026-07-28) is that two regions are the same body when they carry the same formation and touch with overlapping elevation, either at a shared column or where two section fences cross in map space. It creates NO correlation tie and writes nothing: the owner's binding rule is to keep the ties and merge on lithological adjacency, never to generate ties. A pure domain module that computes and does not act, so nothing inherits the logging base.

.. CG-EXPLANATION-END id=module-header

Function ``def _gap_touch_fraction``
------------------------------------

.. CG-BLOCK id=function:_gap_touch_fraction lines=84-94

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py
   :language: python
   :lines: 84-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:_gap_touch_fraction

**What this does.** Returns how wide the snap margin (a few grid cells) is, expressed in the fraction coordinate of one particular gap between two columns.

**Why it is here.** Two regions that touch at a shared column must be sampled just inside the gap, not exactly at the column line, and the margin has to be measured in that gap's own fraction space because gaps differ in real width. A private helper.

.. CG-EXPLANATION-END id=function:_gap_touch_fraction

Function ``def _merge_intervals``
---------------------------------

.. CG-BLOCK id=function:_merge_intervals lines=95-122

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py
   :language: python
   :lines: 95-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:_merge_intervals

**What this does.** Takes a list of elevation intervals and merges any that overlap or touch into a smaller list of non-overlapping intervals, dropping any of zero height.

**Why it is here.** A single region can cross the sampling line in more than one piece, and the touch test needs each continuous piece once; merging first keeps the later overlap check honest. A private helper.

.. CG-EXPLANATION-END id=function:_merge_intervals

Function ``def _spans_at_fraction``
-----------------------------------

.. CG-BLOCK id=function:_spans_at_fraction lines=123-213

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py
   :language: python
   :lines: 123-213
   :lineno-match:

.. CG-EXPLANATION-START id=function:_spans_at_fraction

**What this does.** Returns the elevation intervals a region covers along the vertical line at a given position across its gap, as merged non-overlapping spans.

**Why it is here.** Two regions can only be the same body where they actually overlap in elevation at the place they meet, so the merge needs each region's vertical extent right at the column or crossing point. Sampling a small margin inside the gap avoids reading exactly on the column edge. A private helper.

.. CG-EXPLANATION-END id=function:_spans_at_fraction

Function ``def _segment_crossing``
----------------------------------

.. CG-BLOCK id=function:_segment_crossing lines=214-243

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py
   :language: python
   :lines: 214-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:_segment_crossing

**What this does.** Works out whether two straight segments (one gap of each of two sections, drawn between the columns' true world positions) cross, and if so returns where along each segment the crossing lies.

**Why it is here.** The second way two sections can carry the same body is where their fences cross between columns, which with tie-sections cutting across the long cross-sections is the common case, not an exotic one (owner: 'but also when they touch in between columns right?'). This is the geometry test behind that rule. A private helper.

.. CG-EXPLANATION-END id=function:_segment_crossing

Function ``def plan_body_aliases``
----------------------------------

.. CG-BLOCK id=function:plan_body_aliases lines=244-382

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py
   :language: python
   :lines: 244-382
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_body_aliases

**What this does.** Builds the map from every body id to the single representative id of its cross-section group. It groups regions by shared column and by crossing fences, and where two regions in a group share an identity and overlap in elevation it unions their bodies together with union-find (a structure that quickly tracks which group an item belongs to), keeping the smaller id as the representative. An optional identity function collapses the formation to compare by, defaulting to the raw formation id.

**Why it is here.** This is the id map that the voxel paint applies so a unit split across sections paints as one body. The optional identity function is how the geotech model fuses the twins created when one packing class exists under several formation rows (keying on the class, debt #278); the litho model passes nothing and keys on the raw formation, byte-identical to before. It only decides aliases; it writes nothing and creates no tie.

.. CG-EXPLANATION-END id=function:plan_body_aliases

Function ``def plan_layer_groups``
----------------------------------

.. CG-BLOCK id=function:plan_layer_groups lines=383-527

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py
   :language: python
   :lines: 383-527
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_layer_groups

**What this does.** Groups the LAYER identities (each named by its section and region position) whose regions meet across sections, using the same shared-column and crossing-fence tests, but keying strictly on the raw formation row. It returns the connected groups of layer identities.

**Why it is here.** This feeds the PERSISTED body identity, which the owner ruled (2026-09-01) must stay granular: same soil and class under two different formation rows never bridge here, unlike the voxel-paint aliasing above. The divergence between the two is deliberate and both live in this one module so the two rules sit side by side.

.. CG-EXPLANATION-END id=function:plan_layer_groups

Function ``def apply_body_aliases``
-----------------------------------

.. CG-BLOCK id=function:apply_body_aliases lines=528-574

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/merge_bodies_across_sections.py
   :language: python
   :lines: 528-574
   :lineno-match:

.. CG-EXPLANATION-START id=function:apply_body_aliases

**What this does.** Rewrites every region's body id through the alias map, leaving a region whose id is not in the map unchanged.

**Why it is here.** Once the alias map is planned, this is the mechanical step that stamps it onto the section regions so downstream code sees one id per physical body. It changes labels only; it moves no geometry.

.. CG-EXPLANATION-END id=function:apply_body_aliases

