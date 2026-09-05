groundmodel.infrastructure.db.repositories.project_bundle.bundle_collections
============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus a small toolbox (``Iterable`` / ``Mapping``, ``UUID``, ``uuid7``).

**Why it is here.** The docstring records why the module exists: several copy paths used to list the project's child tables by hand, and a Save-As once cloned only the CPTs and boreholes and left the whole three-level interpretation behind while reporting success. This module turns the build's single enumeration into the one registry every copy path reads.

.. CG-EXPLANATION-END id=module-header

Class ``BundleRegistryError``
-----------------------------

.. CG-BLOCK id=class:BundleRegistryError lines=45-57

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 45-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:BundleRegistryError

**What this does.** Defines ``BundleRegistryError`` (a ``RuntimeError``), raised when the bundle's actual shape and this registry disagree.

**Why it is here.** It is a programming error, not a data error — it means a collection was added to the build without being registered here. It is raised rather than logged because a copy path driven from a stale registry silently loses the new collection, which is the exact failure this module exists to prevent.

.. CG-EXPLANATION-END id=class:BundleRegistryError

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=58-91

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 58-91
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Defines the registry constants: ``BUNDLE_SCALAR_KEYS`` (the format stamp and the project row), ``BUNDLE_COLLECTION_KEYS`` (every child collection a bundle carries), and ``BUNDLE_RESTORE_KWARGS`` (the keyword each collection travels under into the restore), derived from the key list rather than typed out twice.

**Why it is here.** This tuple is the single source of truth for 'what a bundle carries'. Its order is informational only — the restore sequences the inserts itself — so a new key can go wherever it reads best; what matters is that it is present at all, because the build refuses to emit a bundle carrying a collection this tuple does not name.

.. CG-EXPLANATION-END id=module-statements

Function ``def assert_bundle_keys_registered``
----------------------------------------------

.. CG-BLOCK id=function:assert_bundle_keys_registered lines=92-120

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 92-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:assert_bundle_keys_registered

**What this does.** Checks a freshly built bundle against the registry, raising ``BundleRegistryError`` when the bundle carries an unregistered key or is missing a registered one.

**Why it is here.** The build calls it on every save, so adding a collection to the bundle without registering it fails loudly at save time instead of being quietly dropped by every copy path.

.. CG-EXPLANATION-END id=function:assert_bundle_keys_registered

Function ``def _as_uuid_str``
-----------------------------

.. CG-BLOCK id=function:_as_uuid_str lines=121-142

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 121-142
   :lineno-match:

.. CG-EXPLANATION-START id=function:_as_uuid_str

**What this does.** Returns a value as a canonical (lower-case) UUID string, or ``None`` when it is not one.

**Why it is here.** The id remapping keys everything on the canonical form, so this normaliser is what stops an upper-case id from slipping through unmatched.

.. CG-EXPLANATION-END id=function:_as_uuid_str

Function ``def collect_row_ids``
--------------------------------

.. CG-BLOCK id=function:collect_row_ids lines=143-177

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 143-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:collect_row_ids

**What this does.** Walks a bundle fragment to any depth and collects the id of every row dict it finds — a dict counts as a row when its ``id`` parses as a UUID.

**Why it is here.** It gathers every id — a borehole's nested child tree, a model's nested contacts and layers — without naming any collection here, which is what lets the clone re-key the whole document generically. Non-row JSON blobs (vertex arrays, view-state) have no UUID id, so they are skipped.

.. CG-EXPLANATION-END id=function:collect_row_ids

Function ``def build_clone_id_map``
-----------------------------------

.. CG-BLOCK id=function:build_clone_id_map lines=178-211

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 178-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_clone_id_map

**What this does.** Builds a map from every id in a bundle to a fresh id, for cloning the project onto a new project id.

**Why it is here.** The source rows stay where they are, so the copy needs its own primary keys; this map is what keeps every reference between the copied rows pointing inside the copy rather than back at the original.

.. CG-EXPLANATION-END id=function:build_clone_id_map

Function ``def remap_ids``
--------------------------

.. CG-BLOCK id=function:remap_ids lines=212-252

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 212-252
   :lineno-match:

.. CG-EXPLANATION-START id=function:remap_ids

**What this does.** Returns a deep copy of a bundle fragment with every mapped id replaced — in dict values, dict keys, and list elements alike. Unmapped strings pass through untouched.

**Why it is here.** Replacing *by value across the whole document* carries a reference wherever it lives — a plain foreign key, a UUID array, or a JSON map keyed by formation id (the lumping map). Leaving unmapped strings alone is exactly right for a reference that points outside the project. It matches on the canonical UUID form, because an upper-case id that slipped through unmapped would leave the clone sharing the source's primary key, and the insert-if-absent restore would then silently merge the 'copy' into the original.

.. CG-EXPLANATION-END id=function:remap_ids

Function ``def _remap_str``
---------------------------

.. CG-BLOCK id=function:_remap_str lines=253-271

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 253-271
   :lineno-match:

.. CG-EXPLANATION-START id=function:_remap_str

**What this does.** Returns the mapped id for one string, matching on its canonical UUID form, or the string unchanged.

**Why it is here.** The per-string worker the remap uses; canonicalising here is what keeps the match consistent with how the map was keyed.

.. CG-EXPLANATION-END id=function:_remap_str

Function ``def count_rows_per_collection``
------------------------------------------

.. CG-BLOCK id=function:count_rows_per_collection lines=272-293

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 272-293
   :lineno-match:

.. CG-EXPLANATION-START id=function:count_rows_per_collection

**What this does.** Counts every row a bundle carries, at any depth, per registered collection.

**Why it is here.** It is the completeness check the clone verifies against — counting at depth is what makes it catch a copy that kept the boreholes but dropped their samples.

.. CG-EXPLANATION-END id=function:count_rows_per_collection

Function ``def fingerprint_cpt_series``
---------------------------------------

.. CG-BLOCK id=function:fingerprint_cpt_series lines=294-328

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 294-328
   :lineno-match:

.. CG-EXPLANATION-START id=function:fingerprint_cpt_series

**What this does.** Returns each CPT's depth-series sample count (or ``None`` when it has no series row).

**Why it is here.** The row counter is blind to the CPT series, because that table has no ``id`` column — its key is the CPT id — so the largest payload a CPT carries would contribute nothing to the counts. This closes that blind spot so a copy that kept every CPT but dropped every series cannot pass the completeness check.

.. CG-EXPLANATION-END id=function:fingerprint_cpt_series

Function ``def sort_models_parents_first``
------------------------------------------

.. CG-BLOCK id=function:sort_models_parents_first lines=329-370

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py
   :language: python
   :lines: 329-370
   :lineno-match:

.. CG-EXPLANATION-START id=function:sort_models_parents_first

**What this does.** Orders geological-model payloads so a parent always comes before its children, treating a model whose parent is outside the payload as a root.

**Why it is here.** The model parent link is a self-referential foreign key with no ORM relationship behind it, so SQLAlchemy inserts the rows in the order they were added and cannot reorder them itself — a litho model queued before its geological parent would fail the foreign key on flush. Sorting by depth in the parent chain removes the dependence on whatever order the rows came back in.

.. CG-EXPLANATION-END id=function:sort_models_parents_first

