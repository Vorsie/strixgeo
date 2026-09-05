groundmodel.api.routers.geology.litho_solids
============================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/litho_solids.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/litho_solids.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-98

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 1-98
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring listing the 3-D solid-cache web addresses this file provides, then the imports: the router tools and the shared server-sent-events helper, the scope guard, the solid/report/footprint/colour schemas, the build use cases and the job registry, the domain partition input type, the database rows and the repository, the build exceptions, and the logger. It makes a module-level logger and a bare router.

**Why it is here.** Same split-package pattern (mounted under the shared geology prefix). These are the litho analogue of the geological surface endpoints: they cache and serve the 3-D solid meshes the voxel builder produces, and drive the on-click Build. A *solid* here is a body's watertight 3-D mesh.

.. CG-EXPLANATION-END id=module-header

Function ``async def _body_attrs_by_body``
------------------------------------------

.. CG-BLOCK id=function:_body_attrs_by_body lines=99-133

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 99-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:_body_attrs_by_body

**What this does.** A private helper that fetches each body's display colour and ordinal in one bulk query keyed on a list of body ids.

**Why it is here.** It loads these attributes up front so the response serialiser never has to follow a database relationship while building the reply — doing that lazily on an async session raises an error (``MissingGreenlet``). A body missing from the result defaults to no colour and ordinal zero.

.. CG-EXPLANATION-END id=function:_body_attrs_by_body

Function ``def _to_solid_response``
-----------------------------------

.. CG-BLOCK id=function:_to_solid_response lines=134-183

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 134-183
   :lineno-match:

.. CG-EXPLANATION-START id=function:_to_solid_response

**What this does.** A private helper that builds one solid response from a cached solid row plus the body's colour and ordinal, copying the mesh vertices and triangles, the stale and flagged markers, and the timestamps.

**Why it is here.** The colour and ordinal are merged in at construction so the serialiser never touches a lazy attribute on the solid row. A missing colour falls back to the formation colour in the viewer, and the ordinal combines with the lithology to give a stable label like "SILT #3".

.. CG-EXPLANATION-END id=function:_to_solid_response

Function ``async def list_litho_solids``
----------------------------------------

.. CG-BLOCK id=function:list_litho_solids lines=184-239

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 184-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_litho_solids

**What this does.** The handler for ``GET .../litho-solids`` — return every cached solid in the model. It scope-guards the model, loads the solids, bulk-loads their body attributes, and returns the responses.

**Why it is here.** The 3-D viewer fetches this once on load and indexes by body; a stale solid is drawn at lower opacity until the engineer clicks Build. Scope-guarded like every by-model endpoint, and the body attributes are bulk-loaded to avoid a lazy load during serialisation.

.. CG-EXPLANATION-END id=function:list_litho_solids

Function ``async def _build_rebuild_response``
----------------------------------------------

.. CG-BLOCK id=function:_build_rebuild_response lines=240-318

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 240-318
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_rebuild_response

**What this does.** A private helper that runs after a build commits: it loads the freshly persisted solids, bulk-loads their body attributes, logs the outcome, and bundles the solids with the outcome counts and the gapless-gate report into the response.

**Why it is here.** Bundling the new solids with the build outcome lets the desktop refresh its cache in one round-trip instead of a follow-up list call. The gapless report is validated into its schema here, at the API boundary, because the application layer returns a plain dictionary and must not import API schemas. The empty-reason and uncovered-tests fields let the desktop explain a build that produced nothing rather than reading it as plain success.

.. CG-EXPLANATION-END id=function:_build_rebuild_response

Function ``async def build_voxel_litho_solids``
-----------------------------------------------

.. CG-BLOCK id=function:build_voxel_litho_solids lines=319-449

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 319-449
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_voxel_litho_solids

**What this does.** The handler for ``POST .../litho-solids/build-voxel`` — build the 3-D solid cache from the validated 2-D partitions, synchronously. It scope-guards the model, converts the request to domain objects, runs the voxel build use case, maps a too-big grid to ``422`` with a suggested spacing, and returns the bundled result.

**Why it is here.** This is the primary way the engineer materialises the litho model into 3-D: the 2-D partitions are the source of truth, and labelling a voxel grid from them then extracting each body's boundary is watertight and faithful by construction (a labelling of space is a partition, so interfingering is representable). The force flag defaults to always rebuild (the on-click Build); a too-large grid is a spacing the engineer can simply retype, so it is a structured ``422`` carrying the retry spacing as a number rather than a destructive failure — nothing was written.

.. CG-EXPLANATION-END id=function:build_voxel_litho_solids

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=450-456

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 450-456
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Sets three short string codes used by the background build: the conflict code for a second concurrent build, and the terminal stream codes for a cancelled build and an unexpected failure.

**Why it is here.** Naming them once keeps the code the endpoint sends and the code the stream emits in step, so the desktop can match on a stable token rather than a message.

.. CG-EXPLANATION-END id=module-statements

Function ``def _voxel_build_job_key``
-------------------------------------

.. CG-BLOCK id=function:_voxel_build_job_key lines=457-461

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 457-461
   :lineno-match:

.. CG-EXPLANATION-START id=function:_voxel_build_job_key

**What this does.** A private helper that builds the de-duplication key for a build job from the model id.

**Why it is here.** The key scopes at most one live 3-D build per model, so a second Build on the same model is refused rather than competing for memory.

.. CG-EXPLANATION-END id=function:_voxel_build_job_key

Function ``async def _run_voxel_build_job``
-------------------------------------------

.. CG-BLOCK id=function:_run_voxel_build_job lines=462-578

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 462-578
   :lineno-match:

.. CG-EXPLANATION-START id=function:_run_voxel_build_job

