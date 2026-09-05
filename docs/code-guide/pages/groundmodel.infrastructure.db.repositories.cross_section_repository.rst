groundmodel.infrastructure.db.repositories.cross_section_repository
===================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/cross_section_repository.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/cross_section_repository.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus the toolbox: ``Callable`` and ``Any`` types, ``UUID``, ``select`` and ``text`` (for a raw SQL fragment), ``AsyncSession``, ``uuid7``, the section / contact / model ORM classes, and the logging base class.

**Why it is here.** Sections are project-scoped but own no child tree, so a small focused repository is the right shape. ``text`` is imported for the one raw-SQL statement — an advisory lock — used below.

.. CG-EXPLANATION-END id=module-header

Class ``CrossSectionRepository`` — header
-----------------------------------------

.. CG-BLOCK id=class:CrossSectionRepository lines=29-31

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 29-31
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossSectionRepository

**What this does.** Opens the ``CrossSectionRepository`` class — async read/write for section rows.

**Why it is here.** A focused CRUD class, mirroring the project and borehole repositories.

.. CG-EXPLANATION-END id=class:CrossSectionRepository

Method ``CrossSectionRepository``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.__init__ lines=32-36

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 32-36
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.__init__

**What this does.** The set-up method: registers the logger and stores the open session.

**Why it is here.** One session per request, the shared repository pattern.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.__init__

Method ``CrossSectionRepository``. ``async def create``
-------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.create lines=37-91

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 37-91
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.create

**What this does.** Inserts a new section under a project from the given line endpoints and display settings, always starting with an empty seeded-contact set, then flushes and logs (id at SUCCESS, name at DEBUG).

**Why it is here.** A freshly-drawn section shows the investigations in its corridor and nothing else — formation content appears only after an explicit Seed or manual draw, which is the *explicit-content invariant* (owner directive). The section name commonly echoes a site code, so it is kept off the always-on log line.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.create

Method ``CrossSectionRepository``. ``async def list_all``
---------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.list_all lines=92-100

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 92-100
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.list_all

**What this does.** Returns every section for a project, ordered by display order then name.

**Why it is here.** The sidebar reads sections in this order; ties in display order break by name.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.list_all

Method ``CrossSectionRepository``. ``async def get``
----------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.get lines=101-104

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 101-104
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.get

**What this does.** Looks up one section by id, or ``None`` when it does not exist.

**Why it is here.** A section carries no child tree, so a plain fetch by primary key is all it needs.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.get

Method ``CrossSectionRepository``. ``async def update``
-------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.update lines=105-115

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 105-115
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.update

**What this does.** Applies a partial update — only the keys present in the patch are written — then flushes and returns the row (or ``None`` when the id is unknown).

**Why it is here.** A partial update lets the caller change one setting (say the vertical exaggeration) without resending the whole section, and without accidentally clearing fields it did not mention.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.update

Method ``CrossSectionRepository``. ``async def delete``
-------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.delete lines=116-125

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 116-125
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.delete

**What this does.** Deletes a section by id, returning ``True`` when a row was removed.

**Why it is here.** Fetching first makes deleting an unknown id a harmless no-op.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.delete

Method ``CrossSectionRepository``. ``async def union_seeded_contact_ids``
-------------------------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.union_seeded_contact_ids lines=126-217

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 126-217
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.union_seeded_contact_ids

**What this does.** Adds a set of contact ids into a section's seeded set, under a per-section lock. It first takes a PostgreSQL *advisory lock* keyed on the section id, re-reads the section, merges the new ids into the existing set, writes, commits, and refreshes. The whole thing is wrapped so any failure is rolled back and logged rather than raised.

**Why it is here.** This is the single write path that ADDS to a section's explicit-content set (owner directive 2026-05-17), shared by the manual-draw, dedup-survivor, Seed, and pinch-out paths. The advisory lock — a lightweight lock keyed on an integer, released automatically when the transaction ends — serialises two concurrent accepts on the same section, which would otherwise both read the same snapshot and have the second silently clobber the first (debt #208, the lost-update race). It is deliberately non-fatal: the caller's own operation has already committed, so a missing or foreign section here is swallowed and must never turn a success into a 500; the rollback leaves the pooled session clean for its next use.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.union_seeded_contact_ids

Method ``CrossSectionRepository``. ``async def _rewrite_sections``
------------------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository._rewrite_sections lines=218-254

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 218-254
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository._rewrite_sections

**What this does.** A private helper that walks every section in a project and rewrites its seeded set, keeping only the ids that pass a supplied test. It flushes but does not commit, and returns how many ids were removed in total.

**Why it is here.** It is the symmetric counterpart to the add path above — the single write path that REMOVES seeded ids. Because it only flushes, the removal happens inside the caller's own transaction, so the unseed is atomic with whatever row deletion prompted it.

.. CG-EXPLANATION-END id=method:CrossSectionRepository._rewrite_sections

Method ``CrossSectionRepository``. ``async def remove_seeded_contact_ids``
--------------------------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.remove_seeded_contact_ids lines=255-288

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 255-288
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.remove_seeded_contact_ids

**What this does.** Removes a specific set of contact ids from every section's seeded set (a no-op for an empty set), returning the count removed.

**Why it is here.** When a single contact is deleted it must no longer be seeded anywhere, or the section would try to show a contact that no longer exists — this closes that leak on the single-contact delete path.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.remove_seeded_contact_ids

Method ``CrossSectionRepository``. ``async def prune_orphan_seeded_ids``
------------------------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository.prune_orphan_seeded_ids lines=289-318

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 289-318
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository.prune_orphan_seeded_ids

**What this does.** Sweeps every section and drops any seeded id whose contact no longer exists in any model of the project, returning the count pruned.

**Why it is here.** It is the garbage-collection sweep for the clear-litho-model path: after a clear, historical suggest-accept-delete cycles may have left thousands of stale ids seeded, and this removes exactly the ones that no longer point at a live contact while keeping the ones that still do.

.. CG-EXPLANATION-END id=method:CrossSectionRepository.prune_orphan_seeded_ids

Method ``CrossSectionRepository``. ``async def _live_contact_ids``
------------------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionRepository._live_contact_ids lines=319-338

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/cross_section_repository.py
   :language: python
   :lines: 319-338
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionRepository._live_contact_ids

**What this does.** Returns the ids of every contact that still exists in any model of the project, by joining the contact table to its owning model and filtering to the project.

**Why it is here.** It is the 'what is legitimately seedable' set the prune sweep tests against — a *join* is a query that combines two tables on a matching column, here to keep only contacts whose model belongs to this project.

.. CG-EXPLANATION-END id=method:CrossSectionRepository._live_contact_ids

