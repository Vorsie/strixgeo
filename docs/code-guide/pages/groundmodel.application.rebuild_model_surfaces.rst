groundmodel.application.rebuild_model_surfaces
==============================================

.. CG-PAGE source=src/groundmodel/application/rebuild_model_surfaces.py complete=true

*Source file:* ``src/groundmodel/application/rebuild_model_surfaces.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-62

.. literalinclude:: ../../../src/groundmodel/application/rebuild_model_surfaces.py
   :language: python
   :lines: 1-62
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the "rebuild every surface in a model" file. It brings in the tools it needs: the sibling ``RecomputeFormationSurface`` use case (a use case is one class that carries out one whole job), the age-order helper, the database row shapes for contacts, cached surfaces, formations and models, the set of model kinds that are not stratigraphic, and the shared logger. The long docstring lays out exactly when this rebuild is needed and why it always recomputes.

**Why it is here.** The docstring records the decision: the automatic hooks that refresh a formation's cached three-dimensional surface after every contact edit cover the normal path, so this manual "Build 3-D model" button is the escape hatch for the cases they miss — a rare checksum collision, contacts changed by a bulk script that bypassed the hooks, or a test's surface elevation re-set through the elevation endpoints, which do not rebuild surfaces themselves. It always re-triangulates every formation that has contacts, because the cache's fingerprint (its checksum) is computed from the input contacts only, so a change to the triangulation code itself would otherwise leave the stale surface in place. An explicit Build must reflect today's code.

.. CG-EXPLANATION-END id=module-header

Class ``RebuildOutcome``
------------------------

.. CG-BLOCK id=class:RebuildOutcome lines=63-71

.. literalinclude:: ../../../src/groundmodel/application/rebuild_model_surfaces.py
   :language: python
   :lines: 63-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:RebuildOutcome

**What this does.** A small frozen data holder (a *dataclass* is a class whose only job is to carry a few named values; *frozen* means it cannot be changed after it is made) reporting one rebuild pass: how many formations were looked at, how many were re-triangulated, and how many had their display order corrected.

**Why it is here.** The caller — the web layer — reports these counts back to the engineer so a Build says plainly what it did. It holds data only and does no work, so per the CLAUDE.md logging rule it does not inherit the logger.

.. CG-EXPLANATION-END id=class:RebuildOutcome

Class ``RebuildModelSurfaces`` — header
---------------------------------------

.. CG-BLOCK id=class:RebuildModelSurfaces lines=72-74

.. literalinclude:: ../../../src/groundmodel/application/rebuild_model_surfaces.py
   :language: python
   :lines: 72-74
   :lineno-match:

.. CG-EXPLANATION-START id=class:RebuildModelSurfaces

**What this does.** Declares the use-case class and states its one job in the docstring: force-recompute every formation's cached surface in one geological model. It inherits the shared logger so its log lines are tagged with this module's name.

**Why it is here.** It is the model-wide counterpart of the single-formation recompute; grouping the whole-model rebuild in one class gives the "Build" button a single, stable entry point. Why: recorded in the class docstring.

.. CG-EXPLANATION-END id=class:RebuildModelSurfaces

Method ``RebuildModelSurfaces``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:RebuildModelSurfaces.__init__ lines=75-79

.. literalinclude:: ../../../src/groundmodel/application/rebuild_model_surfaces.py
   :language: python
   :lines: 75-79
   :lineno-match:

.. CG-EXPLANATION-START id=method:RebuildModelSurfaces.__init__

**What this does.** Sets up the use case with an active database session (a *session* is the open conversation with the database through which reads and writes travel) and names the logger after this module.

**Why it is here.** The caller owns the session and hands it in, so this use case reads and writes inside the caller's transaction (a *transaction* is a unit of work that either fully happens or is fully undone) and does not open its own.

.. CG-EXPLANATION-END id=method:RebuildModelSurfaces.__init__

Method ``RebuildModelSurfaces``. ``async def execute``
------------------------------------------------------

.. CG-BLOCK id=method:RebuildModelSurfaces.execute lines=80-162

.. literalinclude:: ../../../src/groundmodel/application/rebuild_model_surfaces.py
   :language: python
   :lines: 80-162
   :lineno-match:

.. CG-EXPLANATION-START id=method:RebuildModelSurfaces.execute

**What this does.** The one public step. It gathers the ids of every formation that has at least one contact in the model, adds any formation whose cached surface is still flagged stale even though its last contact was deleted, and if the combined set is empty it logs a no-op and returns. Otherwise it re-triangulates every one of them through ``RecomputeFormationSurface`` with force turned on, re-derives the formation age order from the freshly built data, commits once if anything changed, and returns the counts.

**Why it is here.** The stale-orphan pickup is spelled out in the comment: a deleted-last-contact leaves a stale surface row that the contact-only query would miss, so the "N unbuilt edits" badge would stick forever; one Build must reach a clean state. Force is passed so a triangulation-algorithm change is reflected without the engineer having to touch a contact to bust the cache. The single commit at the end makes the whole rebuild one all-or-nothing transaction.

.. CG-EXPLANATION-END id=method:RebuildModelSurfaces.execute

Method ``RebuildModelSurfaces``. ``async def _reorder_by_age``
--------------------------------------------------------------

.. CG-BLOCK id=method:RebuildModelSurfaces._reorder_by_age lines=163-314

.. literalinclude:: ../../../src/groundmodel/application/rebuild_model_surfaces.py
   :language: python
   :lines: 163-314
   :lineno-match:

.. CG-EXPLANATION-START id=method:RebuildModelSurfaces._reorder_by_age

**What this does.** Re-sorts the formations' display order from the contact depths the engineer just built against. It reads every contact with its anchor and depth, turns each investigation with two or more contacts into a local "younger sits on older" ordering, and combines them across investigations. It first short-circuits for non-stratigraphic model kinds, then scopes the reorder to the geological-level formations only, keeps every formation the engineer manually pinned exactly where it is, orders the rest oldest-first into the free slots, and returns how many actually moved.

**Why it is here.** Every guard here fixes a recorded bug. Skipping non-stratigraphic kinds (debt #69) stops a geological Build from renumbering the litho units, whose per-instance order the accept path had just set — interfingering sand and clay is real geology, not a superposition error. Pinned formations are left untouched (debt #35) because the engineer pinned them precisely to override the age inference the data cannot resolve — pinch-outs, unconformities, inversions. The oldest-first slot assignment follows the CLAUDE.md rule that display order is the age axis with lower meaning older (debt #177).

.. CG-EXPLANATION-END id=method:RebuildModelSurfaces._reorder_by_age

