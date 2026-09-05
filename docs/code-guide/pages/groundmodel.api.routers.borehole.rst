groundmodel.api.routers.borehole
================================

.. CG-PAGE source=src/groundmodel/api/routers/borehole.py complete=true

*Source file:* ``src/groundmodel/api/routers/borehole.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-69

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 1-69
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file, then imports the FastAPI building blocks, the shared DOV-stream and scope-guard helpers, the borehole request/response schemas, the shared elevation-patch schema, the application use cases, the job registry, the repository, and the session and logger. It defines a lookup that maps friendly URL names for lab-test families to the internal relationship names, makes the module logger, and creates the router.

**Why it is here.** This is the router for boreholes; it deliberately mirrors the CPT router (see the CPT page for the shared DOV-import and streaming mechanics). The friendly-name lookup exists so the ``?include=`` query parameter can use short domain words while the repository gets the exact relationship names; the comment notes that adding a typed lab-test family means appending one entry here and one in the repository.

.. CG-EXPLANATION-END id=module-header

Function ``async def import_borehole_dov``
------------------------------------------

.. CG-BLOCK id=function:import_borehole_dov lines=70-148

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 70-148
   :lineno-match:

.. CG-EXPLANATION-START id=function:import_borehole_dov

**What this does.** The handler for ``POST /borehole/import-dov`` — import every borehole DOV holds inside a longitude/latitude rectangle, returning counts (imported, duplicate, failed) plus the many per-family attach/fail tallies and the borehole ids.

**Why it is here.** It mirrors the CPT DOV import exactly (same request shape and same failure-to-status mapping: ``503``/``504``/``502``). The extra tallies exist because a borehole carries lab tests, samples, and interpretations that are attached alongside it, and the desktop shows how many of each landed. Same server-side-only error detail as the CPT path (debt #43).

.. CG-EXPLANATION-END id=function:import_borehole_dov

Function ``def _make_borehole_dov_import_coro``
-----------------------------------------------

.. CG-BLOCK id=function:_make_borehole_dov_import_coro lines=149-230

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 149-230
   :lineno-match:

.. CG-EXPLANATION-START id=function:_make_borehole_dov_import_coro

**What this does.** The factory for the borehole streaming import background job: it opens its own database session, runs the import while pushing progress and a final done/error event onto a queue, and ends with the completion marker.

**Why it is here.** It mirrors the CPT factory (see the CPT page) so the two import paths behave identically; the own-session design lets the request return immediately while the import runs on.

.. CG-EXPLANATION-END id=function:_make_borehole_dov_import_coro

Function ``async def import_borehole_dov_stream``
-------------------------------------------------

.. CG-BLOCK id=function:import_borehole_dov_stream lines=231-273

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 231-273
   :lineno-match:

.. CG-EXPLANATION-START id=function:import_borehole_dov_stream

**What this does.** The handler for ``POST /borehole/import-dov/stream`` — start the import as a background task and return its job id, refusing a duplicate scope with a ``409`` that names the running job.

**Why it is here.** Same design and de-duplication as the CPT streaming endpoint (see the CPT page).

.. CG-EXPLANATION-END id=function:import_borehole_dov_stream

Function ``async def get_borehole_dov_stream``
----------------------------------------------

.. CG-BLOCK id=function:get_borehole_dov_stream lines=274-300

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 274-300
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_borehole_dov_stream

**What this does.** The handler for ``GET /borehole/import-dov/stream/{job_id}`` — open the live progress stream for a running import via the shared helper.

**Why it is here.** Same server-sent-events drain and ``404``-when-unknown behaviour as the CPT stream endpoint (see the CPT page).

.. CG-EXPLANATION-END id=function:get_borehole_dov_stream

Function ``async def list_boreholes``
-------------------------------------

.. CG-BLOCK id=function:list_boreholes lines=301-349

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 301-349
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_boreholes

**What this does.** The handler for ``GET /borehole/`` — return a lightweight summary per borehole, optionally filtered to one project. It validates the project id and maps each row to the summary schema.

**Why it is here.** Mirrors the CPT list endpoint: only header columns and pre-counted totals travel so the desktop can draw the sidebar and map markers from one call. The mapping uses the schema's read-from-row setting, so no field is forwarded by hand.

.. CG-EXPLANATION-END id=function:list_boreholes

Function ``async def get_borehole``
-----------------------------------

.. CG-BLOCK id=function:get_borehole lines=350-441

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 350-441
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_borehole

**What this does.** The handler for ``GET /borehole/{borehole_id}`` — return the full borehole tree (header, drill segments, field log, observations, and lab tests). It requires a project id, and an optional ``include`` list chooses which lab-test families to load; unrequested families come back as empty lists.

**Why it is here.** The project-scope guard is here as on every by-id endpoint. The ``include`` option (debt #2) lets a caller skip the heavy queries for families it will not render while keeping the response shape identical, so existing clients keep working. The assertion that the router aliases match the repository relationships is a deliberate loud tripwire: if a future change desynchronises the two lists, this fails clearly instead of silently lazy-loading and crashing under async with a ``MissingGreenlet`` error.

.. CG-EXPLANATION-END id=function:get_borehole

Function ``async def post_borehole_detail_batch``
-------------------------------------------------

.. CG-BLOCK id=function:post_borehole_detail_batch lines=442-516

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 442-516
   :lineno-match:

.. CG-EXPLANATION-START id=function:post_borehole_detail_batch

**What this does.** The handler for ``POST /borehole/detail-batch`` — load the full trees for many boreholes in one request, honouring the same ``include`` option; unknown or foreign-project ids drop silently.

**Why it is here.** Opening a section used to fire one heavy request per in-buffer borehole; this folds them into a single query whose cost is constant in the number of boreholes rather than growing with it (debt #39). The project-scope guard is fused into the query so a crafted batch cannot pull boreholes from another project, and the 500-id cap matches the CPT batch.

.. CG-EXPLANATION-END id=function:post_borehole_detail_batch

Function ``async def patch_borehole_elevation``
-----------------------------------------------

.. CG-BLOCK id=function:patch_borehole_elevation lines=517-582

.. literalinclude:: ../../../src/groundmodel/api/routers/borehole.py
   :language: python
   :lines: 517-582
   :lineno-match:

.. CG-EXPLANATION-START id=function:patch_borehole_elevation

**What this does.** The handler for ``PATCH /borehole/{borehole_id}/elevation`` — set or clear the manual surface elevation of a borehole, staling dependent cached geometry in the same transaction, then return the lightweight summary.

**Why it is here.** Mirrors the CPT elevation patch, including the same-transaction cache-staling for the same reason (debt #34): a contact's absolute height depends on the elevation, so moving it must invalidate the dependent surfaces and 3-D solids atomically. It returns the summary shape (not the full tree) because the desktop only needs the header columns to refresh its list, and it shares the elevation use case with the CPT handler so the two cannot drift.

.. CG-EXPLANATION-END id=function:patch_borehole_elevation

