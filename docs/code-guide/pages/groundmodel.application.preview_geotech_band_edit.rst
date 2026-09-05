groundmodel.application.preview_geotech_band_edit
=================================================

.. CG-PAGE source=src/groundmodel/application/preview_geotech_band_edit.py complete=true

*Source file:* ``src/groundmodel/application/preview_geotech_band_edit.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../src/groundmodel/application/preview_geotech_band_edit.py
   :language: python
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the band-edit preview file. It imports the column-context loader and the CPT-anchor guard, and the pure planning functions for split, merge and move, and its docstring says the preview answers what an edit would do before anything is written.

**Why it is here.** The UI calls it first to show, per resulting interval, the representative (median) cone resistance, the re-derived NAD packing class, and the plain consequence. It deliberately does not guess — an interval the cone cannot answer comes back unclassified with a reason, because the classifier rejects invalid input by design (owner 2026-07-25) — and it does not block except on a breach of the three-level hierarchy. It reads the model's chosen statistic so the preview predicts the reclassification that will actually happen (ruling 6/7).

.. CG-EXPLANATION-END id=module-header

Class ``PreviewGeotechBandEdit`` — header
-----------------------------------------

.. CG-BLOCK id=class:PreviewGeotechBandEdit lines=51-62

.. literalinclude:: ../../../src/groundmodel/application/preview_geotech_band_edit.py
   :language: python
   :lines: 51-62
   :lineno-match:

.. CG-EXPLANATION-START id=class:PreviewGeotechBandEdit

**What this does.** The read-only use case that plans a split, merge or move and returns the plan without writing.

**Why it is here.** It reads one column, plans with the shared pure domain functions, and commits nothing.

.. CG-EXPLANATION-END id=class:PreviewGeotechBandEdit

Method ``PreviewGeotechBandEdit``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:PreviewGeotechBandEdit.__init__ lines=63-67

.. literalinclude:: ../../../src/groundmodel/application/preview_geotech_band_edit.py
   :language: python
   :lines: 63-67
   :lineno-match:

.. CG-EXPLANATION-START id=method:PreviewGeotechBandEdit.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this use case only reads.

.. CG-EXPLANATION-END id=method:PreviewGeotechBandEdit.__init__

Method ``PreviewGeotechBandEdit``. ``async def preview_split``
--------------------------------------------------------------

.. CG-BLOCK id=method:PreviewGeotechBandEdit.preview_split lines=68-125

.. literalinclude:: ../../../src/groundmodel/application/preview_geotech_band_edit.py
   :language: python
   :lines: 68-125
   :lineno-match:

.. CG-EXPLANATION-START id=method:PreviewGeotechBandEdit.preview_split

**What this does.** Previews splitting one band at a depth: loads the column, requires a CPT anchor, plans the split, and returns the two resulting intervals with their re-derived classes.

**Why it is here.** A split outside the band's own litho body is refused by the planner (the hierarchy is a hard bound); a borehole is refused because its class is not measured from cone resistance.

.. CG-EXPLANATION-END id=method:PreviewGeotechBandEdit.preview_split

Method ``PreviewGeotechBandEdit``. ``async def preview_merge``
--------------------------------------------------------------

.. CG-BLOCK id=method:PreviewGeotechBandEdit.preview_merge lines=126-193

.. literalinclude:: ../../../src/groundmodel/application/preview_geotech_band_edit.py
   :language: python
   :lines: 126-193
   :lineno-match:

.. CG-EXPLANATION-START id=method:PreviewGeotechBandEdit.preview_merge

**What this does.** Previews merging an adjacent pair, or an N-band contiguous run, into one: loads the column, requires a CPT anchor, plans the merge, and returns the union interval with its re-derived class.

**Why it is here.** The N-band run is the small-lens absorb (host, lens, host) in one honest preview; a run that is not consecutive same-parentage neighbours is refused by the planner.

.. CG-EXPLANATION-END id=method:PreviewGeotechBandEdit.preview_merge

Method ``PreviewGeotechBandEdit``. ``async def preview_move``
-------------------------------------------------------------

.. CG-BLOCK id=method:PreviewGeotechBandEdit.preview_move lines=194-254

.. literalinclude:: ../../../src/groundmodel/application/preview_geotech_band_edit.py
   :language: python
   :lines: 194-254
   :lineno-match:

.. CG-EXPLANATION-START id=method:PreviewGeotechBandEdit.preview_move

**What this does.** Previews dragging the shared boundary of an adjacent pair: loads the column, requires a CPT anchor, plans the move, and returns both re-derived intervals.

**Why it is here.** A drag is only legal on a same-parentage pair (any other boundary is a litho or geological contact) with the depth strictly inside the pair, both enforced by the planner.

.. CG-EXPLANATION-END id=method:PreviewGeotechBandEdit.preview_move

Method ``PreviewGeotechBandEdit``. ``def _log_plan``
----------------------------------------------------

.. CG-BLOCK id=method:PreviewGeotechBandEdit._log_plan lines=255-281

.. literalinclude:: ../../../src/groundmodel/application/preview_geotech_band_edit.py
   :language: python
   :lines: 255-281
   :lineno-match:

.. CG-EXPLANATION-START id=method:PreviewGeotechBandEdit._log_plan

**What this does.** Logs the previewed outcome per interval, warning about any it could not classify and reporting the class change otherwise.

**Why it is here.** Logging what could NOT be answered (the Definition-of-Done rule) makes an unclassifiable interval visible in the log without a debugger.

.. CG-EXPLANATION-END id=method:PreviewGeotechBandEdit._log_plan

