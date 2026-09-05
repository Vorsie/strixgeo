groundmodel.application.materialize_wedge_tips_for_formation
============================================================

.. CG-PAGE source=src/groundmodel/application/materialize_wedge_tips_for_formation.py complete=true

*Source file:* ``src/groundmodel/application/materialize_wedge_tips_for_formation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-97

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 1-97
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring, imports and two constants for the use case that re-creates synthetic wedge-tip contacts for one formation. The docstring lists its five steps and the geometry prerequisites; the imports pull in the pinch-out provenance constants, the section loader, the pure-domain lens-tip geometry, the row types, and the section-projection helpers. The two constants are a one-metre perpendicular offset and a fifty-metre fallback corridor buffer.

**Why it is here.** A wedge tip is the synthetic point where a formation pinches out to nothing between columns; a synthetic contact is one the engine computes rather than reads from an investigation. The docstring records why they must be recomputed: after the inference engine rewrites which columns a formation is absent from, the old synthetic contacts were computed from the old absences and are stale. It states the two prerequisites for a tip (a real contact on the pinching side, and at least two contacts on the parent surface) and that when either fails the absence is kept but no tip is drawn, because the section still renders the absence correctly. The one-metre offset is explained in a comment: it is large enough to stop the triangulation collapsing the tip onto the section-line point (which would degenerate the wedge to a point), yet small enough to be geologically negligible. The transaction boundary is deferred to the caller so the absence delta and the synthetic contacts are written atomically.

.. CG-EXPLANATION-END id=module-header

Class ``WedgeTipMaterializationResult``
---------------------------------------

.. CG-BLOCK id=class:WedgeTipMaterializationResult lines=98-120

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 98-120
   :lineno-match:

.. CG-EXPLANATION-START id=class:WedgeTipMaterializationResult

**What this does.** A dataclass reporting the run: how many sections were scanned, how many stale synthetic contacts were deleted, how many new ones were created, and how many absences were skipped because the geometry could not be computed.

**Why it is here.** The four counts are the honest report. Skipped absences are kept in the table (the inference result is correct); only the synthetic geometry is missing, so the count tells the engineer how many pinch-outs lacked the contacts needed to draw a tip.

.. CG-EXPLANATION-END id=class:WedgeTipMaterializationResult

Class ``MaterializeWedgeTipsForFormation`` — header
---------------------------------------------------

.. CG-BLOCK id=class:MaterializeWedgeTipsForFormation lines=121-130

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 121-130
   :lineno-match:

.. CG-EXPLANATION-START id=class:MaterializeWedgeTipsForFormation

**What this does.** The use-case class header, inheriting the logger.

**Why it is here.** The docstring restates the job — re-materialise wedge-tip contacts for one formation after an absence change — and that the caller controls the transaction boundary through the commit flag on ``execute``.

.. CG-EXPLANATION-END id=class:MaterializeWedgeTipsForFormation

Method ``MaterializeWedgeTipsForFormation``. ``def __init__``
-------------------------------------------------------------

.. CG-BLOCK id=method:MaterializeWedgeTipsForFormation.__init__ lines=131-135

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 131-135
   :lineno-match:

.. CG-EXPLANATION-START id=method:MaterializeWedgeTipsForFormation.__init__

**What this does.** The setup step: stores the caller's database session.

**Why it is here.** The caller owns the session; whether this use case commits is decided by the commit flag passed to ``execute``.

.. CG-EXPLANATION-END id=method:MaterializeWedgeTipsForFormation.__init__

Method ``MaterializeWedgeTipsForFormation``. ``async def execute``
------------------------------------------------------------------

.. CG-BLOCK id=method:MaterializeWedgeTipsForFormation.execute lines=136-533

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 136-533
   :lineno-match:

.. CG-EXPLANATION-START id=method:MaterializeWedgeTipsForFormation.execute

**What this does.** The entry point. It scope-guards the model and formation, loads every project section, loads the formation's absence rows, loads the real contacts that form the pinching line and the parent contacts that form the target line, geocodes every referenced investigation, deletes the stale synthetic contacts once, then for each section builds the two along-section polylines and tries a wedge tip for every absent column in the corridor, seeding the new contact ids onto the section. It commits when asked and returns the counts.

