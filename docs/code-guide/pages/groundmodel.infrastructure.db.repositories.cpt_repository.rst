groundmodel.infrastructure.db.repositories.cpt_repository
=========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/cpt_repository.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/cpt_repository.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``UUID``, ``select``, ``AsyncSession``, ``selectinload`` (the eager-loading helper), the two pure rollback services (for elevation and water table), the vertical-CRS default lookup, the ``CptOrm`` model, and the logging base class.

**Why it is here.** The rollback services are imported so the same pure decision code decides how an elevation or water-table edit is applied for a CPT and for a borehole, and the two can never drift apart. ``selectinload`` is imported because a CPT is almost always fetched together with its depth-series.

.. CG-EXPLANATION-END id=module-header

Class ``CptRepository`` — header
--------------------------------

.. CG-BLOCK id=class:CptRepository lines=22-40

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 22-40
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptRepository

**What this does.** Opens the ``CptRepository`` class — the async read/write operations for CPT rows. It inherits the logging base class, and the docstring explains how concurrent access is handled without a message broker.

**Why it is here.** The docstring records the design decision: two requests never block each other because each gets its own connection from a pool, and PostgreSQL's own concurrency control (it keeps multiple versions of a row so reads never block writes) serialises any conflicting writes. A background queue belongs at the application layer, not here — the repository stays one session, one unit of work.

.. CG-EXPLANATION-END id=class:CptRepository

Method ``CptRepository``. ``def __init__``
------------------------------------------

.. CG-BLOCK id=method:CptRepository.__init__ lines=41-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 41-45
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.__init__

**What this does.** The set-up method: it registers the logger and stores the open database session.

**Why it is here.** Every operation on the repository uses that one session, which is the single unit of work for the request that created it.

.. CG-EXPLANATION-END id=method:CptRepository.__init__

Method ``CptRepository``. ``async def save``
--------------------------------------------

.. CG-BLOCK id=method:CptRepository.save lines=46-65

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 46-65
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.save

**What this does.** Adds a CPT (and its series, which rides along) to the session, and — unless the caller asks otherwise — *flushes* it, meaning it sends the insert to the database so the row's id is real. It logs the id at SUCCESS and the name only at DEBUG.

**Why it is here.** A *flush* is one network round-trip. Bulk callers pass ``flush=False`` and commit once at the end, because flushing per row would cost one round-trip per CPT (200 rows, 200 trips). The name is kept off the always-on log line because a CPT's name carries the client's project or site code — sensitive text that must not sit in the unredacted log.

.. CG-EXPLANATION-END id=method:CptRepository.save

Method ``CptRepository``. ``async def get_by_id``
-------------------------------------------------

.. CG-BLOCK id=method:CptRepository.get_by_id lines=66-72

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 66-72
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.get_by_id

**What this does.** Fetches one CPT by its id with its depth-series eager-loaded, returning it or ``None`` when the id is unknown.

**Why it is here.** *Eager-loading* with ``selectinload`` means the series is fetched in the same operation rather than lazily on first access — which matters under async, where a late lazy load would fail. Callers that show a CPT almost always need its series, so it is loaded up front.

.. CG-EXPLANATION-END id=method:CptRepository.get_by_id

Method ``CptRepository``. ``async def get_many_with_series``
------------------------------------------------------------

.. CG-BLOCK id=method:CptRepository.get_many_with_series lines=73-104

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 73-104
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.get_many_with_series

**What this does.** Fetches many CPTs with their series in a single query. It returns an empty list at once for an empty request, and — when a project id is given — restricts the results to that project.

**Why it is here.** It folds N per-CPT round-trips into one query for the batch-plot endpoint. The optional ``app_project_id`` is the *project-scope guard*: without it, someone in project A who guessed a CPT id from project B could read that foreign CPT's data. The docstring says to always pass it from an API surface; the ``None`` default is only for tests and admin tools.

.. CG-EXPLANATION-END id=method:CptRepository.get_many_with_series

Method ``CptRepository``. ``async def list_all``
------------------------------------------------

