groundmodel.infrastructure.db.repositories.investigation_review_repository
==========================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus the toolbox: ``UTC`` / ``datetime``, ``Any``, ``UUID``, ``select``, Postgres's ``insert`` (imported as ``pg_insert`` for its upsert support), ``AsyncSession``, ``uuid7``, the review ORM class, and the logging base. Two frozen sets re-assert the allowed target kinds and review statuses.

**Why it is here.** The allowed-value sets mirror the database's own check constraints, re-asserted here so a caller bypassing the API (a test or a future script) still fails cleanly instead of pushing a bad value to Postgres. The Postgres-specific insert is imported because the main write below is an *upsert*.

.. CG-EXPLANATION-END id=module-header

Class ``InvestigationReviewRepository`` — header
------------------------------------------------

.. CG-BLOCK id=class:InvestigationReviewRepository lines=37-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 37-39
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvestigationReviewRepository

**What this does.** Opens the ``InvestigationReviewRepository`` class — async CRUD for review rows.

**Why it is here.** Per-investigation engineering decisions (review status, notes, hidden flag) with a polymorphic anchor, so one repository serves both CPT- and borehole-targeted reviews, mirroring the section repository's focused shape.

.. CG-EXPLANATION-END id=class:InvestigationReviewRepository

Method ``InvestigationReviewRepository``. ``def __init__``
----------------------------------------------------------

.. CG-BLOCK id=method:InvestigationReviewRepository.__init__ lines=40-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 40-44
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvestigationReviewRepository.__init__

**What this does.** The set-up method: registers the logger and stores the open session.

**Why it is here.** The shared one-session-per-request pattern.

.. CG-EXPLANATION-END id=method:InvestigationReviewRepository.__init__

Method ``InvestigationReviewRepository``. ``async def list_all``
----------------------------------------------------------------

.. CG-BLOCK id=method:InvestigationReviewRepository.list_all lines=45-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 45-53
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvestigationReviewRepository.list_all

**What this does.** Returns every review row for a project, ordered by creation time.

**Why it is here.** The list view needs the project's whole set of decisions in a stable order.

.. CG-EXPLANATION-END id=method:InvestigationReviewRepository.list_all

Method ``InvestigationReviewRepository``. ``async def get``
-----------------------------------------------------------

.. CG-BLOCK id=method:InvestigationReviewRepository.get lines=54-57

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 54-57
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvestigationReviewRepository.get

**What this does.** Looks up one review row by its own id, or ``None``.

**Why it is here.** The id-keyed read for callers that already hold the review row's id.

.. CG-EXPLANATION-END id=method:InvestigationReviewRepository.get

Method ``InvestigationReviewRepository``. ``async def get_for_target``
----------------------------------------------------------------------

.. CG-BLOCK id=method:InvestigationReviewRepository.get_for_target lines=58-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 58-71
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvestigationReviewRepository.get_for_target

**What this does.** Looks up the review row for a specific investigation by its ``(target_kind, target_id)`` pair, or ``None`` when none exists.

**Why it is here.** The target-keyed read is the natural one for the UI, which cares only that there is a decision for borehole X, not which row id holds it. A missing row means the default state — unreviewed and not hidden — so callers treat ``None`` as that default rather than an error.

.. CG-EXPLANATION-END id=method:InvestigationReviewRepository.get_for_target

Method ``InvestigationReviewRepository``. ``async def set_for_target``
----------------------------------------------------------------------

.. CG-BLOCK id=method:InvestigationReviewRepository.set_for_target lines=72-200

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 72-200
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvestigationReviewRepository.set_for_target

**What this does.** Idempotently records a decision for an investigation: it validates the enum values, reads the current row, merges the patch with the current state (respecting the difference between an absent key and an explicit null), computes the reviewed-at timestamp from the status transition, and writes it all with an *upsert* — insert if new, update if the target already has a row. It returns the written row and logs create versus update.

**Why it is here.** *Upsert* means 'insert, or update on conflict'; here ``ON CONFLICT (target_kind, target_id) DO UPDATE`` turns two racing inserts into a deterministic last-writer-wins update instead of a crash (debt #14). The merge is done in Python because plain SQL cannot tell 'the caller omitted this field' (leave it) from 'the caller sent null' (clear it). The timestamp follows the status only — stamped when the status becomes 'reviewed', cleared when it moves back — so callers never manage it. Validating the enums here raises a clean ``ValueError`` (a 422 at the API) rather than letting a raw database constraint violation bubble up as a 500. The write asks SQLAlchemy to refresh the in-memory row from what the database returned, so a caller never sees stale pre-write values.

.. CG-EXPLANATION-END id=method:InvestigationReviewRepository.set_for_target

Method ``InvestigationReviewRepository``. ``async def delete``
--------------------------------------------------------------

.. CG-BLOCK id=method:InvestigationReviewRepository.delete lines=201-215

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 201-215
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvestigationReviewRepository.delete

**What this does.** Deletes a review row by its own id, returning ``True`` when a row was removed.

**Why it is here.** Used when an engineer fully resets a decision rather than transitioning its status — the same as saying 'this was never reviewed'.

.. CG-EXPLANATION-END id=method:InvestigationReviewRepository.delete

Method ``InvestigationReviewRepository``. ``async def delete_for_target``
-------------------------------------------------------------------------

.. CG-BLOCK id=method:InvestigationReviewRepository.delete_for_target lines=216-237

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py
   :language: python
   :lines: 216-237
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvestigationReviewRepository.delete_for_target

**What this does.** Drops the review row (if any) for a polymorphic target, returning ``True`` when one was removed.

**Why it is here.** Deleting a CPT or borehole calls this so the matching review row goes with it. Because the review table has no database foreign key to the investigation tables (its anchor is polymorphic), nothing else would remove the row — without this call it would dangle and surface as an orphan in the bundle on the next Save.

.. CG-EXPLANATION-END id=method:InvestigationReviewRepository.delete_for_target

