groundmodel.application.build_voxel_litho_model
===============================================

.. CG-PAGE source=src/groundmodel/application/build_voxel_litho_model.py complete=true

*Source file:* ``src/groundmodel/application/build_voxel_litho_model.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-134

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 1-134
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the 3-D build file. It imports the gapless-report assembler, the solid-persistence mixin, the packing-class-key loader, the view-state readers, and the many voxel domain services, and defines a per-process build lock. Its long docstring describes the whole pipeline.

**Why it is here.** This replaced the retired implicit field builder: it takes the frontend's validated 2-D partitions as the source of truth, builds the model footprint, labels a regular 3-D voxel grid from the partitions (a voxel is a 3-D pixel — a small cube of space), extracts each body's watertight surface by greedy meshing (merging cubes into big rectangles), and upserts the meshes. A labelling of space is itself a partition, so the boundaries are watertight and can represent interfingering the old field could not. The build lock keeps the memory budget a per-process bound; it does not re-run the body resolver because the payload's body ids already reflect the resolved state and re-resolving could desync the 3-D model from the validated 2-D one.

.. CG-EXPLANATION-END id=module-header

Function ``def _generation_payload``
------------------------------------

.. CG-BLOCK id=function:_generation_payload lines=135-171

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 135-171
   :lineno-match:

.. CG-EXPLANATION-START id=function:_generation_payload

**What this does.** Serialises the partitions exactly as the build received them, into a JSON-ready dict, taking field names from the value objects rather than listing them.

