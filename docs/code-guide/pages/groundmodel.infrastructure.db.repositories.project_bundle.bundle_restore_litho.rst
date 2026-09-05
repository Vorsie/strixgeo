groundmodel.infrastructure.db.repositories.project_bundle.bundle_restore_litho
==============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-73

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 1-73
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring listing the litho-specific restore phases, plus the toolbox (the ORM models, the size caps, and the serialisation helpers).

**Why it is here.** It holds the phases for the interpretation layer — the models with their nested contacts / surfaces / layers, the bodies, the correlation edges, the geometry facts and user rulings, the tombstones, the boundary shapes and the cached solids. Like the core module, every function runs inside the caller's transaction and none flushes on its own.

.. CG-EXPLANATION-END id=module-header

Function ``def _require_fk``
----------------------------

.. CG-BLOCK id=function:_require_fk lines=74-132

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 74-132
   :lineno-match:

.. CG-EXPLANATION-START id=function:_require_fk

**What this does.** Resolves one foreign-key value from a bundle payload and checks it against a set of valid ids, returning it or dropping it (with a warning) when it is not valid.

**Why it is here.** It is the shared foreign-key guard the litho phases use: a bundle can carry a reference to a formation, model or investigation that is not in this project (a hand-edited or partial file), and this turns that into a clean skip rather than a foreign-key crash mid-restore.

.. CG-EXPLANATION-END id=function:_require_fk

Function ``def _blank_surface_geometry``
----------------------------------------

.. CG-BLOCK id=function:_blank_surface_geometry lines=133-151

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 133-151
   :lineno-match:

.. CG-EXPLANATION-START id=function:_blank_surface_geometry

**What this does.** Drops a restored surface's TIN geometry and forces it to rebuild.

**Why it is here.** When a cached surface blob is missing, malformed, or over the size cap, its geometry is blanked and the surface is marked stale so the next build regenerates it — the surface row survives, only the runaway or bad blob is dropped.

.. CG-EXPLANATION-END id=function:_blank_surface_geometry

Function ``async def _restore_geological_models``
-------------------------------------------------

.. CG-BLOCK id=function:_restore_geological_models lines=152-448

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 152-448
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_geological_models

**What this does.** Inserts the bundle's model rows with their nested contacts, cached surfaces, and litho layers, ordering parents before children and guarding every foreign key against the valid-id sets.

**Why it is here.** This is the interpretation heart of the restore: a geological model brings its contacts, a litho model its layers, and both bring any cached surfaces. Parents come first because the model parent link is a self-referential foreign key, and each nested row's formation and investigation references are guarded so a partial bundle skips an orphan rather than crashing.

.. CG-EXPLANATION-END id=function:_restore_geological_models

Function ``async def _attach_sample_body_links``
------------------------------------------------

.. CG-BLOCK id=function:_attach_sample_body_links lines=449-517

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 449-517
   :lineno-match:

.. CG-EXPLANATION-START id=function:_attach_sample_body_links

**What this does.** Re-attaches the sample-to-body stamps that were deferred during the borehole phase, now that the bodies exist, and drops (to NULL) any stamp whose body is not in the restored project — counting the drops.

**Why it is here.** The stamp is a foreign key to a body, so it could not be set before the bodies landed. A stamp pointing at a body that is not here is the stale window a re-minted body id leaves in a saved file, so it is set to NULL and tallied rather than left dangling.

.. CG-EXPLANATION-END id=function:_attach_sample_body_links

Function ``async def _attach_companion_body_links``
---------------------------------------------------

.. CG-BLOCK id=function:_attach_companion_body_links lines=518-573

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 518-573
   :lineno-match:

.. CG-EXPLANATION-START id=function:_attach_companion_body_links

**What this does.** Sets the cross-section companion-body foreign keys that the section phase deferred, now that the bodies exist.