**Why it is here.** The scope guard raises on a project mismatch (the real id-guessing risk) but returns a harmless zero-count result on a not-found row, which the comment explains is a defensive fallback for a unit-test mock where the row was just added and is not yet visible. The stale synthetic contacts are deleted ONCE before the section loop, not inside it, because the synthetic query is model-and-formation scoped with no section column: deleting inside the loop meant a later section erased the tips an earlier one had just flushed and pruned only its own seeded array, leaving dangling ids on every other section (fixed in issue #231). Elevation is read from the elevation column, not a non-existent ground-level column — a comment records that the wrong name once made every accept-all call fail. Progress is logged per section with an ``[i/total]`` prefix, and a failed tip logs a warning and increments the skip count rather than aborting.

.. CG-EXPLANATION-END id=method:MaterializeWedgeTipsForFormation.execute

Method ``MaterializeWedgeTipsForFormation``. ``async def _find_existing_synthetic_ids``
---------------------------------------------------------------------------------------

.. CG-BLOCK id=method:MaterializeWedgeTipsForFormation._find_existing_synthetic_ids lines=534-554

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 534-554
   :lineno-match:

.. CG-EXPLANATION-START id=method:MaterializeWedgeTipsForFormation._find_existing_synthetic_ids

**What this does.** A private helper returning the ids of all existing synthetic contacts for the given model and formation — the rows with the pinch-out source and no investigation anchor.

**Why it is here.** It identifies exactly the stale synthetic contacts to delete before recomputing, matching on the synthetic source and the absence of a borehole or CPT anchor so a real contact is never caught.

.. CG-EXPLANATION-END id=method:MaterializeWedgeTipsForFormation._find_existing_synthetic_ids

Method ``MaterializeWedgeTipsForFormation``. ``async def _remove_from_seeded_ids``
----------------------------------------------------------------------------------

.. CG-BLOCK id=method:MaterializeWedgeTipsForFormation._remove_from_seeded_ids lines=555-565

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 555-565
   :lineno-match:

.. CG-EXPLANATION-START id=method:MaterializeWedgeTipsForFormation._remove_from_seeded_ids

**What this does.** A private helper that removes a set of contact ids from a section's list of seeded (explicitly-shown) contact ids.

**Why it is here.** When the stale synthetic contacts are deleted their ids must also leave every section's explicit-content set, or the set accumulates dangling references. This keeps the section's shown-contact list honest.

.. CG-EXPLANATION-END id=method:MaterializeWedgeTipsForFormation._remove_from_seeded_ids

Method ``MaterializeWedgeTipsForFormation``. ``async def _add_to_seeded_ids``
-----------------------------------------------------------------------------

.. CG-BLOCK id=method:MaterializeWedgeTipsForFormation._add_to_seeded_ids lines=566-576

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 566-576
   :lineno-match:

.. CG-EXPLANATION-START id=method:MaterializeWedgeTipsForFormation._add_to_seeded_ids

**What this does.** A private helper that adds new contact ids to a section's seeded-id list, keeping the set unique and sorted.

**Why it is here.** A freshly created wedge-tip contact must be marked as explicitly shown on the section that owns it; union semantics avoid duplicating an id that is already present.

.. CG-EXPLANATION-END id=method:MaterializeWedgeTipsForFormation._add_to_seeded_ids

Method ``MaterializeWedgeTipsForFormation``. ``async def _compute_and_insert_tip``
----------------------------------------------------------------------------------

.. CG-BLOCK id=method:MaterializeWedgeTipsForFormation._compute_and_insert_tip lines=577-704

.. literalinclude:: ../../../src/groundmodel/application/materialize_wedge_tips_for_formation.py
   :language: python
   :lines: 577-704
   :lineno-match:

.. CG-EXPLANATION-START id=method:MaterializeWedgeTipsForFormation._compute_and_insert_tip

**What this does.** A private helper that computes one wedge tip and inserts two synthetic contacts for it — the on-line tip and a perpendicular twin. It requires at least one pinching point and two target points, tries the right direction then the left, converts the tip's along-distance to world coordinates, offsets the twin one metre perpendicular, and adds both rows.

**Why it is here.** It tries both directions so a pinch-out that closes either way still yields a tip, and raises a geometry error only when both fail (the caller then counts a skip). The perpendicular twin exists to break collinearity: the triangulation silently collapses collinear or duplicate points, so without the twin the tip and the section-line contact would share a position and the wedge would degenerate to a point (the same rationale as the older extrapolate-pinch-out path).

.. CG-EXPLANATION-END id=method:MaterializeWedgeTipsForFormation._compute_and_insert_tip

