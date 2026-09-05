groundmodel.api.schemas.project.project_bundle
==============================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/project_bundle.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/project_bundle.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring describing the bundle round-trip and the typing decision, then imports the free-form/annotated types, the Pydantic tools, and the format-version constants re-exported from the shared floor. It also sets the size ceilings for the lumping sub-object.

**Why it is here.** The *bundle* is a project's complete state — metadata, every CPT with its series, every borehole with its child tree, and every per-project decision — saved to a ``.strix`` file and sent back to restore it. The docstring records the key decision: the child trees are typed as free-form dictionaries rather than mirrored Pydantic classes, because the database model is the single source of truth for column shapes and a typed mirror would drift and need manual updates for every new column; only the top-level shape and the format version are typed here, and the database validates the contents on restore. The round-trip is idempotent — re-restoring rows that already exist returns them rather than duplicating (the idempotency-on-ingest rule). The lumping ceilings exist because a crafted file is the threat model, and an unbounded map could allocate an enormous structure during validation.

.. CG-EXPLANATION-END id=module-header

Class ``StratigraphyLumping``
-----------------------------

.. CG-BLOCK id=class:StratigraphyLumping lines=71-115

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 71-115
   :lineno-match:

.. CG-EXPLANATION-START id=class:StratigraphyLumping

**What this does.** The snapshot of the manual lumping map last applied: a version number, the time it was applied, and the map from a normalised candidate key to a target formation name — all length-bounded.

**Why it is here.** It is stored in the bundle so the engineer's grouping is remembered and pre-fills the next dialog; it is metadata only and is NEVER re-applied on restore, because the formations and contacts already in the bundle ARE the applied result and re-applying would create duplicates. The length caps close the per-field size threat a list-length cap alone leaves open.

.. CG-EXPLANATION-END id=class:StratigraphyLumping

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=116-168

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 116-168
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Sets the per-array size ceilings for the restore body — maximum CPTs, boreholes, formations, models, sections, reviews, correlation edges, bodies, absences, boundary shapes and nodes, and cached solids — plus the per-item key/value length and nesting-depth caps and the seeded-contacts cap.

**Why it is here.** These defend against a malicious or corrupted ``.strix`` shipping an enormous array that exhausts memory during validation (debt #38). Each comment records that the ceiling sits far above any real project (a 500-CPT DOV import is the documented large reference), so none binds on legitimate data — they only cap the denial-of-service surface. The whole-request size middleware caps the raw bytes; these caps stop a payload that fits that budget but ships a billion-entry list.

.. CG-EXPLANATION-END id=module-statements

Function ``def _validate_bounded_value``
----------------------------------------

.. CG-BLOCK id=function:_validate_bounded_value lines=169-218

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 169-218
   :lineno-match:

.. CG-EXPLANATION-START id=function:_validate_bounded_value

**What this does.** Walks one bundle value recursively and enforces size limits: a maximum string length, a maximum number of dictionary keys plus a per-key length, a maximum list length, and a maximum nesting depth. Plain numbers are left alone.

**Why it is here.** This is the per-item denial-of-service guard for free-form nested values (such as a section's view-state bag) that the list-length caps cannot reach. The depth cap also stops a deeply-nested payload from exhausting the validator's recursion.

.. CG-EXPLANATION-END id=function:_validate_bounded_value

Function ``def _validate_bounded_dict_list``
--------------------------------------------

.. CG-BLOCK id=function:_validate_bounded_dict_list lines=219-242

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 219-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:_validate_bounded_dict_list

**What this does.** Runs the recursive size check above over each dictionary in a list and returns the list unchanged.

**Why it is here.** A small shared helper so the field validators below can bound a whole collection of item dictionaries in one call (the don't-repeat rule).

.. CG-EXPLANATION-END id=function:_validate_bounded_dict_list

Class ``ProjectBundleRequest`` — header
---------------------------------------

.. CG-BLOCK id=class:ProjectBundleRequest lines=243-379

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 243-379
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectBundleRequest

**What this does.** The restore body: a required format version, the project dictionary, and a long list of optional child collections (CPTs, boreholes, formations, models, sections, reviews, bodies, absences, correlation edges, connectivity facts, tie tombstones, separations, unions, boundary shapes and nodes, and solids), each length-capped, plus the optional lumping snapshot.

**Why it is here.** Every child field defaults to empty so restoring a project shell without children still works, and each is additive — a bundle saved before a field existed restores cleanly (backwards-compatible). The comments record the FK-respecting restore order for each collection and note that pre-ship renames (litho_lenses → bodies) are simply ignored on restore under the pre-ship amnesty. The format version is required and checked by the route, which rejects an old file with a clear "re-save from a current build" message (``400``).

.. CG-EXPLANATION-END id=class:ProjectBundleRequest

Method ``ProjectBundleRequest``. ``def _bound_boundary_item_dicts``
-------------------------------------------------------------------

.. CG-BLOCK id=method:ProjectBundleRequest._bound_boundary_item_dicts lines=380-402

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 380-402
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectBundleRequest._bound_boundary_item_dicts

**What this does.** A field check that runs the per-item size guard over the boundary-shape and boundary-node dictionaries.

**Why it is here.** The list-length cap limits how MANY items there are; this closes the per-ITEM surface so a crafted bundle cannot slip a single item with a gigabyte string past the byte-budget middleware.

.. CG-EXPLANATION-END id=method:ProjectBundleRequest._bound_boundary_item_dicts

Method ``ProjectBundleRequest``. ``def _bound_cross_section_collections``
-------------------------------------------------------------------------

.. CG-BLOCK id=method:ProjectBundleRequest._bound_cross_section_collections lines=403-452

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 403-452
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectBundleRequest._bound_cross_section_collections

**What this does.** A field check that bounds each cross-section's three id-exclusion arrays and its free-form view-state bag, leaving the free-text name and description untouched.

**Why it is here.** The section-count cap does not bound what is INSIDE each section, so a crafted file could fit the envelope yet ship one section with a ten-million-id array — this closes that gap on exactly the four collection fields, deliberately not policing free text.

.. CG-EXPLANATION-END id=method:ProjectBundleRequest._bound_cross_section_collections

Class ``ProjectBundleResponse``
-------------------------------

.. CG-BLOCK id=class:ProjectBundleResponse lines=453-491

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_bundle.py
   :language: python
   :lines: 453-491
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectBundleResponse

**What this does.** The shape returned when reading a bundle: the same fields as the request, defaulting the format version to the current one.

**Why it is here.** The response and request shapes are intentionally symmetric — the desktop persists the response verbatim and posts it straight back to restore, so any difference between the two shapes would break that round-trip (additive-only fields keep old files opening).

.. CG-EXPLANATION-END id=class:ProjectBundleResponse