**Why it is here.** The other half of the deferred-foreign-key pattern from the section phase — the link is safe to set only after its body target is present (#196).

.. CG-EXPLANATION-END id=function:_attach_companion_body_links

Function ``async def _restore_bodies``
--------------------------------------

.. CG-BLOCK id=function:_restore_bodies lines=574-700

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 574-700
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_bodies

**What this does.** Inserts the bundle's body rows with foreign-key guards, stripping the retired extent fields, and returns the inserted / skipped / dropped counts.

**Why it is here.** Bodies are the identity rows for correlated units (docs/design/body-model.md); their model, formation and investigation references are guarded against the valid-id sets so a partial bundle skips an orphan body. The old per-side extent fields are stripped because that system was retired — a legacy bundle may still carry them, and the strip lets it open unchanged.

.. CG-EXPLANATION-END id=function:_restore_bodies

Function ``async def _restore_formation_absences``
--------------------------------------------------

.. CG-BLOCK id=function:_restore_formation_absences lines=701-801

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 701-801
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_formation_absences

**What this does.** Inserts the bundle's formation-absence rows, skipping any whose formation or investigation reference is not valid.

**Why it is here.** An absence is positive evidence that a formation is missing at an investigation; a restored absence that points at a formation or investigation not in the project would be meaningless, so it is dropped.

.. CG-EXPLANATION-END id=function:_restore_formation_absences

Function ``async def _restore_contact_edges``
---------------------------------------------

.. CG-BLOCK id=function:_restore_contact_edges lines=802-1002

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 802-1002
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_contact_edges

**What this does.** Inserts the bundle's litho contact-correlation edge rows.

**Why it is here.** These are the ties the body resolver walks; they restore after the litho layers their endpoints reference, and share the canonical-order and guard machinery of the other layer-pair rows.

.. CG-EXPLANATION-END id=function:_restore_contact_edges

Function ``async def _restore_layer_pair_rows``
-----------------------------------------------

.. CG-BLOCK id=function:_restore_layer_pair_rows lines=1003-1146

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 1003-1146
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_layer_pair_rows

**What this does.** The shared worker that inserts a bundle's canonical layer-pair rows — geometry facts, separations, and unions — guarding the model reference and re-establishing the smallest-first endpoint order.

**Why it is here.** All three collections have the same shape (a model plus an ordered pair of layer ids), so one guarded, canonicalising insert loop serves them instead of three near-identical copies.

.. CG-EXPLANATION-END id=function:_restore_layer_pair_rows

Function ``async def _restore_geometry_facts``
----------------------------------------------

.. CG-BLOCK id=function:_restore_geometry_facts lines=1147-1193

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 1147-1193
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_geometry_facts

**What this does.** Inserts the bundle's geometric body-connectivity facts, via the shared layer-pair worker.

**Why it is here.** Facts are edges for the body resolver (owner ruling 2026-08-12); they restore after the litho layers and before the route's reconcile, so the restored resolver run already unions them (docs/design/body-model.md).

.. CG-EXPLANATION-END id=function:_restore_geometry_facts

Function ``async def _restore_body_separations``
------------------------------------------------

.. CG-BLOCK id=function:_restore_body_separations lines=1194-1250

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 1194-1250
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_body_separations

**What this does.** Inserts the bundle's user 'Separate' rulings, via the shared layer-pair worker.

**Why it is here.** A separation is a permanent cannot-link the engineer set; restoring it before the reconcile keeps the two bodies split on open, exactly as the owner ruled (debt #278 R5, 'permanent').

.. CG-EXPLANATION-END id=function:_restore_body_separations

Function ``async def _restore_body_unions``
-------------------------------------------

.. CG-BLOCK id=function:_restore_body_unions lines=1251-1304

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 1251-1304
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_body_unions

**What this does.** Inserts the bundle's user 'Join with…' rulings, via the shared layer-pair worker.

**Why it is here.** A union is a must-link; it restores after the separations and before the reconcile, so the resolver honours it on open — and a union that contradicts a restored separation is suppressed by that resolver, never by this restore (debt #278).

.. CG-EXPLANATION-END id=function:_restore_body_unions

Function ``async def _restore_litho_solids``
--------------------------------------------

.. CG-BLOCK id=function:_restore_litho_solids lines=1305-1440

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 1305-1440
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_litho_solids

**What this does.** Inserts the bundle's cached 3-D body-solid rows, deduped on the (model, body) pair, validating the mesh blobs against the size caps.

**Why it is here.** These are rebuildable caches carried on purpose so a fresh-database open need not re-triangulate; they restore last among the litho phases, when both their foreign-key targets (model, formation) are guaranteed present, and an over-cap or malformed mesh is dropped rather than trusted.

.. CG-EXPLANATION-END id=function:_restore_litho_solids

Function ``async def _restore_tie_tombstones``
----------------------------------------------

.. CG-BLOCK id=function:_restore_tie_tombstones lines=1441-1579

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 1441-1579
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_tie_tombstones

**What this does.** Inserts the bundle's deleted-tie tombstones, guarding the model reference.

**Why it is here.** A tombstone remembers a packing tie the engineer deleted, by its place (owner 2026-08-17); it carries only model and section references (no layer foreign keys), so it needs nothing beyond the models and sections being in.

.. CG-EXPLANATION-END id=function:_restore_tie_tombstones

Function ``async def _restore_lens_shapes_and_nodes``
-----------------------------------------------------

.. CG-BLOCK id=function:_restore_lens_shapes_and_nodes lines=1580-1687

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
   :language: python
   :lines: 1580-1687
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restore_lens_shapes_and_nodes

**What this does.** Inserts the bundle's body-boundary shape rows and their control nodes, guarding the model reference.

**Why it is here.** These are the hand-drawn body outlines; the shapes restore before their nodes because a node's foreign key points at its shape.

.. CG-EXPLANATION-END id=function:_restore_lens_shapes_and_nodes

