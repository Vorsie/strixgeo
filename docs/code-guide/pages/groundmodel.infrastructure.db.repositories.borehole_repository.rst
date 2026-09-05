groundmodel.infrastructure.db.repositories.borehole_repository
==============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/borehole_repository.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/borehole_repository.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Iterable`` and ``UUID`` types, ``select`` / ``AsyncSession`` / ``selectinload``, ``set_committed_value`` (a way to set a relationship without marking it dirty), the elevation rollback service, the vertical-CRS default, the borehole and observation ORM models, the shared lab-test-family registry, and the logging base class. It re-exports the lab-test relationship names.

**Why it is here.** The lab-test family names come from the shared registry so this file and the bundle code can never disagree on the list. ``set_committed_value`` is imported for the trick further down that avoids a failing lazy load under async.

.. CG-EXPLANATION-END id=module-header

Function ``def borehole_full_tree_options``
-------------------------------------------

.. CG-BLOCK id=function:borehole_full_tree_options lines=36-82

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 36-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:borehole_full_tree_options

**What this does.** Builds the list of eager-load options for a borehole's whole detail tree — drill segments, field-log intervals, observations with their layers and admixtures, and samples with the requested lab-test families. An optional ``include_set`` limits which lab families are loaded.

**Why it is here.** It is the single source of truth for the borehole eager-load chain, shared by the single-fetch, the batch fetch, project duplication, and the bundle build — previously four byte-identical copies, so adding a seventh lab family meant four edits. It uses ``selectinload`` (one extra query per collection) rather than a join, which keeps the parent row small and avoids a *Cartesian explosion* — the row-multiplying blow-up that a join across several one-to-many collections would cause.

.. CG-EXPLANATION-END id=function:borehole_full_tree_options

Class ``BoreholeRepository`` — header
-------------------------------------

.. CG-BLOCK id=class:BoreholeRepository lines=83-91

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 83-91
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoreholeRepository

**What this does.** Opens the ``BoreholeRepository`` class — the async read/write operations for borehole rows.

