groundmodel.application.recompute_formation_absences_for_formation
==================================================================

.. CG-PAGE source=src/groundmodel/application/recompute_formation_absences_for_formation.py complete=true

*Source file:* ``src/groundmodel/application/recompute_formation_absences_for_formation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_formation.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the formation-level absence trigger, plus a named type alias for the per-section cache tuple (the section row, its corridor investigations, and its observation layers). The docstring says this runs the body-level recompute once per relevant section, in one session, with a single commit.

**Why it is here.** Part of the Position 4 architecture (#101 R7), called after correlation-edge changes and after accepting litho suggestions so the absence table always reflects the current graph. One commit at the end makes the whole delta atomic — either every section's inferred absences update, or none do (rolling back with the correlation change). The docstring also flags a known gap: wedge-tip re-materialisation is wired elsewhere, not here (debt #101).

.. CG-EXPLANATION-END id=module-header

Class ``FormationAbsencesForFormationResult``
---------------------------------------------

.. CG-BLOCK id=class:FormationAbsencesForFormationResult lines=48-69

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_formation.py
   :language: python
   :lines: 48-69
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationAbsencesForFormationResult

**What this does.** A dataclass aggregating counts across all processed sections: sections processed, total rows written, total retracted, and total skipped for no data.

**Why it is here.** The caller reports the whole formation-level effect from these totals.

.. CG-EXPLANATION-END id=class:FormationAbsencesForFormationResult

Class ``RecomputeFormationAbsencesForFormation`` — header
---------------------------------------------------------

.. CG-BLOCK id=class:RecomputeFormationAbsencesForFormation lines=70-83

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_formation.py
   :language: python
   :lines: 70-83
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeFormationAbsencesForFormation

**What this does.** The use-case class: the formation-level trigger that runs the body-level inference for each relevant section in one transaction.

**Why it is here.** One class per unit of work; it inherits the shared logger. The caller must not commit before it runs, because it owns the single commit at the end.

.. CG-EXPLANATION-END id=class:RecomputeFormationAbsencesForFormation

Method ``RecomputeFormationAbsencesForFormation``. ``def __init__``
-------------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeFormationAbsencesForFormation.__init__ lines=84-88

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_formation.py
   :language: python
   :lines: 84-88
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeFormationAbsencesForFormation.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; whether this use case commits is controlled by a parameter on execute.

.. CG-EXPLANATION-END id=method:RecomputeFormationAbsencesForFormation.__init__

Method ``RecomputeFormationAbsencesForFormation``. ``async def execute``
------------------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeFormationAbsencesForFormation.execute lines=89-252

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_formation.py
   :language: python
   :lines: 89-252
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeFormationAbsencesForFormation.execute

**What this does.** Scope-guards the model, gathers the sections to process (from the passed-in cache when given, else by loading every project section), then loops them with a per-item progress index, running the body-level recompute for each with commit deferred and accumulating the counts. A section that fails a scope check is logged and skipped rather than aborting the rest. It commits once at the end unless the caller owns the transaction.

**Why it is here.** It loads all project sections and lets the body-level use case decide corridor membership because a project has only a handful of sections, so the scan is negligible. The optional cache is the #153 hoist: the whole-model caller computes each section's corridor and observation layers once and passes them down, removing the redundant per-formation scans. Skipping a single failed section (rather than aborting) means one section deleted mid-flight does not stop the others from updating.

.. CG-EXPLANATION-END id=method:RecomputeFormationAbsencesForFormation.execute

