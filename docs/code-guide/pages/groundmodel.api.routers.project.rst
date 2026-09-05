groundmodel.api.routers.project
===============================

.. CG-PAGE source=src/groundmodel/api/routers/project.py complete=true

*Source file:* ``src/groundmodel/api/routers/project.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-57

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 1-57
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file, then imports the FastAPI building blocks, the project bundle/create/duplicate/update/restore schemas and the bundle version constants, the body-partition lock and body-reconcile use cases, the project row, the bundle build/restore functions and their errors, the repository, the session, the logger, and a small timing helper. It makes the module logger and the ``/projects`` router.

**Why it is here.** This is the router for the whole project lifecycle: list, create, read, update, archive, and the save/restore/duplicate paths that back File-Save and File-Save-As. The bundle version constants gate which saved-file versions this build will accept.

.. CG-EXPLANATION-END id=module-header

Function ``async def list_projects``
------------------------------------

.. CG-BLOCK id=function:list_projects lines=58-83

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 58-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_projects

**What this does.** The handler for ``GET /projects/`` — list projects most-recent first, hiding archived ones unless asked to include them.

**Why it is here.** Hiding archived projects by default keeps active work front-and-centre in the desktop's project list.

.. CG-EXPLANATION-END id=function:list_projects

Function ``async def list_archived_projects``
---------------------------------------------

.. CG-BLOCK id=function:list_archived_projects lines=84-104

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 84-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_archived_projects

**What this does.** The handler for ``GET /projects/archived`` — list only archived projects, newest-archived first.

**Why it is here.** Backs the desktop's separate "Archived projects" view.

.. CG-EXPLANATION-END id=function:list_archived_projects

Function ``async def create_project``
-------------------------------------

.. CG-BLOCK id=function:create_project lines=105-156

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 105-156
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_project

**What this does.** The handler for ``POST /projects/`` — create a project from the supplied metadata, save it, and return it with server-side defaults filled in, answering ``201 Created``.

**Why it is here.** The generated id is the canonical project id the desktop writes into the saved file. The row is refreshed after commit so the database-filled fields (timestamps, default tags) are loaded before the response is built; the comment records that without the refresh, reading those fields would raise a ``MissingGreenlet`` error because loading them is async work the response builder cannot do.

.. CG-EXPLANATION-END id=function:create_project

Function ``async def get_project``
----------------------------------

.. CG-BLOCK id=function:get_project lines=157-187

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 157-187
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_project

**What this does.** The handler for ``GET /projects/{project_id}`` — return one project by id, or ``404`` if it does not exist.

**Why it is here.** The straightforward single-project read the desktop performs on open. Why: not recorded beyond that.

.. CG-EXPLANATION-END id=function:get_project

Function ``async def update_project``
-------------------------------------

.. CG-BLOCK id=function:update_project lines=188-250

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 188-250
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_project

**What this does.** The handler for ``PATCH /projects/{project_id}`` — apply a partial metadata update: only fields present in the body are written, and setting the mandatory name or status to empty is rejected with a ``400``.

**Why it is here.** Reading only the explicitly-sent fields (rather than the whole schema) is load-bearing: it stops an unsent field being overwritten with its default. Name and status cannot be cleared because the database requires them, so the endpoint rejects that rather than letting the database raise.

.. CG-EXPLANATION-END id=function:update_project

Function ``async def archive_project``
--------------------------------------

.. CG-BLOCK id=function:archive_project lines=251-284

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 251-284
   :lineno-match:

.. CG-EXPLANATION-START id=function:archive_project

**What this does.** The handler for ``POST /projects/{project_id}/archive`` — soft-delete a project: hide it from default listings while keeping all its data, then return it with the archive timestamp set.

**Why it is here.** A soft delete keeps the data recoverable; the archive timestamp is what the default listing filters on.

.. CG-EXPLANATION-END id=function:archive_project

Function ``async def unarchive_project``
----------------------------------------

