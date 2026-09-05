groundmodel.application.auto_correlate_geotech_edges
====================================================

.. CG-PAGE source=src/groundmodel/application/auto_correlate_geotech_edges.py complete=true

*Source file:* ``src/groundmodel/application/auto_correlate_geotech_edges.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-99

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_geotech_edges.py
   :language: python
   :lines: 1-99
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the geotech auto-correlate file. It imports the crossing and off-section sweeps, the shared edge-derivation helpers, the tombstone gates, the frame-conformance resolver, the scope guard, the section-membership helpers, and the rows, and its docstring lays out the whole rule.

**Why it is here.** It mirrors the litho axis's auto-correlate verb but for packing ties, and exists so the automatic geotech ties get their own verb — deriving them used to happen only inside the subdivide, which also destroys every hand-drawn correlation. The load-bearing invariant is that it ADDS and never reconciles: every persisted edge is preloaded so a candidate that already exists is skipped, and nothing is updated or re-approved. It is section-scoped (owner 2026-08-25): a tie is only derivable between two columns the section actually draws. A tie is a correlation edge joining two bands; an unapproved edge is a suggestion the engineer promotes.

.. CG-EXPLANATION-END id=module-header

Class ``AutoCorrelateGeotechResult``
------------------------------------

.. CG-BLOCK id=class:AutoCorrelateGeotechResult lines=100-163

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_geotech_edges.py
   :language: python
   :lines: 100-163
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateGeotechResult

**What this does.** A frozen dataclass reporting the run: edges proposed, edges born accepted, edges skipped as existing, sections processed, and several diagnostic skip and sweep counts.

**Why it is here.** The docstring records each: a restatement of an approved litho tie is born accepted because the litho approval already vouches for it; the off-section and crossing counts name machine rows a sweep removed; the frame-flagged count is ties written but badged for review because they exceed the litho frame (owner 2026-08-21).

.. CG-EXPLANATION-END id=class:AutoCorrelateGeotechResult

Class ``AutoCorrelateGeotechEdges`` — header
--------------------------------------------

.. CG-BLOCK id=class:AutoCorrelateGeotechEdges lines=164-174

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_geotech_edges.py
   :language: python
   :lines: 164-174
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateGeotechEdges

**What this does.** The use case that re-derives geotech packing correlations as suggestions, adding only.

**Why it is here.** The caller owns the session and it commits once; it adds suggestions the engineer reviews, never removing a tie the engineer drew or approved.

.. CG-EXPLANATION-END id=class:AutoCorrelateGeotechEdges

Method ``AutoCorrelateGeotechEdges``. ``def __init__``
------------------------------------------------------

.. CG-BLOCK id=method:AutoCorrelateGeotechEdges.__init__ lines=175-179

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_geotech_edges.py
   :language: python
   :lines: 175-179
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoCorrelateGeotechEdges.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this use case writes through it.

.. CG-EXPLANATION-END id=method:AutoCorrelateGeotechEdges.__init__

Method ``AutoCorrelateGeotechEdges``. ``async def execute``
-----------------------------------------------------------

.. CG-BLOCK id=method:AutoCorrelateGeotechEdges.execute lines=180-458

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_geotech_edges.py
   :language: python
   :lines: 180-458
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoCorrelateGeotechEdges.execute

**What this does.** Scope-guards a geotechnical model with a litho parent, loads the geotech bands and litho depths, preloads every existing edge per section, then for each section derives packing ties from the parent's approved litho edges (bridging over band-less columns), sweeps crossings and off-section proposals, flags frame mismatches on the new ties, and commits.

**Why it is here.** It refuses a non-geotech model because the rule aligns NAD packing-class sequences, which only geotech formations carry. Membership is enforced on the inputs (owner 2026-08-25) because the litho edge table carries rows written before the endpoint clamp. The topmost sub-band pair restates the litho tie regardless of class (owner 2026-08-13) while the class-matched sequence aligns the bands below. Jump ties bridge the litho chain across borehole columns still empty of packing (owner 2026-08-04) so a CPT-borehole-CPT section proposes the CPT pair. The crossing and off-section sweeps reach stored machine rows an emit-time guard cannot (owner 2026-08-17/25), never the engineer's own lines.

.. CG-EXPLANATION-END id=method:AutoCorrelateGeotechEdges.execute

Method ``AutoCorrelateGeotechEdges``. ``async def _load_geotech_bands``
-----------------------------------------------------------------------

.. CG-BLOCK id=method:AutoCorrelateGeotechEdges._load_geotech_bands lines=459-510

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_geotech_edges.py
   :language: python
   :lines: 459-510
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoCorrelateGeotechEdges._load_geotech_bands

**What this does.** Loads every packing band of the model, both CPT and borehole columns, keyed by investigation as depth-ordered rows carrying the NAD class.

**Why it is here.** By auto-correlate time both CPT and borehole bands are present, so a borehole-mediated tie must be proposable too; the shape matches what the shared derivation expects.

.. CG-EXPLANATION-END id=method:AutoCorrelateGeotechEdges._load_geotech_bands

Method ``AutoCorrelateGeotechEdges``. ``async def _load_edge_ids``
------------------------------------------------------------------

.. CG-BLOCK id=method:AutoCorrelateGeotechEdges._load_edge_ids lines=511-535

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_geotech_edges.py
   :language: python
   :lines: 511-535
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoCorrelateGeotechEdges._load_edge_ids

**What this does.** Returns the set of every edge id the model has right now.

**Why it is here.** Snapshotted before the derivation so the frame-conformance flag touches only this run's new ties, never re-applying a badge the engineer already cleared on an older tie.

.. CG-EXPLANATION-END id=method:AutoCorrelateGeotechEdges._load_edge_ids

Method ``AutoCorrelateGeotechEdges``. ``async def _flag_frame_mismatched_new_edges``
------------------------------------------------------------------------------------

.. CG-BLOCK id=method:AutoCorrelateGeotechEdges._flag_frame_mismatched_new_edges lines=536-612

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_geotech_edges.py
   :language: python
   :lines: 536-612
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoCorrelateGeotechEdges._flag_frame_mismatched_new_edges

**What this does.** Stamps the frame-mismatch review badge on this run's new ties that exceed the litho frame, running the shared resolver and warning without refusing.

**Why it is here.** The machine restates a direct litho tie regardless of class (owner 2026-08-13), so a cross-soil surface tie yields a packing tie whose two bands can never become one mass — exactly the tie the hand path flags (owner 2026-08-21). It reuses the shared resolver so both paths flag the identical tie with the identical badge, and is scoped to new, un-flagged ties so a cleared badge is never re-applied.

.. CG-EXPLANATION-END id=method:AutoCorrelateGeotechEdges._flag_frame_mismatched_new_edges

