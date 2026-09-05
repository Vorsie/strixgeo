groundmodel.infrastructure.db.repositories.project_bundle.bundle_build
======================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_build.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_build.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-68

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_build.py
   :language: python
   :lines: 1-68
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus the toolbox — every ORM model the bundle serialises, the shared borehole eager-load options, the bundle format-version constant, the registry check, and the per-table serialisers.

**Why it is here.** This is the save side of the round-trip, backing the bundle endpoint the desktop calls on File → Save. The docstring records the integrity check born from a 2026-05-31 dogfeed: the export cross-references every formation id that contacts and layers point at, so a self-inconsistent bundle is caught at save time rather than corrupting a later restore.

.. CG-EXPLANATION-END id=module-header

Class ``BundleIntegrityError``
------------------------------

.. CG-BLOCK id=class:BundleIntegrityError lines=69-96

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_build.py
   :language: python
   :lines: 69-96
   :lineno-match:

.. CG-EXPLANATION-START id=class:BundleIntegrityError

**What this does.** Defines ``BundleIntegrityError`` (a kind of ``ValueError``), raised when a bundle would be internally inconsistent.

**Why it is here.** It catches the exact bug that wiped 833 accepted layers: an export missed the formations that contacts and layers referenced, so the file was self-inconsistent, and a later revert-to-last-save restored from it and dropped every dependent row as an orphan. Build refuses to write such a bundle, and the destructive replace-restore refuses to wipe good data for one. It inherits ``ValueError`` so the router's existing handler turns it into a clean 400, not a 500.

.. CG-EXPLANATION-END id=class:BundleIntegrityError

Function ``async def _build_project_bundle_impl``
-------------------------------------------------

.. CG-BLOCK id=function:_build_project_bundle_impl lines=97-427

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_build.py
   :language: python
   :lines: 97-427
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_project_bundle_impl

**What this does.** The single build entry point: it loads the project's whole tree — CPTs with series, boreholes with their full child trees, formations, models with nested contacts / surfaces / litho layers, sections, reviews, bodies, edges, facts, tombstones, separations, unions, boundary shapes and nodes, and (optionally) the cached solids — serialises each collection, stamps the format version, and checks the result against the collection registry before returning it as one JSON-friendly dict.

**Why it is here.** It is the authoritative enumeration of what a ``.strix`` bundle carries (docs/gmproj-format.md), and the registry check makes adding a collection without registering it fail loudly at save time rather than being silently dropped by every copy path. The ``include_solids=False`` option lets File → Save skip the megabyte-scale meshes the file never stores. The formation integrity pass runs here so a broken model surfaces to the engineer at save, not at some future restore.

.. CG-EXPLANATION-END id=function:_build_project_bundle_impl

