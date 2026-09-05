groundmodel.api.routers.cpt
===========================

.. CG-PAGE source=src/groundmodel/api/routers/cpt.py complete=true

*Source file:* ``src/groundmodel/api/routers/cpt.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-100

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 1-100
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file ("CPT API route handlers") and pulls in its tools: the FastAPI building blocks for defining web endpoints (``APIRouter``, ``Depends``, ``Form``, ``UploadFile``, ``HTTPException``, ``Query``, the status-code names), the database session type, the request/response *schemas* for CPT data, the application-layer use cases (import a file, import from DOV), the domain services that derive values, the repository that reads and writes CPT rows, and the custom exceptions. It then makes one module-level logger, sets a 200-MiB cap on a single uploaded file, and creates ``router = APIRouter(prefix="/cpt")``.

**Why it is here.** A *router* is a labelled group of related web addresses; an *endpoint* is one such address paired with the code that answers it. This file is the router for everything under the ``/cpt`` web path. Grouping the CPT endpoints in one router keeps the application's front door organised by subject. The comments record two deliberate choices: routers are plain functions, not classes, so the project's usual logger-by-inheritance pattern does not apply and the documented fallback (one module-level logger) is used instead; and the per-file upload cap exists so a giant or malicious file cannot exhaust memory, sitting below the coarser whole-request cap set in ``api/main.py`` (debt #39).

.. CG-EXPLANATION-END id=module-header

Function ``async def import_cpt``
---------------------------------

.. CG-BLOCK id=function:import_cpt lines=101-281

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 101-281
   :lineno-match:

.. CG-EXPLANATION-START id=function:import_cpt

**What this does.** The handler for ``POST /cpt/import`` — upload one CPT file and store it. It checks the file extension, streams the upload to a temporary file while counting bytes (refusing anything over the cap with a ``413``), then hands the file to the ``ImportCpt`` use case. Around that call it catches four specific outcomes and turns each into the right HTTP answer: a plain duplicate, a refresh that needs confirmation, a refresh refused as too broken, and an unparseable file. On success it returns the new (or refreshed) record's id plus any validation issues, answering ``201 Created`` for a new CPT and ``200 OK`` for a refresh.

**Why it is here.** This is the *consented CPT refresh* the project's API contract requires (``docs/api.md``; CLAUDE.md "Idempotency on ingest"). Re-importing a file already in the project could simply refresh the existing row in place — same id, new data — so a parser fix reaches a project the engineer already imported into without a delete-and-re-import that would destroy every interpretation anchored on the row. But that overwrite is irreversible, so it is never automatic: a duplicate with no confirmation answers ``409`` (the "conflict" status) carrying the old-versus-new difference so the desktop can show a dialog and ask; only ``confirm_refresh=true`` performs the write and answers ``200``; and a fresh parse with zero rows or fatal errors is refused ``422`` ("understood but unacceptable") even when confirmed, because a broken file must never overwrite good data. The docstring lays out all four cases. A *status code* is the short number a web reply carries to say what happened. The legacy ``409`` carrying only the existing id is kept for a caller that opts out of refreshing.

.. CG-EXPLANATION-END id=function:import_cpt

Function ``async def import_cpt_dov``
-------------------------------------

.. CG-BLOCK id=function:import_cpt_dov lines=282-337

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 282-337
   :lineno-match:

.. CG-EXPLANATION-START id=function:import_cpt_dov

**What this does.** The handler for ``POST /cpt/import-dov`` — import every CPT that DOV (the Flemish public subsurface database) holds inside a rectangle of longitude/latitude given in the request. It runs the ``ImportCptDov`` use case and returns counts of imported, duplicate, and failed soundings plus their ids. It maps a too-many-results refusal and any upstream network failure to the right status.

**Why it is here.** The failures are translated into distinct statuses — ``503`` (DOV unreachable), ``504`` (DOV timed out), ``502`` (DOV returned an error) — so the desktop can tell the engineer whether to retry or check their network. The comment records that the user-facing message carries only the failure category and, when safe, the upstream status; the library class names and messages are logged on the server only, so debugging stays possible without leaking dependency versions to a future untrusted caller (debt #43).

.. CG-EXPLANATION-END id=function:import_cpt_dov

Function ``def _make_cpt_dov_import_coro``
------------------------------------------

.. CG-BLOCK id=function:_make_cpt_dov_import_coro lines=338-435

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 338-435
   :lineno-match:

.. CG-EXPLANATION-START id=function:_make_cpt_dov_import_coro

**What this does.** A factory (a function that builds another function) that prepares the background job for a *streaming* DOV import. The job it builds opens its OWN database session, runs the DOV import while pushing progress events onto a queue — first a "pins" event listing every map marker so they can all be drawn before any download starts, then per-phase progress ticks, then a final "done" or "error" event — and always ends by putting a ``None`` marker on the queue to signal completion.

**Why it is here.** The background job owns its own database session so the original request's session can be closed the instant the ``202 Accepted`` reply is sent, rather than holding a database connection open for the whole roughly-one-minute cold import. The leading pins event exists so the engineer sees all pending markers on the map at once instead of watching them trickle in. Aborting the stream cancels the import but leaves any already-downloaded XML in the on-disk cache, so a later import of the same rectangle is fast.

.. CG-EXPLANATION-END id=function:_make_cpt_dov_import_coro

Function ``async def import_cpt_dov_stream``
--------------------------------------------

.. CG-BLOCK id=function:import_cpt_dov_stream lines=436-493

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 436-493
   :lineno-match:

.. CG-EXPLANATION-START id=function:import_cpt_dov_stream

**What this does.** The handler for ``POST /cpt/import-dov/stream`` — start a DOV import as a background task and immediately return its job id. It fetches the shared pool of parser processes, builds the job with the factory above, computes a de-duplication key from the rectangle and project, registers the job, and answers ``202 Accepted`` with ``{"job_id": ...}``.

**Why it is here.** ``202 Accepted`` is the status meaning "the work has been accepted and is running; check back for the result" — exactly right for a long import whose progress the client watches separately. The de-duplication key refuses a second identical import while the first is still running (a double-click or eager retry), handing back the running job's id so the client attaches to the existing stream instead of racing it.

.. CG-EXPLANATION-END id=function:import_cpt_dov_stream

Function ``async def get_cpt_dov_stream``
-----------------------------------------

.. CG-BLOCK id=function:get_cpt_dov_stream lines=494-537

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 494-537
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_cpt_dov_stream

**What this does.** The handler for ``GET /cpt/import-dov/stream/{job_id}`` — open the live progress stream for a running import. It hands the job id and registry to a shared helper that drains the job's event queue as a *server-sent-events* stream.

**Why it is here.** *Server-sent events* (SSE) is a simple one-way channel that lets the server push a sequence of messages to the browser over a single open connection — here the pins, progress ticks, and final result the background job produces. The docstring documents the exact event shapes so the desktop can render them. It answers ``404`` when no job with that id is registered (already finished and cleaned up, or never existed).

.. CG-EXPLANATION-END id=function:get_cpt_dov_stream

Function ``async def list_cpts``
--------------------------------

.. CG-BLOCK id=function:list_cpts lines=538-598

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 538-598
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_cpts

**What this does.** The handler for ``GET /cpt/`` — return a lightweight summary row for each CPT (id, name, type, depth, location, elevation, start date), optionally filtered to one project. It validates the project id, asks the repository for the rows, and maps each to a ``CptListItem``.

**Why it is here.** A *repository* is the layer that reads and writes database rows so the endpoint never builds SQL itself (``docs/api.md``: every read and write goes through the ORM; there is no raw-SQL surface). The comment on ``start_date`` records a data-integrity choice: the file date is a raw text value written by the parser and is passed through untouched, never re-parsed here — the frontend normalises it, because a pass-through measurement must not be silently re-expressed (Data Integrity Rule 2).

.. CG-EXPLANATION-END id=function:list_cpts

Function ``def _cpt_response``
------------------------------

.. CG-BLOCK id=function:_cpt_response lines=599-634

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 599-634
   :lineno-match:

.. CG-EXPLANATION-START id=function:_cpt_response

**What this does.** A small private helper that copies a loaded CPT database row into the ``CptResponse`` schema — the shape returned to the client — field by field.

**Why it is here.** It is shared by ``get_cpt`` and ``patch_cpt_elevation`` (extracted on the second copy, per the project's don't-repeat rule) so adding a CPT header column is a one-place edit. The database row and the response schema are kept as separate shapes so the internal storage can change without changing the web contract.

.. CG-EXPLANATION-END id=function:_cpt_response

Function ``async def get_cpt``
------------------------------

.. CG-BLOCK id=function:get_cpt lines=635-668

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 635-668
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_cpt

**What this does.** The handler for ``GET /cpt/{cpt_id}`` — return the full header for one CPT. It requires a ``project_id`` query parameter, loads the row through the shared ``get_in_project_or_404`` guard, and returns the response schema.

**Why it is here.** This is the *project-scope guard* the API contract mandates on every single-resource by-id endpoint (``docs/api.md``; CLAUDE.md notes auth on by-id endpoints as debt #4). A *query parameter* is a value tacked onto the end of the web address after a ``?``. Requiring the project id and answering ``404`` ("not found") when the id does not belong to that project stops a caller from probing ids to discover data in other projects — the docstring labels this the cross-project id-enumeration guard (VULN-1).

.. CG-EXPLANATION-END id=function:get_cpt

Function ``async def patch_cpt_elevation``
------------------------------------------

.. CG-BLOCK id=function:patch_cpt_elevation lines=669-728

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 669-728
   :lineno-match:

.. CG-EXPLANATION-START id=function:patch_cpt_elevation

**What this does.** The handler for ``PATCH /cpt/{cpt_id}/elevation`` — set (or clear) the manually-entered ground-surface elevation of a CPT. It logs the request, runs the project-scope guard, writes the elevation through the repository, marks any dependent cached geometry stale in the SAME transaction, commits, and returns the updated header.

**Why it is here.** A *PATCH* is the HTTP method for a partial update — change these fields, leave the rest. The desktop's elevation editor calls this to fill in a missing Z for a row that arrived without one; setting it to null returns the row to the "needs Z" state so a typo can be undone. The comment explains why the cache-staling is in the same transaction (debt #34): a contact's absolute height is elevation minus depth, so moving the elevation invalidates every cached surface and 3-D solid anchored on this CPT, and flipping them stale atomically makes the viewer show "needs rebuild" instead of rendering stale geometry as fresh. The full response is returned so the desktop can refresh its cache without a second request.

.. CG-EXPLANATION-END id=function:patch_cpt_elevation

Function ``async def patch_cpt_water_table``
--------------------------------------------

.. CG-BLOCK id=function:patch_cpt_water_table lines=729-786

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 729-786
   :lineno-match:

.. CG-EXPLANATION-START id=function:patch_cpt_water_table

**What this does.** The handler for ``PATCH /cpt/{cpt_id}/water-table`` — set or clear the engineer's depth to groundwater for a CPT. It logs, runs the scope guard, writes the value, commits, and returns the updated header. Unlike the elevation patch, it stales no cached geometry.

**Why it is here.** The docstring records the domain reasoning: setting a depth stamps the source as ENGINEER, which a later re-import will not overwrite, because the whole Robertson normalisation hangs off this number and engineer judgement outranks a re-parse (Data Integrity Rule 1: provenance is tracked). The first override snapshots the file's value, so sending null restores it. No geometry is staled because the water table only moves values derived when read (the Ic curve, the SBT strips), not the depths the engineer already committed — re-deriving those is his gesture to make.

.. CG-EXPLANATION-END id=function:patch_cpt_water_table

Function ``async def delete_cpt``
---------------------------------

.. CG-BLOCK id=function:delete_cpt lines=787-829

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 787-829
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_cpt

**What this does.** The handler for ``DELETE /cpt/{cpt_id}`` — remove a CPT and its series. It logs, runs the scope guard, drops the CPT's review row first, deletes the CPT, commits, and answers ``204 No Content``.

**Why it is here.** ``204 No Content`` is the status for a successful action with nothing to return. The comment explains why the review row is dropped first (debt #21): the review table has no database-side foreign key to the CPT, so without this the review row would dangle and show up as an orphan in the saved project bundle. The scope guard is here for the same id-enumeration protection as the read endpoints — the ``404`` side effect on a foreign id is the whole point.

.. CG-EXPLANATION-END id=function:delete_cpt

Function ``def _plot_response_from_cpt``
----------------------------------------

.. CG-BLOCK id=function:_plot_response_from_cpt lines=830-891

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 830-891
   :lineno-match:

.. CG-EXPLANATION-START id=function:_plot_response_from_cpt

**What this does.** A private helper that builds the ``CptPlotResponse`` (the depth-series arrays for charting) from a CPT row whose series is loaded. It raises a clear error when the series is missing, then derives the Ic curve and the corrected cone resistance qt on the spot and packages them with the raw arrays.

**Why it is here.** Ic and qt are *derived on read* — computed fresh each time and never stored (Data Integrity Rule 1: never invent or freeze a value that can be recomputed). The comments record two consistency decisions: Ic now comes from the same Robertson 2015/2009 path the litho segmenter uses, so the chart and the ghost boundaries no longer disagree at zone edges (debt #22); and when no water table was recorded the ONE project-wide assumption is shared with the segmenter and the SBT endpoint via ``resolve_gwt``, because two different defaults would put the curve the engineer validates and the boundaries he is offered on different effective-stress profiles. qt returns nothing when any input is missing — it never invents a value. It is shared by the single and batch plot endpoints (extracted on the second copy).

.. CG-EXPLANATION-END id=function:_plot_response_from_cpt

Function ``async def get_cpt_plot``
-----------------------------------

.. CG-BLOCK id=function:get_cpt_plot lines=892-928

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 892-928
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_cpt_plot

**What this does.** The handler for ``GET /cpt/{cpt_id}/plot`` — return the raw depth-series arrays plus the derived Ic curve for one CPT. It runs the scope guard, then builds the plot response, turning a missing series into a ``404``.

**Why it is here.** Same project-scope guard as the other by-id endpoints (VULN-4). It reuses the shared builder so the single and batch plot paths always produce the same shape; a missing series is the one case the single endpoint can answer with a clean ``404`` (the batch path drops it silently instead).

.. CG-EXPLANATION-END id=function:get_cpt_plot

Function ``async def get_cpt_sbt_profile``
------------------------------------------

.. CG-BLOCK id=function:get_cpt_sbt_profile lines=929-1027

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 929-1027
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_cpt_sbt_profile

**What this does.** The handler for ``GET /cpt/{cpt_id}/sbt-profile`` — return, for one CPT, both Robertson soil-behaviour-type classifications per depth point: the stress-normalised one and the non-normalised one, side by side, plus which water table was used. It accepts two soil unit-weight query parameters (bounded to sensible ranges), runs the scope guard, and computes the profile under the same effective-stress assumptions the litho segmenter uses.

**Why it is here.** The two strips let the engineer see where stress-normalisation changes the answer (owner ruling, dogfeed 2026-08-03). The docstring stresses that the unit weights and water table MUST match the segmenter's, because moving a unit weight moves the normalised zones, and a mismatch would wrongly blame that shift on normalisation — so the defaults and bounds mirror the segmenter's and read the same domain constants. The response records which water table it used and where the number came from (Data Integrity Rule 1). The comment on the query-parameter defaults records a subtle point: a plain default is used rather than a wrapped ``Query`` default because the parity test calls this handler directly, bypassing the framework's parameter resolution. Nothing is stored; the profile is derived on read. Classification here is a characterisation output, within MVP scope. Method: Robertson (2009/2010/2015).

.. CG-EXPLANATION-END id=function:get_cpt_sbt_profile

Function ``async def post_cpt_plot_batch``
------------------------------------------

.. CG-BLOCK id=function:post_cpt_plot_batch lines=1028-1073

.. literalinclude:: ../../../src/groundmodel/api/routers/cpt.py
   :language: python
   :lines: 1028-1073
   :lineno-match:

.. CG-EXPLANATION-START id=function:post_cpt_plot_batch

**What this does.** The handler for ``POST /cpt/plot-batch`` — fetch the plot data for many CPTs in one request. It logs the count, loads the rows with their series in one query, builds a plot response for each, silently skipping any with no series, and returns the list.

**Why it is here.** The cross-section panel folds one request per in-buffer CPT into a single round-trip. Unknown ids and series-less CPTs are dropped from the reply rather than erroring, because the caller's draw path already checks "plot data exists" before drawing, so a missing row is indistinguishable from "not yet imported". The 500-id cap named in the docstring guards against a runaway caller flooding the API with one giant batch.

.. CG-EXPLANATION-END id=function:post_cpt_plot_batch

