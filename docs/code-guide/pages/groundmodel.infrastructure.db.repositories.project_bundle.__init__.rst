groundmodel.infrastructure.db.repositories.project_bundle
=========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-194

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py
   :language: python
   :lines: 1-194
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long package docstring, then a large block of ``from .submodule import ...`` lines that pull every build / restore / serialisation helper up into this one package, and an ``__all__`` that re-exports them all under their historic import paths.

**Why it is here.** This package is the whole two-way trip between the database tree and the ``.gmproj`` JSON file. The re-export block is a *facade*: the code was split into many sub-modules, but every existing caller and test still imports from this one package, so the split stays invisible. The docstring names the two endpoints it backs — the bundle GET (File → Save) and the restore POST (open a file whose rows the database has lost) — and states the round-trip is *idempotent*, meaning re-restoring a bundle whose rows already exist returns them as-is rather than failing or duplicating.

.. CG-EXPLANATION-END id=module-header

Class ``ProjectBundleService`` — header
---------------------------------------

.. CG-BLOCK id=class:ProjectBundleService lines=195-211

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py
   :language: python
   :lines: 195-211
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectBundleService

**What this does.** Opens the ``ProjectBundleService`` class, which wraps the build and restore as two methods on a logging-enabled service.

**Why it is here.** Wrapping the module-level implementation functions in a class gives the round-trip the typed logging surface the project convention wants (logging via inheritance), while the implementation bodies stay unchanged — the service simply passes itself in as the logger.

.. CG-EXPLANATION-END id=class:ProjectBundleService

Method ``ProjectBundleService``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:ProjectBundleService.__init__ lines=212-215

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py
   :language: python
   :lines: 212-215
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectBundleService.__init__

**What this does.** The set-up method: registers the logger and stores the session.

**Why it is here.** The service is cheap to build, so a per-request instance in the router is fine.

.. CG-EXPLANATION-END id=method:ProjectBundleService.__init__

Method ``ProjectBundleService``. ``async def build``
----------------------------------------------------

.. CG-BLOCK id=method:ProjectBundleService.build lines=216-241

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py
   :language: python
   :lines: 216-241
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectBundleService.build

**What this does.** Serialises the full project tree to a JSON-friendly dict, optionally omitting the cached 3-D meshes.

**Why it is here.** It delegates to the build implementation, passing itself as the logger. File → Save passes ``include_solids=False`` because the file never stores the meshes, so fetching them would be wasted work.

.. CG-EXPLANATION-END id=method:ProjectBundleService.build

Method ``ProjectBundleService``. ``async def restore``
------------------------------------------------------

.. CG-BLOCK id=method:ProjectBundleService.restore lines=242-361

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py
   :language: python
   :lines: 242-361
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectBundleService.restore

**What this does.** Materialises the whole project tree from a bundle: it takes the project metadata plus each child collection as its own argument, and delegates to the restore implementation. The newest collections are passed by keyword rather than position.

**Why it is here.** The positional block of arguments is deliberately frozen — a comment records that a mid-list insertion once shifted three payloads into the wrong restorers — so everything added since travels by name. The ``replace`` flag chooses between the idempotent open-from-file insert and the destructive revert-to-last-save wipe-then-insert.

.. CG-EXPLANATION-END id=method:ProjectBundleService.restore

Function ``async def build_project_bundle``
-------------------------------------------

.. CG-BLOCK id=function:build_project_bundle lines=362-384

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py
   :language: python
   :lines: 362-384
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_project_bundle

**What this does.** A module-level wrapper that builds a ``ProjectBundleService`` and calls its build.

**Why it is here.** Backwards compatibility: existing callers (the project router) still call this free function, so the class-ification stayed a pure addition.

.. CG-EXPLANATION-END id=function:build_project_bundle

Function ``async def restore_project_bundle``
---------------------------------------------

.. CG-BLOCK id=function:restore_project_bundle lines=385-487

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py
   :language: python
   :lines: 385-487
   :lineno-match:

.. CG-EXPLANATION-START id=function:restore_project_bundle

**What this does.** The matching module-level wrapper for restore.

**Why it is here.** The same backwards-compatibility reason — the router's existing call site keeps working unchanged.

.. CG-EXPLANATION-END id=function:restore_project_bundle