**Why it is here.** It mirrors the CPT repository: one session per request, batch-friendly de-dup, and no background queueing at this layer (the concurrency rationale is in the CPT repository's docstring).

.. CG-EXPLANATION-END id=class:BoreholeRepository

Method ``BoreholeRepository``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.__init__ lines=92-96

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 92-96
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.__init__

**What this does.** The set-up method: registers the logger and stores the open session.

**Why it is here.** Same one-session-per-request pattern as the CPT repository.

.. CG-EXPLANATION-END id=method:BoreholeRepository.__init__

Method ``BoreholeRepository``. ``def _validated_include_set``
-------------------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository._validated_include_set lines=97-128

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 97-128
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository._validated_include_set

**What this does.** A static helper (a function that belongs to the class but uses no instance data) that checks the caller's requested lab-test family names against the known set, returning the validated set or ``None`` for 'all', and raising ``ValueError`` on an unknown name.

**Why it is here.** It is a defensive guard: callers are expected to validate their input already, but a hard error here beats silently loading the wrong families.

.. CG-EXPLANATION-END id=method:BoreholeRepository._validated_include_set

Method ``BoreholeRepository``. ``def _stamp_excluded_families``
---------------------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository._stamp_excluded_families lines=129-157

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 129-157
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository._stamp_excluded_families

**What this does.** For every family that was NOT loaded, writes an empty list onto each sample using ``set_committed_value``.

**Why it is here.** This is the fix for a real async trap. When a response is built, Pydantic (the library that turns rows into JSON) walks each attribute; if it touches an un-loaded relationship it triggers a lazy database load, which under async SQLAlchemy fails with ``MissingGreenlet`` because there is no async context in that attribute walk (the CLAUDE.md async-ORM rule). Writing an explicit empty list up front means Pydantic sees ``[]`` and never reaches for the database. ``set_committed_value`` writes it without marking the relationship changed, so no spurious update fires on the next flush.

.. CG-EXPLANATION-END id=method:BoreholeRepository._stamp_excluded_families

Method ``BoreholeRepository``. ``async def save``
-------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.save lines=158-181

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 158-181
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.save

**What this does.** Adds a borehole (and its cascade of children) to the session and, by default, flushes so its id round-trips. Logs the id at SUCCESS and the name at DEBUG.

**Why it is here.** Same flush-and-privacy discipline as the CPT save: bulk callers pass ``flush=False`` and commit once, and the site-code-carrying name is kept off the always-on log line.

.. CG-EXPLANATION-END id=method:BoreholeRepository.save

Method ``BoreholeRepository``. ``async def get_by_id``
------------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.get_by_id lines=182-256

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 182-256
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.get_by_id

**What this does.** Fetches one borehole with its entire child tree loaded, or ``None``. It can be told which lab-test families to load (the rest are stamped empty) and which project it must belong to.

**Why it is here.** It loads the whole tree with ``selectinload``, so a fully-populated borehole costs a constant twelve queries regardless of how many samples it has — each child query passes all the parent ids in one ``IN (...)`` list. The optional project id is the *IDOR scope guard* (a defence against reading another project's data by guessing an id): it is fused straight into the fetch's WHERE clause, so a foreign id returns ``None`` (a 404 at the router) without paying for a second query.

.. CG-EXPLANATION-END id=method:BoreholeRepository.get_by_id

Method ``BoreholeRepository``. ``async def get_many``
-----------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.get_many lines=257-322

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 257-322
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.get_many

**What this does.** The batch version: fetches many borehole detail trees in one query, with the same family-selection and project-scope options.

**Why it is here.** It folds N per-borehole fetches on section-open into one query (debt #39): ``selectinload`` then issues one batched child query per relationship for all N parents, so the total is constant in N rather than twelve per borehole. Results are matched by id, not position, and unknown ids drop silently.

.. CG-EXPLANATION-END id=method:BoreholeRepository.get_many

Method ``BoreholeRepository``. ``async def list_all``
-----------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.list_all lines=323-336

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 323-336
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.list_all

**What this does.** Returns every borehole (optionally only one project's), ordered by creation time, without loading children.

**Why it is here.** List views need only the header columns; the project filter is the scope guard.

.. CG-EXPLANATION-END id=method:BoreholeRepository.list_all

Method ``BoreholeRepository``. ``async def find_by_project_test``
-----------------------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.find_by_project_test lines=337-361

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 337-361
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.find_by_project_test

**What this does.** Finds the first borehole matching a source record's project-and-test id pair, always within one project scope.

**Why it is here.** The same de-dup lookup and the same strict scoping as the CPT version (audit C2b): a DOV record's ids are public, so an unscoped match could let an import overwrite a borehole in a different project.

.. CG-EXPLANATION-END id=method:BoreholeRepository.find_by_project_test

Method ``BoreholeRepository``. ``async def find_existing_test_ids``
-------------------------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.find_existing_test_ids lines=362-388

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 362-388
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.find_existing_test_ids

**What this does.** The batch de-dup lookup: many test ids in, a map of the already-imported ones to their ids out, in one query.

**Why it is here.** A 500-borehole map import checks duplicates in one round-trip, with the same cross-project safety by construction.

.. CG-EXPLANATION-END id=method:BoreholeRepository.find_existing_test_ids

Method ``BoreholeRepository``. ``async def delete``
---------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.delete lines=389-396

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 389-396
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.delete

**What this does.** Deletes a borehole by id; the whole child tree goes with it through the cascade.

**Why it is here.** Fetching first makes a delete of an unknown id a harmless no-op.

.. CG-EXPLANATION-END id=method:BoreholeRepository.delete

Method ``BoreholeRepository``. ``async def set_elevation``
----------------------------------------------------------

.. CG-BLOCK id=method:BoreholeRepository.set_elevation lines=397-444

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/borehole_repository.py
   :language: python
   :lines: 397-444
   :lineno-match:

.. CG-EXPLANATION-START id=method:BoreholeRepository.set_elevation

**What this does.** Updates a borehole's hand-entered surface elevation through the shared rollback service, loading only the header columns (not the heavy child tree) and returning the updated row.

**Why it is here.** Exactly the CPT contract, sharing the same pure ``resolve_elevation_change`` so the two cannot drift: ``MANUAL`` outranks the imported value, the first override snapshots the original, and a clear restores it (debt #21). Only the header columns are loaded because the patch response needs nothing more.

.. CG-EXPLANATION-END id=method:BoreholeRepository.set_elevation