**Why it is here.** The stored generation is what a reproduce or diagnostic replays, so it must not be a lossy view; hand-listing field names silently dropped the 2-D classification three times in one pipeline (debt #256), so the value objects supply the names.

.. CG-EXPLANATION-END id=function:_generation_payload

Function ``def _partition_checksum``
------------------------------------

.. CG-BLOCK id=function:_partition_checksum lines=172-279

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 172-279
   :lineno-match:

.. CG-EXPLANATION-START id=function:_partition_checksum

**What this does.** Computes a model-wide hash over the build inputs — grid spacing, optional vertical spacing and honor radius, each section line, each column position, each region's lithology, body, gap, classification and polygon, and each honored investigation's log.

**Why it is here.** The build is one global labelling, so the hash is model-level: any change that moves the labelling must bust the cache. The optional inputs are folded only when set so a plain cubic build's hash stays byte-stable with the pre-anisotropy form (no one-time spurious rebuild), and the geological surfaces are deliberately not folded in because the builder no longer consumes them (a geo rebuild must not bust the litho cache).

.. CG-EXPLANATION-END id=function:_partition_checksum

Function ``def _investigation_columns_from_picks``
--------------------------------------------------

.. CG-BLOCK id=function:_investigation_columns_from_picks lines=280-347

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 280-347
   :lineno-match:

.. CG-EXPLANATION-START id=function:_investigation_columns_from_picks

**What this does.** Groups the resolved picks into one observed column per investigation, converting depth to absolute elevation and ordering top to bottom, ordered by investigation id.

**Why it is here.** The picks' body id is the resolver-assigned identity (the loader reflects the resolver), so the honored voxels group with the matching section bodies; the columns are ordered by id for a deterministic hash, and a vertical gap is kept because the honor labeller defers to the section blend there.

.. CG-EXPLANATION-END id=function:_investigation_columns_from_picks

Function ``def _apply_aliases_to_columns``
------------------------------------------

.. CG-BLOCK id=function:_apply_aliases_to_columns lines=348-389

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 348-389
   :lineno-match:

.. CG-EXPLANATION-START id=function:_apply_aliases_to_columns

**What this does.** Relabels each honored column's interval body ids through the same alias map applied to the section regions, returning new value objects.

**Why it is here.** Both the section regions and the honored intervals must pass through the SAME alias map or the labeller registers two identities for one physical unit — one in blended space, one at the honored column — and the mesher emits them as separate abutting bodies.

.. CG-EXPLANATION-END id=function:_apply_aliases_to_columns

Function ``def _investigation_columns_checksum``
------------------------------------------------

.. CG-BLOCK id=function:_investigation_columns_checksum lines=390-425

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 390-425
   :lineno-match:

.. CG-EXPLANATION-START id=function:_investigation_columns_checksum

**What this does.** Folds the honored investigation columns — their ids, kinds, positions and intervals — into an open hash.

**Why it is here.** A pick change (a moved contact, a re-assigned body, an added or removed layer) must bust the cache so the next build rebuilds; the investigation kind is folded in because it decides which of two investigations sharing a voxel column is honored.

.. CG-EXPLANATION-END id=function:_investigation_columns_checksum

Class ``BuildVoxelLithoModel`` — header
---------------------------------------

.. CG-BLOCK id=class:BuildVoxelLithoModel lines=426-445

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 426-445
   :lineno-match:

.. CG-EXPLANATION-START id=class:BuildVoxelLithoModel

**What this does.** The use case that builds and persists the 3-D litho solids from the 2-D partitions, stamping the voxel method on every stored row.

**Why it is here.** It inherits the shared persistence mixin for its upsert, orphan-delete and checksum semantics; the caller owns the session and it commits once.

.. CG-EXPLANATION-END id=class:BuildVoxelLithoModel

Method ``BuildVoxelLithoModel``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel.__init__ lines=446-450

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 446-450
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel.__init__

**What this does.** Initialises the mixin with this module's name and stores the session.

**Why it is here.** The mixin needs the session and the module-named logger.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel.__init__

Method ``BuildVoxelLithoModel``. ``def _raise_if_cancelled``
------------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._raise_if_cancelled lines=451-467

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 451-467
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._raise_if_cancelled

**What this does.** Raises a build-cancelled error when a cancel has been requested, or does nothing.

**Why it is here.** The between-phase half of the cooperative cancel: checked before each CPU phase so a cancel arriving during the previous phase stops the build before the next starts (the per-column half lives inside the labeller).

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._raise_if_cancelled

Method ``BuildVoxelLithoModel``. ``def _emit_progress``
-------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._emit_progress lines=468-492

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 468-492
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._emit_progress

**What this does.** Reports a progress event when a reporter is wired, otherwise does nothing.

**Why it is here.** The callback must not block, so it is safe to call from inside the worker thread as well as the event loop; it is absent for the synchronous endpoint.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._emit_progress

Method ``BuildVoxelLithoModel``. ``async def execute``
------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel.execute lines=493-577

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 493-577
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel.execute

**What this does.** A thin wrapper that runs the build and, on a cancel, rolls the session back and re-raises so a cancelled build leaves the stored model exactly as it was.

**Why it is here.** It owns the cancel contract (owner ruling, debt #282): nothing is written for a cancelled build, whether the cancel came between phases or from inside the labeller's column loop.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel.execute

Method ``BuildVoxelLithoModel``. ``async def _execute_impl``
------------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._execute_impl lines=578-1129

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 578-1129
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._execute_impl

**What this does.** The whole build: it heals the geotech parent links, honors each investigation's own log, aliases body ids across sections into one identity, re-seats columns onto their true map positions, builds the footprint, short-circuits on an unchanged checksum, then off the event loop labels the grid, reconciles the sections, extracts the meshes, and finally writes the generation, upserts the meshes, deletes orphans and commits.

**Why it is here.** Every ordering is load-bearing and the comments cite each: the parent links are healed here because the geotech Build is the last whole-model operation and it does not run the resolver; the CPU phases run on a worker thread so the single desktop server stays responsive; the footprint is built from the columns as drawn plus the true drilled positions so it can only grow (a shrunk hull re-opens the uncovered-column bug); the labeller ranks in true map space not projected-foot space (owner 2026-07-29); the partition is the only authority on lithology, so a void below a shallow log stays unknown rather than being back-filled from a distant section (owner 2026-07-30). Uncovered investigations and structural anomalies are surfaced because a server warning is invisible in a packaged build. It does not run the resolver — the payload already reflects the resolved state.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._execute_impl

Method ``BuildVoxelLithoModel``. ``def _assemble_gapless``
----------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._assemble_gapless lines=1130-1180

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 1130-1180
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._assemble_gapless

**What this does.** Assembles the seven-clause gapless report, and on any failure in the assembly logs it and returns nothing rather than raising.

**Why it is here.** The gate is a report about the artefact, so it must never be able to prevent the artefact; a raise in the assembly answers with no verdict (honest) while the solids are written exactly as they would have been.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._assemble_gapless

Method ``BuildVoxelLithoModel``. ``def _report_label_anomalies``
----------------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._report_label_anomalies lines=1181-1241

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 1181-1241
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._report_label_anomalies

**What this does.** Voices, at warning level with aggregate counts, the structural anomalies the labeller had to paper over — void columns, closed interior voids, hairline gaps, logs below the grid floor.

**Why it is here.** The labeller is a pure function with no logger, so its anomalies ride out on a report and are voiced here; the owner's standing rule is that the model is gapless and a hole is never silent. Only aggregate counts, never per-column lines, because the worst site alone hits thousands of columns and would bury the log.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._report_label_anomalies

Method ``BuildVoxelLithoModel``. ``def _warn_sub_voxel_investigations``
-----------------------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._warn_sub_voxel_investigations lines=1242-1317

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 1242-1317
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._warn_sub_voxel_investigations

**What this does.** Warns about investigation pairs closer than one horizontal voxel, which contend for the same grid column so only one log survives, using a spatial hash to find them.

**Why it is here.** The labeller honors at most one investigation per column, so a too-close pair is a real fidelity loss that must never pass unlogged; the spatial hash avoids an all-pairs walk, and the test over-reports rather than under-reports because it is grid-phase independent.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._warn_sub_voxel_investigations

Method ``BuildVoxelLithoModel``. ``async def _handle_empty``
------------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._handle_empty lines=1318-1400

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 1318-1400
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._handle_empty

**What this does.** Clears every solid row for the model and returns a zero outcome carrying the reason, for the empty or degenerate cases.

**Why it is here.** An empty model is a valid nothing-to-build state, so the cache is emptied rather than raising; the reason is required, not defaulted, because this path DELETES the stored model and its counts look identical to a happy build of zero bodies, so a call site that cannot say why must not compile.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._handle_empty

Method ``BuildVoxelLithoModel``. ``async def _write_generation``
----------------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._write_generation lines=1401-1519

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 1401-1519
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._write_generation

**What this does.** Writes one generation row recording the exact payload, every output-changing setting, the grid geometry (origin included), the body-alias map and the report, then prunes older generations beyond the keep limit.

**Why it is here.** Nothing else records what a build was made from and with — the payload lived only in the frontend, the settings only in the view-state at build time, the derived identity only in memory — so without it no diagnostic could reproduce a build (debt #252). The grid origin matters as much as the spacing because which cell an investigation lands in depends on grid phase; the alias map is derived provenance and must never be read back as a user correlation. Older generations are pruned because each carries the full payload.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._write_generation

Method ``BuildVoxelLithoModel``. ``async def _read_honor_radius_m``
-------------------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._read_honor_radius_m lines=1520-1557

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 1520-1557
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._read_honor_radius_m

**What this does.** Reads the honored-column radius from the project settings, defaulting to one horizontal voxel, and admitting zero.

**Why it is here.** Owner directive 2026-07-29 to widen honoring to the drawn column width; the drawn width is screen-space so a real metre radius is used instead, defaulting to one voxel so an investigation owns its own cell and the four neighbours (debt #249). Zero is a legitimate setting (nearest-cell-only), so the guard admits it unlike the snap-tolerance reader.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._read_honor_radius_m

Method ``BuildVoxelLithoModel``. ``async def _packing_class_key``
-----------------------------------------------------------------

.. CG-BLOCK id=method:BuildVoxelLithoModel._packing_class_key lines=1558-1592

.. literalinclude:: ../../../src/groundmodel/application/build_voxel_litho_model.py
   :language: python
   :lines: 1558-1592
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildVoxelLithoModel._packing_class_key

**What this does.** Builds the packing-class identity function for the model's project, delegating to the shared loader, and degrading to the identity function when the model's row has vanished.

**Why it is here.** The cross-section body merge must compare the packing class, not the raw formation row, so a body stays whole across a geological boundary where one class exists under several rows (debt #278; owner 2026-08-21: one mass one body). It reuses the shared loader (the same wiring the recompute uses) so the domain merge never sees a database row; on a litho model the key is the identity function and the merge is byte-identical.

.. CG-EXPLANATION-END id=method:BuildVoxelLithoModel._packing_class_key

