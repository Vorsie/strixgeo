groundmodel.infrastructure.db.repositories.project_bundle.bundle_restore_core
=============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-88

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 1-88
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring listing the core restore phases plus the toolbox — ``delete`` / ``select``, the ORM models, the integrity error, the drops tally, and every litho-specific restore phase pulled in from the sibling module. It re-exports the core phase functions.

**Why it is here.** This module holds the phases for the parts that come first (CPTs, boreholes, formations, sections, reviews) and the top-level orchestrator that calls every phase in order. Every helper operates inside the caller's transaction and none commits on its own, so the whole restore is one atomic unit.

.. CG-EXPLANATION-END id=module-header

Function ``async def _wipe_project_scoped_rows``
------------------------------------------------

.. CG-BLOCK id=function:_wipe_project_scoped_rows lines=89-149

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 89-149
   :lineno-match:

.. CG-EXPLANATION-START id=function:_wipe_project_scoped_rows

**What this does.** Deletes every project-scoped child collection while keeping the project shell, in a foreign-key-safe order (models by kind newest-first, then formations, then the independent roots), relying on the database's own cascade rules.

**Why it is here.** It backs revert-to-last-save (debt #160): after the wipe the idempotent insert re-materialises the bundle against an empty project, so a close-without-save undoes creations, edits AND deletes. The delete order is dictated by the foreign keys — a child model pins its parent (parent-protecting foreign key), so geotechnical models must go before lithostratigraphic before geological. Because it only deletes (no commit), the wipe and the following insert land in the caller's single commit, so the revert is all-or-nothing.

.. CG-EXPLANATION-END id=function:_wipe_project_scoped_rows

Function ``async def _restore_cpts``
------------------------------------

.. CG-BLOCK id=function:_restore_cpts lines=150-219

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 150-219
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_cpts

**What this does.** Inserts the bundle's CPT rows, skipping ids that already exist, and dropping (not failing on) any CPT whose depth-series is over the cap.

**Why it is here.** Skipping existing ids is what makes restore *idempotent* — re-opening a file whose rows are already present is a no-op, not a duplication. An over-cap series drops the series but keeps the CPT (it still appears on the map), rather than failing the whole restore (debt #112).

.. CG-EXPLANATION-END id=function:_restore_cpts

Function ``async def _restore_boreholes``
-----------------------------------------

.. CG-BLOCK id=function:_restore_boreholes lines=220-291

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 220-291
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_boreholes

**What this does.** Inserts the bundle's borehole rows with their full child tree, and returns the count plus a map of deferred sample-to-body stamps.

**Why it is here.** A sample can carry a geotech-body stamp whose body does not restore until a later phase, so the stamp is stripped here and re-attached after the bodies land — the same deferral pattern the sections use for their companion-body link.

.. CG-EXPLANATION-END id=function:_restore_boreholes

Function ``async def _restore_formations``
------------------------------------------

.. CG-BLOCK id=function:_restore_formations lines=292-342

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 292-342
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_formations

**What this does.** Inserts the bundle's geological formation rows, deduped against the database.

**Why it is here.** Formations are project-scoped shared vocabulary (not nested under a model), so they restore as their own flat collection, each row deduped by id.

.. CG-EXPLANATION-END id=function:_restore_formations

Function ``async def _build_valid_formation_ids``
-------------------------------------------------

.. CG-BLOCK id=function:_build_valid_formation_ids lines=343-387

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 343-387
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_valid_formation_ids

**What this does.** Returns the union of the formation ids already in the database and those carried in the payload.

**Why it is here.** Later phases check whether a contact / layer / absence points at a real formation. Unioning database ids with payload ids — rather than querying — avoids a mid-transaction flush that would prematurely materialise every queued row, while still counting rows that are queued-but-not-yet-written.

.. CG-EXPLANATION-END id=function:_build_valid_formation_ids

Function ``async def _build_valid_model_ids``
---------------------------------------------

.. CG-BLOCK id=function:_build_valid_model_ids lines=388-429

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 388-429
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_valid_model_ids

**What this does.** The same union trick for geological-model ids.

**Why it is here.** Used by the phases after the model insert (bodies, absences, edges) to gate their foreign-key checks without forcing a flush.

.. CG-EXPLANATION-END id=function:_build_valid_model_ids

Function ``async def _build_valid_inv_ids``
-------------------------------------------

.. CG-BLOCK id=function:_build_valid_inv_ids lines=430-480

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 430-480
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_valid_inv_ids

**What this does.** The same union trick for investigation (CPT + borehole) ids, called after both are inserted.

**Why it is here.** Contacts, absences and bodies validate their investigation reference against this set, again without paying for a flush.

.. CG-EXPLANATION-END id=function:_build_valid_inv_ids

Function ``async def _restore_cross_sections``
----------------------------------------------

.. CG-BLOCK id=function:_restore_cross_sections lines=481-540

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 481-540
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_cross_sections

**What this does.** Inserts the bundle's cross-section rows, but strips the companion-body foreign key and returns a map of the stripped links for later re-attachment.

**Why it is here.** The companion link points at a body, and bodies restore in a *later* phase, so inserting a section with that column set would violate the foreign key on a cold restore. Stripping it and re-attaching after the bodies land is the deferred-foreign-key pattern; the plain boolean 'is a companion' flag stays on the row so the section is flagged immediately.

.. CG-EXPLANATION-END id=function:_restore_cross_sections

Function ``async def _restore_investigation_reviews``
-----------------------------------------------------

.. CG-BLOCK id=function:_restore_investigation_reviews lines=541-639

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 541-639
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_investigation_reviews

**What this does.** Inserts the bundle's review rows, validating that each row's target investigation exists and skipping those that do not.

**Why it is here.** The review's link to its investigation is polymorphic and not database-enforced, so the restore checks the target itself and drops a review whose CPT or borehole is not in the project rather than leaving a dangling row.

.. CG-EXPLANATION-END id=function:_restore_investigation_reviews

Function ``async def _restore_project_bundle_impl``
---------------------------------------------------

.. CG-BLOCK id=function:_restore_project_bundle_impl lines=640-1034

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py
   :language: python
   :lines: 640-1034
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_project_bundle_impl

**What this does.** The top-level orchestrator. It resolves or creates the project shell, optionally runs the pre-wipe integrity guard and wipe for replace mode, then runs the phases strictly in order: CPTs, boreholes, formations, models with their nested contacts and layers, sections, reviews, bodies, the deferred companion-body and sample-body re-attachments, formation absences, contact edges, geometry facts, tombstones, separations, unions, boundary shapes and nodes, and finally the cached solids — then flushes once.

**Why it is here.** The order is dictated by the foreign keys, and the comments spell out each dependency: formations and models before anything that references them; investigations before contacts; bodies before the companion-body and sample-body links that were deferred to avoid a cold-restore foreign-key violation; the litho-layer-referencing rows (facts, separations, unions) after the layers and before the route's body reconcile, so the restored resolver run already honours a must-link or cannot-link (owner rulings, debt #278); and the cached solids last, when both their foreign-key targets are guaranteed present. In replace mode the integrity guard refuses to wipe good data for a self-inconsistent bundle, while the open-from-file path stays tolerant so legacy bundles still open (docs/gmproj-format.md).

.. CG-EXPLANATION-END id=function:_restore_project_bundle_impl

