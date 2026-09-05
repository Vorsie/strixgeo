groundmodel.application.litho_solid_persistence
===============================================

.. CG-PAGE source=src/groundmodel/application/litho_solid_persistence.py complete=true

*Source file:* ``src/groundmodel/application/litho_solid_persistence.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the solid-persistence file. It imports the mesh value object and the solid row, and its docstring lists what the module carries: the outcome summary, the storage-id helper, and the persistence mixin.

**Why it is here.** The voxel builder writes watertight body meshes into the solid cache table with upsert (insert-or-update), orphan-delete and model-level checksum semantics; these helpers were promoted to a shared mixin when the voxel builder became a second caller of the identical upsert path, keeping the persistence contract separable from the build logic (extract on the second copy).

.. CG-EXPLANATION-END id=module-header

Function ``def _upsert_update_columns``
---------------------------------------

.. CG-BLOCK id=function:_upsert_update_columns lines=53-80

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 53-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:_upsert_update_columns

**What this does.** Returns the columns an insert-or-update should refresh on a conflict — every column except the identity ones (the primary key and the two that form the conflict target).

**Why it is here.** It is derived from the row's own keys, not hand-listed, because a column missing from the update set is silently never written on the conflict path — and the conflict path is every rebuild. The docstring records two real bugs from hand-listing: a missing update timestamp kept the first-build time, and a missing generation link left every rebuilt mesh pointing at no generation — neither visible to any test.

.. CG-EXPLANATION-END id=function:_upsert_update_columns

Class ``_SolidMeta``
--------------------

.. CG-BLOCK id=class:_SolidMeta lines=81-105

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 81-105
   :lineno-match:

.. CG-EXPLANATION-START id=class:_SolidMeta

**What this does.** A frozen dataclass carrying only the three cache-validity columns: the body id, the model-level checksum, and whether the row is stale.

**Why it is here.** The cache-skip and orphan-sweep paths read only these, so projecting them avoids deserialising the huge vertex and triangle blobs (millions of vertices on a real project) just to read a checksum.

.. CG-EXPLANATION-END id=class:_SolidMeta

Class ``LithoSolidsOutcome``
----------------------------

.. CG-BLOCK id=class:LithoSolidsOutcome lines=106-168

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 106-168
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoSolidsOutcome

**What this does.** A frozen dataclass summarising one build: how many bodies were considered, built, skipped by checksum, flagged, and orphan-deleted, plus lists of dropped and uncovered investigations, an empty reason, and the gapless report.

**Why it is here.** The docstring records why several fields exist: uncovered investigations are carried out because a server-side warning is invisible in a packaged build, so the engineer must be told which of his investigations fell outside the footprint; the empty reason exists because a degenerate build erases every stored solid yet its counts look identical to a happy build of zero bodies, so the client needs to know the model was just erased. The gapless report is a plain dict, not the API schema, because the application layer must not import API schemas.

.. CG-EXPLANATION-END id=class:LithoSolidsOutcome

Function ``def storage_body_id``
--------------------------------

.. CG-BLOCK id=function:storage_body_id lines=169-195

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 169-195
   :lineno-match:

.. CG-EXPLANATION-START id=function:storage_body_id

**What this does.** Maps a mesh body id to the UUID stored on the solid row — a real UUID passes through, a synthetic builder token is turned into a stable derived UUID.

**Why it is here.** The stored body id is deliberately not a foreign key, so a synthetic token (a strat or lens or minority id that has no row in the body table) can be given a deterministic derived UUID that stays stable across rebuilds without churning the cache.

.. CG-EXPLANATION-END id=function:storage_body_id

Class ``LithoSolidPersistenceMixin`` — header
---------------------------------------------

.. CG-BLOCK id=class:LithoSolidPersistenceMixin lines=196-226

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 196-226
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoSolidPersistenceMixin

**What this does.** A mixin (a class of shared methods meant to be combined into another) providing the upsert, load-existing, checksum-compare, orphan-delete and mesh-row helpers, parameterised by the method token the concrete use case sets. It defines the upsert chunk size.

