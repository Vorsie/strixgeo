groundmodel.infrastructure.db.repositories.project_repository
=============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_repository.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_repository.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``deepcopy``, ``UTC`` / ``datetime``, ``Any``, ``UUID``, ``select``, ``AsyncSession``, ``uuid7``, the project ORM model, the bundle clone helper, and the logging base.

**Why it is here.** It imports the bundle clone helper because a Save-As duplicates the whole project tree through the same machinery the ``.strix`` file uses. ``deepcopy`` is imported for the small JSON-copy helper below.

.. CG-EXPLANATION-END id=module-header

Function ``def _json_copy``
---------------------------

.. CG-BLOCK id=function:_json_copy lines=21-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 21-38
   :lineno-match:

.. CG-EXPLANATION-START id=function:_json_copy

**What this does.** A small helper that deep-copies a JSON column value, passing ``None`` through unchanged.

**Why it is here.** When a project is duplicated, its JSON columns (the view-state bag, the lumping snapshots) must be *structurally independent* copies — sharing the source's dict would let a later edit of one row bleed into the other through SQLAlchemy's in-memory identity map. ``None`` is preserved because for the lumping slots it is a meaningful state ('no map at all'), distinct from an empty object.

.. CG-EXPLANATION-END id=function:_json_copy

Class ``ProjectRepository`` — header
------------------------------------

.. CG-BLOCK id=class:ProjectRepository lines=39-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 39-47
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectRepository

**What this does.** Opens the ``ProjectRepository`` class — async CRUD for the top-level project row.

**Why it is here.** The same one-session-per-request shape as the other repositories, with tight soft-delete semantics (archive / unarchive just flip the archived-at timestamp).

.. CG-EXPLANATION-END id=class:ProjectRepository

Method ``ProjectRepository``. ``def __init__``
----------------------------------------------

.. CG-BLOCK id=method:ProjectRepository.__init__ lines=48-52

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 48-52
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectRepository.__init__

**What this does.** The set-up method: registers the logger and stores the open session.

**Why it is here.** The shared repository pattern.

.. CG-EXPLANATION-END id=method:ProjectRepository.__init__

Method ``ProjectRepository``. ``async def save``
------------------------------------------------

.. CG-BLOCK id=method:ProjectRepository.save lines=53-76

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 53-76
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectRepository.save

**What this does.** Adds a project to the session and, by default, flushes so a fresh row's id and database defaults are real. Logs the id at SUCCESS and the name at DEBUG.

**Why it is here.** The name is kept off the always-on log line because a project name is client-identifying, and the log file is unredacted on disk and can travel to support — the id answers 'which project' without leaking anything.

.. CG-EXPLANATION-END id=method:ProjectRepository.save

Method ``ProjectRepository``. ``async def get_by_id``
-----------------------------------------------------

.. CG-BLOCK id=method:ProjectRepository.get_by_id lines=77-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 77-85
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectRepository.get_by_id

**What this does.** Returns the project with the given id, or ``None`` — including archived projects.

**Why it is here.** Archived rows are returned too; the router decides whether to show them based on the request's status filter, so the repository stays a plain fetch.

.. CG-EXPLANATION-END id=method:ProjectRepository.get_by_id

Method ``ProjectRepository``. ``async def list_all``
----------------------------------------------------

.. CG-BLOCK id=method:ProjectRepository.list_all lines=86-102

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 86-102
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectRepository.list_all

**What this does.** Returns every project, most-recently-active first, hiding archived rows unless asked to include them.

**Why it is here.** The projects list keeps active work front-and-centre by default; an 'Archived' view passes the include flag.

.. CG-EXPLANATION-END id=method:ProjectRepository.list_all

Method ``ProjectRepository``. ``async def list_archived``
---------------------------------------------------------

.. CG-BLOCK id=method:ProjectRepository.list_archived lines=103-112

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 103-112
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectRepository.list_archived

**What this does.** Returns only archived projects, most-recently-archived first.

**Why it is here.** Backs the dedicated Archived view.

.. CG-EXPLANATION-END id=method:ProjectRepository.list_archived

Method ``ProjectRepository``. ``async def archive``
---------------------------------------------------

.. CG-BLOCK id=method:ProjectRepository.archive lines=113-129

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 113-129
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectRepository.archive

**What this does.** Soft-deletes a project by stamping its archived-at timestamp with a timezone-aware UTC value, returning ``None`` for an unknown id.

**Why it is here.** A *soft delete* removes the project from default listings without destroying the row or any child — matching the 'remove from view, never delete' rule. The timestamp is timezone-aware so it orders correctly against other timezone-aware writes.

.. CG-EXPLANATION-END id=method:ProjectRepository.archive

Method ``ProjectRepository``. ``async def unarchive``
-----------------------------------------------------

.. CG-BLOCK id=method:ProjectRepository.unarchive lines=130-139

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 130-139
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectRepository.unarchive

**What this does.** Restores a previously-archived project by clearing its archived-at timestamp.

**Why it is here.** The exact reverse of archive — the row was never gone, so bringing it back is a single field flip.

.. CG-EXPLANATION-END id=method:ProjectRepository.unarchive

Method ``ProjectRepository``. ``async def duplicate``
-----------------------------------------------------

.. CG-BLOCK id=method:ProjectRepository.duplicate lines=140-226

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_repository.py
   :language: python
   :lines: 140-226
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectRepository.duplicate

**What this does.** Deep-clones a project and everything under it (File → Save As). It creates a fresh project row with a new id, copies the metadata (and the two lumping snapshots and view-state by value), then hands the whole child tree to the bundle clone helper. It returns the new row for the caller to commit, or ``None`` when the source id is unknown, and raises if the copy came out short.

**Why it is here.** The copy is driven off the *same* bundle build-and-restore the ``.strix`` round-trip uses, so the engineer gets the entire project — not just the CPTs and boreholes but the formations, the three model levels with their contacts and litho layers, the sections, bodies, edges, reviews and cached solids. Lifecycle (status, archived-at) does not carry across — a copy starts active — but the lumping slots and view-state do, because the file would otherwise carry a map its fresh database did not (debt #267). The caller commits and re-runs the body resolver, exactly as an open-from-file does, because the restore drops ``body_id`` for the resolver to re-stamp.

.. CG-EXPLANATION-END id=method:ProjectRepository.duplicate