.. CG-BLOCK id=method:CptRepository.list_all lines=105-119

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 105-119
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.list_all

**What this does.** Returns every CPT (optionally only those in a given project), ordered by creation time, without loading the heavy series arrays.

**Why it is here.** List views need only the header columns, so skipping the series keeps the query light. The project filter is again the scope guard.

.. CG-EXPLANATION-END id=method:CptRepository.list_all

Method ``CptRepository``. ``async def find_by_project_test``
------------------------------------------------------------

.. CG-BLOCK id=method:CptRepository.find_by_project_test lines=120-142

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 120-142
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.find_by_project_test

**What this does.** Finds the first CPT matching a source file's project-and-test id pair, always within one project scope.

**Why it is here.** This is the de-duplication lookup on import. It is *always* scoped to a project (or to the null-project scope when none is given), never 'any project', because a GEF file's project and test ids are public to anyone holding the file — an unscoped match would let a confirmed re-import overwrite a CPT belonging to a different project (audit finding C2). The same file can still be imported into different projects because each import sees only its own project's rows.

.. CG-EXPLANATION-END id=method:CptRepository.find_by_project_test

Method ``CptRepository``. ``async def find_existing_test_ids``
--------------------------------------------------------------

.. CG-BLOCK id=method:CptRepository.find_existing_test_ids lines=143-168

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 143-168
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.find_existing_test_ids

**What this does.** The batch version of the previous method: given many test ids, it returns a map of those already imported to their existing CPT ids, in one query.

**Why it is here.** A bulk import (a map-area DOV import) checks 200 duplicates in one round-trip instead of 200. It carries the same strict project scoping, closing the same cross-project leak by construction.

.. CG-EXPLANATION-END id=method:CptRepository.find_existing_test_ids

Method ``CptRepository``. ``async def delete``
----------------------------------------------

.. CG-BLOCK id=method:CptRepository.delete lines=169-176

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 169-176
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.delete

**What this does.** Deletes a CPT by id; its series row goes with it through the database cascade.

**Why it is here.** A *cascade* is a database rule that deletes the children when the parent goes, so the series never outlives its CPT. Fetching first means a delete of an unknown id is simply a no-op.

.. CG-EXPLANATION-END id=method:CptRepository.delete

Method ``CptRepository``. ``async def set_elevation``
-----------------------------------------------------

.. CG-BLOCK id=method:CptRepository.set_elevation lines=177-225

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 177-225
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.set_elevation

**What this does.** Updates a CPT's hand-entered surface elevation. When no vertical-datum code is given it fills in the canonical one for the CPT's horizontal system (31370 gives mTAW in Belgium, 28992 gives NAP in the Netherlands), applies the change through the shared pure rollback service, saves, and returns the updated row.

**Why it is here.** Setting a value stamps it ``MANUAL``, which a re-import must never overwrite (the surveyed value outranks the automatic one). The first manual override snapshots the original imported elevation, so a later *clear* restores the surveyed value rather than blanking the row (debt #21). The snapshot-and-restore decision lives in one shared pure service so a CPT and a borehole handle it identically.

.. CG-EXPLANATION-END id=method:CptRepository.set_elevation

Method ``CptRepository``. ``async def set_water_table``
-------------------------------------------------------

.. CG-BLOCK id=method:CptRepository.set_water_table lines=226-280

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cpt_repository.py
   :language: python
   :lines: 226-280
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRepository.set_water_table

**What this does.** The exact counterpart for the water-table depth: set or clear it, applying the change through the shared water-table rollback service, then save and return the row.

**Why it is here.** Setting a value stamps it ``ENGINEER``, which outranks the file on a re-import — important because the whole Ic profile is normalised against the water table. The first override snapshots the file's value so a clear restores it; with no snapshot, clearing returns the row to 'nothing recorded', and every consumer then falls back to the default depth, labelled as assumed (Data-Integrity rule 1).

.. CG-EXPLANATION-END id=method:CptRepository.set_water_table

