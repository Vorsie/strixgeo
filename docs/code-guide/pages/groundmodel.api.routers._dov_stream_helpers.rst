groundmodel.api.routers._dov_stream_helpers
===========================================

.. CG-PAGE source=src/groundmodel/api/routers/_dov_stream_helpers.py complete=true

*Source file:* ``src/groundmodel/api/routers/_dov_stream_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the file, then imports of the JSON tool, the streaming-reply type, the web-error types, the network-error classes from ``httpx``, and two custom exceptions. It also names the ``httpx`` error classes to catch and two error codes.

**Why it is here.** The CPT and borehole DOV importers carried the identical four network-failure arms in two forms (an error reply for the direct endpoint, an error event for the background-stream path) plus the identical stream plumbing; per the don't-repeat rule they converge here. The comment notes both ``httpx`` error classes are needed because one is not a subclass of the other.

.. CG-EXPLANATION-END id=module-header

Function ``def dov_import_job_key``
-----------------------------------

.. CG-BLOCK id=function:dov_import_job_key lines=46-82

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 46-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:dov_import_job_key

**What this does.** Builds the de-duplication key for a streaming DOV import from the resource kind, the project, and the rectangle corners (rounded to about 0.1 m).

**Why it is here.** The key is how a second identical import launched while the first is still running is refused. Rounding the corners means a redraw with tiny floating-point noise still counts as the same box, and the kind prefix keeps a CPT import and a borehole import of the same box in separate scopes.

.. CG-EXPLANATION-END id=function:dov_import_job_key

Function ``def map_dov_too_large_error``
----------------------------------------

.. CG-BLOCK id=function:map_dov_too_large_error lines=83-90

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 83-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:map_dov_too_large_error

**What this does.** Maps a "too many records in this box" refusal to a ``422`` for the direct import endpoint.

**Why it is here.** Discovery found more records than the import ceiling, so the request is refused before any download starts rather than running away.

.. CG-EXPLANATION-END id=function:map_dov_too_large_error

Function ``def dov_too_large_event``
------------------------------------

.. CG-BLOCK id=function:dov_too_large_event lines=91-95

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 91-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:dov_too_large_event

**What this does.** Maps the same too-many-records refusal to a terminal error event for the streaming path.

**Why it is here.** The streaming path reports failures as events on its queue, not as a raised reply, so the same refusal needs this second form (the shared error code keeps the two paths consistent).

.. CG-EXPLANATION-END id=function:dov_too_large_event

Function ``def map_duplicate_import_job``
-----------------------------------------

.. CG-BLOCK id=function:map_duplicate_import_job lines=96-107

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 96-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:map_duplicate_import_job

**What this does.** Maps a "an import for this scope is already running" refusal to a ``409`` that carries the running job's id.

**Why it is here.** Handing back the existing job id lets the client attach to the running stream instead of starting a competing import.

.. CG-EXPLANATION-END id=function:map_duplicate_import_job

Function ``def _dov_error_message``
-----------------------------------

.. CG-BLOCK id=function:_dov_error_message lines=108-162

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 108-162
   :lineno-match:

.. CG-EXPLANATION-START id=function:_dov_error_message

**What this does.** Logs a DOV network failure on the server and returns the pair (HTTP status, user-facing message): a timeout becomes ``504``, a connect failure ``503``, and any other upstream error ``502``.

**Why it is here.** The user-facing message carries only the failure category and, when safe, the upstream status; the library class names and full messages are logged on the server only, so debugging stays possible without leaking dependency versions or internal topology to a future untrusted caller (debt #43). The order of checks matches the original, specific-before-general.

.. CG-EXPLANATION-END id=function:_dov_error_message

Function ``def map_dov_upstream_error``
---------------------------------------

.. CG-BLOCK id=function:map_dov_upstream_error lines=163-193

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 163-193
   :lineno-match:

.. CG-EXPLANATION-START id=function:map_dov_upstream_error

**What this does.** The direct-endpoint wrapper: it calls the shared classifier and returns the ready-to-raise web error.

**Why it is here.** The synchronous importers catch the DOV errors and re-raise this, so the traceback survives and the status mapping lives in one place.

.. CG-EXPLANATION-END id=function:map_dov_upstream_error

Function ``def dov_error_event``
--------------------------------

.. CG-BLOCK id=function:dov_error_event lines=194-223

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 194-223
   :lineno-match:

.. CG-EXPLANATION-START id=function:dov_error_event

**What this does.** The streaming-path wrapper: it calls the shared classifier and returns an error event to put on the queue instead of raising.

**Why it is here.** The background import reports failure by placing this event on its queue, so the same classification serves both the direct and the streaming paths.

.. CG-EXPLANATION-END id=function:dov_error_event

Function ``async def sse_from_registry``
----------------------------------------

.. CG-BLOCK id=function:sse_from_registry lines=224-245

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 224-245
   :lineno-match:

.. CG-EXPLANATION-START id=function:sse_from_registry

**What this does.** Reads a running job's events one by one and yields each as a *server-sent-events* frame (``data: <json>``).

**Why it is here.** Server-sent events is the one-way channel that streams the job's progress to the browser; this is the shared generator both import routers use to format those frames.

.. CG-EXPLANATION-END id=function:sse_from_registry

Function ``def dov_sse_stream_response``
----------------------------------------

.. CG-BLOCK id=function:dov_sse_stream_response lines=246-282

.. literalinclude:: ../../../src/groundmodel/api/routers/_dov_stream_helpers.py
   :language: python
   :lines: 246-282
   :lineno-match:

.. CG-EXPLANATION-START id=function:dov_sse_stream_response

**What this does.** Builds the streaming reply for a registered import job: it answers ``404`` when no job with that id exists, otherwise returns the event stream with caching and proxy-buffering turned off.

**Why it is here.** It wraps the not-found guard and the stream construction shared by the CPT and borehole stream endpoints. Buffering is disabled so events reach the client immediately rather than being held back by an intermediary.

.. CG-EXPLANATION-END id=function:dov_sse_stream_response

