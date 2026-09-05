groundmodel.application.recompute_formation_absences_for_body
=============================================================

.. CG-PAGE source=src/groundmodel/application/recompute_formation_absences_for_body.py complete=true

*Source file:* ``src/groundmodel/application/recompute_formation_absences_for_body.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_body.py
   :language: python
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the use case that runs the absence-inference engine for one formation body and writes the resulting change. The docstring lists the seven steps (load the body's contacts, the corridor's investigations, their observation layers and the existing absence rows; run the pure inference; write the new rows and delete the stale ones; commit) and states the idempotency and positive-evidence guarantees.

**Why it is here.** Part of the Position 4 architecture (#101), called after any correlation-edge or observation change that affects a formation. It is idempotent because the write uses insert-on-conflict-do-update, so a second run with the same inputs is a no-op at the constraint level. The positive-evidence guard lives in the pure domain engine: an investigation with no observation layer overlapping the body's depth band is left UNKNOWN, not marked ABSENT — the engine never asserts absence without evidence.

.. CG-EXPLANATION-END id=module-header

Class ``RecomputeFormationAbsencesResult``
------------------------------------------

.. CG-BLOCK id=class:RecomputeFormationAbsencesResult lines=54-72

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_body.py
   :language: python
   :lines: 54-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeFormationAbsencesResult

**What this does.** A dataclass returning three counts: rows written (inserted or updated), stale inferred rows retracted, and absent investigations skipped for having no overlapping observation layer.

**Why it is here.** The counts let the caller and the logs report exactly what the inference changed.

.. CG-EXPLANATION-END id=class:RecomputeFormationAbsencesResult

Function ``async def load_corridor_investigations``
---------------------------------------------------

.. CG-BLOCK id=function:load_corridor_investigations lines=73-138

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_body.py
   :language: python
   :lines: 73-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_corridor_investigations

**What this does.** A module-level helper returning the (investigation id, kind) pairs whose location falls inside a section's corridor — the section's bounding box expanded by its projection buffer — querying boreholes and CPTs.

**Why it is here.** It is module-level so the whole-model recompute can compute it once per section and reuse it across every formation, while the single-body lens path can also call it directly — extracted on the second caller per the project's extract-on-second-use rule. The corridor geometry mirrors the section-snapshot builder so the same investigations project onto the section.

.. CG-EXPLANATION-END id=function:load_corridor_investigations

Function ``async def load_observation_layers``
----------------------------------------------

.. CG-BLOCK id=function:load_observation_layers lines=139-206

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_body.py
   :language: python
   :lines: 139-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_observation_layers

**What this does.** A module-level helper that loads the observation-layer records (top, base, soil codes) for the borehole investigations in a corridor, in two queries, and flattens them into the record shape the inference engine expects.

**Why it is here.** Same reuse rationale as the corridor loader — shared by the cached whole-model path and the direct single-body path. It covers boreholes only because CPT Robertson-SBT layers are Phase 5.

.. CG-EXPLANATION-END id=function:load_observation_layers

Function ``async def load_project_sections``
--------------------------------------------

.. CG-BLOCK id=function:load_project_sections lines=207-240

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_body.py
   :language: python
   :lines: 207-240
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_project_sections

**What this does.** A module-level helper returning all of a project's cross-sections ordered by display order.

**Why it is here.** It lives beside the corridor loader because the same query had been copy-pasted into three use cases; it was extracted once the third copy appeared, per the extract-on-second-copy rule. The display-order sort is the stable ordering every caller iterates in.

.. CG-EXPLANATION-END id=function:load_project_sections

Class ``RecomputeFormationAbsencesForBody`` — header
----------------------------------------------------

.. CG-BLOCK id=class:RecomputeFormationAbsencesForBody lines=241-249

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_body.py
   :language: python
   :lines: 241-249
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeFormationAbsencesForBody

**What this does.** The use-case class: run the inference engine for one body and apply the delta to the database.

**Why it is here.** One class per unit of work; it inherits the shared logger.

.. CG-EXPLANATION-END id=class:RecomputeFormationAbsencesForBody

Method ``RecomputeFormationAbsencesForBody``. ``def __init__``
--------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeFormationAbsencesForBody.__init__ lines=250-254

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_body.py
   :language: python
   :lines: 250-254
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeFormationAbsencesForBody.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; whether this use case commits is controlled by a parameter on execute.

.. CG-EXPLANATION-END id=method:RecomputeFormationAbsencesForBody.__init__

Method ``RecomputeFormationAbsencesForBody``. ``async def execute``
-------------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeFormationAbsencesForBody.execute lines=255-507

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_absences_for_body.py
   :language: python
   :lines: 255-507
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeFormationAbsencesForBody.execute

**What this does.** Runs one inference pass. It scope-guards the model, formation and section; loads the formation's contacts (treated as the body's contacts for the MVP); loads the corridor investigations and their observation layers (using pre-computed ones when passed in, else self-loading); loads the existing absence rows for this formation across the corridor; calls the pure ``infer_formation_absences`` domain function; then applies its result — a single multi-row insert-on-conflict-do-update for the rows to write, and one delete for the rows to retract — and commits unless the caller asked to defer.

**Why it is here.** For the MVP all contacts for a (model, formation) are treated as one body; multi-body disambiguation is Phase 5, and the pure engine already supports a pre-filtered caller. The write is batched into one statement because profiling (#153) showed the old per-row loop dominated the whole-model recompute (hundreds of awaited round-trips). The conflict-update is guarded to only touch inferred rows so a manual or observed row that somehow reaches the write list is never demoted. The commit flag lets the formation-level and whole-model callers own the transaction so all their sections' deltas land atomically.

.. CG-EXPLANATION-END id=method:RecomputeFormationAbsencesForBody.execute