**What this does.** The coroutine that runs one background voxel build: it opens its own database session, runs the build while emitting progress events onto a queue, and on success emits the same response the synchronous endpoint returns; on cancel or error it emits a terminal error event, always ending with a completion marker.

**Why it is here.** It owns its own session so the spawning request's session can close when the ``202`` is sent, mirroring the DOV import background job. Progress ticks are marshalled onto the event loop from the worker thread safely, because the labeller's per-column ticks fire on another thread. On cancel the use case has already rolled back, so the stored model is untouched, and an unexpected error is logged with its full traceback because a background job has no request on which to surface it.

.. CG-EXPLANATION-END id=function:_run_voxel_build_job

Function ``def _voxel_build_factory``
-------------------------------------

.. CG-BLOCK id=function:_voxel_build_factory lines=579-624

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 579-624
   :lineno-match:

.. CG-EXPLANATION-START id=function:_voxel_build_factory

**What this does.** A private helper that binds the build arguments into a factory the job registry can call to create the build coroutine.

**Why it is here.** The registry calls the returned factory with a fresh queue and expects a coroutine; resolving the run function by name at call time lets a test substitute a fake build.

.. CG-EXPLANATION-END id=function:_voxel_build_factory

Function ``async def start_voxel_build_job``
--------------------------------------------

.. CG-BLOCK id=function:start_voxel_build_job lines=625-722

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 625-722
   :lineno-match:

.. CG-EXPLANATION-START id=function:start_voxel_build_job

**What this does.** The handler for ``POST .../litho-solids/build-voxel/jobs`` — spawn a 3-D build in the background and return its job id at once. It scope-guards the model, builds the factory, registers the job, and answers ``202 Accepted``; a build already running for this model is ``409`` carrying the running job id.

**Why it is here.** The synchronous build blocks with no progress and no way to cancel a long run (debt #282); this adds a background form with progress and cancellation, reusing the same job machinery as the DOV import. The build still runs under the same per-process CPU lock, so a second build waits for memory rather than competing for it, and the ``409`` hands back the running job id so the client attaches to it.

.. CG-EXPLANATION-END id=function:start_voxel_build_job

Function ``async def stream_voxel_build_job``
---------------------------------------------

.. CG-BLOCK id=function:stream_voxel_build_job lines=723-783

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 723-783
   :lineno-match:

.. CG-EXPLANATION-START id=function:stream_voxel_build_job

**What this does.** The handler for ``GET .../litho-solids/build-voxel/jobs/{job_id}`` — stream a running build's progress as server-sent events. It checks the job exists and returns the event stream, documenting the progress, done, and error event shapes.

**Why it is here.** It lets the desktop watch the build's phases (label, reconcile, extract, persist) and receive the same completion payload the synchronous endpoint returns, so the viewer refreshes identically. An unknown job (finished and cleaned up, or never started) is ``404``.

.. CG-EXPLANATION-END id=function:stream_voxel_build_job

Function ``async def cancel_voxel_build_job``
---------------------------------------------

.. CG-BLOCK id=function:cancel_voxel_build_job lines=784-839

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 784-839
   :lineno-match:

.. CG-EXPLANATION-START id=function:cancel_voxel_build_job

**What this does.** The handler for ``POST .../litho-solids/build-voxel/jobs/{job_id}/cancel`` — request cancellation of a running build. It sets the cooperative cancel flag and answers ``202``; an unknown or finished job is ``404``.

**Why it is here.** The flag is polled by the worker between columns, so the build stops cleanly, rolls back (leaving the model as it was), and emits a cancelled event on its stream. Best-effort: it never hangs on an unknown job.

.. CG-EXPLANATION-END id=function:cancel_voxel_build_job

Function ``async def get_litho_build_report``
---------------------------------------------

.. CG-BLOCK id=function:get_litho_build_report lines=840-900

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 840-900
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_litho_build_report

**What this does.** The handler for ``GET .../litho-solids/build-report`` — return the gapless-gate report of the model's most recent build, or nothing when none exists. It scope-guards the model and reads the latest build generation's stored report.

**Why it is here.** The report is assembled and stored at build time, so this is a plain read that lets reopening a project show the last build's verdict without re-running the build. A model never built, or one built before the gate existed, returns nothing.

.. CG-EXPLANATION-END id=function:get_litho_build_report

Function ``async def update_body_color``
----------------------------------------

.. CG-BLOCK id=function:update_body_color lines=901-969

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 901-969
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_body_color

**What this does.** The handler for ``PATCH .../bodies/{body_id}/color`` — set or clear a body's display-colour override for the 3-D viewer. It scope-checks the body, writes the colour, commits, and returns the id and value.

**Why it is here.** It is a separate additive endpoint because the general body-update route requires a non-empty name, which would make it unusable for a colour-only change without a breaking contract change (additive-only API rule). A null colour clears the override, and the viewer falls back to the formation's lithology colour.

.. CG-EXPLANATION-END id=function:update_body_color

Function ``async def get_model_footprint``
------------------------------------------

.. CG-BLOCK id=function:get_model_footprint lines=970-1031

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_solids.py
   :language: python
   :lines: 970-1031
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_model_footprint

**What this does.** The handler for ``GET .../footprint`` — return the model's footprint ring, re-derived from the last build's stored payload. It scope-guards the model, runs the footprint use case, and returns the ring with its provenance and any unavailable reason.

**Why it is here.** The 3-D viewer draws the ring so the model's edge reads as an edge rather than a hole (owner ballot 2026-08-26, v1.0 MVP), and re-deriving it from the stored build payload guarantees it matches the exact hull the build clipped to. It never errors for "nothing built yet": an unbuilt model, an unframeable payload, or one from an older builder all answer with an empty ring and a plain-English reason — only a foreign model is a ``404``.

.. CG-EXPLANATION-END id=function:get_model_footprint