.. CG-BLOCK id=function:unarchive_project lines=285-318

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 285-318
   :lineno-match:

.. CG-EXPLANATION-START id=function:unarchive_project

**What this does.** The handler for ``POST /projects/{project_id}/unarchive`` — restore an archived project to active by clearing its archive timestamp.

**Why it is here.** The reverse of archive; clearing the timestamp brings the project back into the default listing.

.. CG-EXPLANATION-END id=function:unarchive_project

Function ``async def get_project_bundle``
-----------------------------------------

.. CG-BLOCK id=function:get_project_bundle lines=319-399

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 319-399
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_project_bundle

**What this does.** The handler for ``GET /projects/{project_id}/bundle`` — return a complete snapshot of the project and every CPT and borehole, optionally omitting the cached 3-D meshes. It logs entry and outcome with counts and latency, and turns a self-inconsistent database into a ``422``.

**Why it is here.** This snapshot is embedded verbatim in the saved file and posted back to restore if the database ever loses the rows (the file is the anchor; the database is a cache). File-Save omits the 3-D meshes because the saved file never stores them and nothing reads them from the bundle, so shipping about 10 MB of vertices was pure waste. A self-inconsistent database (layers pointing at formations that no longer exist) is a ``422`` "your data is bad, here is what is wrong" rather than a ``500`` that would imply a server bug. Entry and outcome are logged because this runs on every save.

.. CG-EXPLANATION-END id=function:get_project_bundle

Function ``async def restore_project``
--------------------------------------

.. CG-BLOCK id=function:restore_project lines=400-592

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 400-592
   :lineno-match:

.. CG-EXPLANATION-START id=function:restore_project

**What this does.** The handler for ``POST /projects/{project_id}/restore`` — rebuild a project and its investigations and interpretation from a bundle, idempotently. It checks the bundle version, locks the body partitions, restores the rows, reconciles the bodies, and reports how many rows the size caps truncated. An optional replace mode wipes the children first so the result matches the bundle exactly.

**Why it is here.** This backs open-from-file when the database no longer has the rows the file points at. It always answers ``200`` because the caller's meaning is "ensure this exists" regardless of how many rows were inserted. An unsupported bundle version is refused loudly, because silently materialising a pre-decisions-in-bundle file would lose data the user assumes is intact. The body-partition lock is taken up front to avoid a deadlock against a concurrent recompute (the comment records this). The comment block explains a subtle domain rule: the restore runs only the body resolver, never body-extent detection, because extents are section-scoped and already ride in the bundle, and re-detecting with no active section would overwrite the user's committed extents (dogfeed 3 June 2026). A self-inconsistent bundle is ``422`` and the replace path refuses to wipe in that state, after a real incident where a wipe destroyed 833 layers.

.. CG-EXPLANATION-END id=function:restore_project

Function ``async def duplicate_project``
----------------------------------------

.. CG-BLOCK id=function:duplicate_project lines=593-675

.. literalinclude:: ../../../src/groundmodel/api/routers/project.py
   :language: python
   :lines: 593-675
   :lineno-match:

.. CG-EXPLANATION-START id=function:duplicate_project

**What this does.** The handler for ``POST /projects/{project_id}/duplicate`` — deep-clone a project (investigations and the whole interpretation) via the same bundle build-and-restore the saved-file round-trip uses, then reconcile the bodies. It refuses to commit a lossy copy.

**Why it is here.** This backs File-Save-As, and it clones the full tree (formations, all three model levels, cross-sections, bodies, correlations, reviews, cached solids), not just the raw investigations. If the copy came out with fewer rows than the source it is rolled back and answered ``500``, because the desktop adopts the duplicate the instant this returns, so a silent partial copy would become the session the engineer keeps working in. It runs the same body-resolver pass the restore runs, because the clone leaves body ids blank for the resolver to re-derive.

.. CG-EXPLANATION-END id=function:duplicate_project