**Why it is here.** It is mixed into a use case that owns the session and commits nothing itself. The chunk size keeps each insert statement a single round-trip while bounding the database's per-statement memory, because each row carries large JSON vertex and triangle blobs.

.. CG-EXPLANATION-END id=class:LithoSolidPersistenceMixin

Method ``LithoSolidPersistenceMixin``. ``def _mesh_rows``
---------------------------------------------------------

.. CG-BLOCK id=method:LithoSolidPersistenceMixin._mesh_rows lines=227-272

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 227-272
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoSolidPersistenceMixin._mesh_rows

**What this does.** Converts a list of body meshes into upsert-row dicts, stamping the model, the storage body id, the method, the geometry, an informational vertex count, the checksum, and the flags.

**Why it is here.** It asserts the concrete use case set its method token so a subclass that forgets cannot silently write a wrong method. The vertex arrays are passed as-is because the JSON binder serialises tuples and lists identically, eliminating a per-vertex conversion that dominated the real-data build profile; the per-row count is informational only, since cache validity is decided by the model-level checksum alone.

.. CG-EXPLANATION-END id=method:LithoSolidPersistenceMixin._mesh_rows

Method ``LithoSolidPersistenceMixin``. ``async def _batch_upsert``
------------------------------------------------------------------

.. CG-BLOCK id=method:LithoSolidPersistenceMixin._batch_upsert lines=273-324

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 273-324
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoSolidPersistenceMixin._batch_upsert

**What this does.** Inserts the solid rows in chunks, each a single insert-or-update statement whose conflict clause applies each row's own proposed values and refreshes the derived columns plus the update timestamp.

**Why it is here.** Using the excluded-row values in the update is required for a multi-row upsert, or the last row's values would apply to every conflict. The primary key stays stable because the update clause does not include it, so a rebuild never churns ids and no pre-load of existing ids is needed. The timestamp is set explicitly because a Core-level conflict update bypasses the row's own on-update default.

.. CG-EXPLANATION-END id=method:LithoSolidPersistenceMixin._batch_upsert

Method ``LithoSolidPersistenceMixin``. ``async def _load_existing``
-------------------------------------------------------------------

.. CG-BLOCK id=method:LithoSolidPersistenceMixin._load_existing lines=325-375

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 325-375
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoSolidPersistenceMixin._load_existing

**What this does.** Loads the model's stored solid metadata keyed by body id, projecting only the three validity columns and loading every row for the model regardless of build method.

**Why it is here.** The column projection avoids deserialising millions of vertices just to compare a checksum. It loads every method deliberately: a model has one active builder at a time, so switching builders must sweep the previous builder's rows, and the read endpoint does not filter by method — a warning in the docstring says do not add a method filter here, because it would leave the other builder's rows orphaned and double-render.

.. CG-EXPLANATION-END id=method:LithoSolidPersistenceMixin._load_existing

Method ``LithoSolidPersistenceMixin``. ``def _digest_matches_all``
------------------------------------------------------------------

.. CG-BLOCK id=method:LithoSolidPersistenceMixin._digest_matches_all lines=376-406

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 376-406
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoSolidPersistenceMixin._digest_matches_all

**What this does.** Returns true only when every wanted body already has a fresh row carrying the new checksum.

**Why it is here.** The build digest is model-level, so the cache skip is all-or-nothing: a single stale, missing, or mismatched row forces a full rebuild.

.. CG-EXPLANATION-END id=method:LithoSolidPersistenceMixin._digest_matches_all

Method ``LithoSolidPersistenceMixin``. ``async def _delete_orphans``
--------------------------------------------------------------------

.. CG-BLOCK id=method:LithoSolidPersistenceMixin._delete_orphans lines=407-447

.. literalinclude:: ../../../src/groundmodel/application/litho_solid_persistence.py
   :language: python
   :lines: 407-447
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoSolidPersistenceMixin._delete_orphans

**What this does.** Deletes the stored rows whose body is no longer among the built bodies, returning the count.

**Why it is here.** It reads only the body-id keys, so the lightweight metadata carries everything it needs; deleting orphans keeps a shrunk or re-shaped model from rendering bodies that no longer exist.

.. CG-EXPLANATION-END id=method:LithoSolidPersistenceMixin._delete_orphans

