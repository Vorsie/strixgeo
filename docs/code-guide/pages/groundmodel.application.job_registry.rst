groundmodel.application.job_registry
====================================

.. CG-PAGE source=src/groundmodel/application/job_registry.py complete=true

*Source file:* ``src/groundmodel/application/job_registry.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-77

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 1-77
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the job-registry file. It imports asyncio, threading and time, the duplicate-job error and the logger, and defines three tuning limits — the per-job event cap, the finished-job time-to-live, and the maximum number of jobs. Its docstring describes the registry's lifecycle and the resource bounds it enforces.

**Why it is here.** The registry lets a long-running import run in the background while a separate progress-stream endpoint drains its events (a server-sent-event stream, or SSE — a one-way channel of progress messages to the desktop) without sharing a database session with the request that started it. The three limits close three unbounded-growth holes found in an audit: a never-attached consumer buffering events forever, a finished-but-unconsumed job sitting in the registry forever, and the total job count growing without limit.

.. CG-EXPLANATION-END id=module-header

Class ``_BoundedJobQueue`` — header
-----------------------------------

.. CG-BLOCK id=class:_BoundedJobQueue lines=78-93

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 78-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:_BoundedJobQueue

**What this does.** A first-in-first-out event channel for one job that never blocks the producer: when it is full a new progress event evicts the oldest, but the end-of-stream marker is never evicted.

**Why it is here.** The import task must not stall on an absent or slow consumer, and a progress bar only needs the latest tick, so dropping the oldest progress events under pressure loses nothing that matters while bounding memory. The end-of-stream marker (a special nothing value, the sentinel) is protected so the consumer always learns the job ended.

.. CG-EXPLANATION-END id=class:_BoundedJobQueue

Method ``_BoundedJobQueue``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:_BoundedJobQueue.__init__ lines=94-101

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 94-101
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoundedJobQueue.__init__

**What this does.** Creates the underlying queue, records the size cap, and starts a dropped-event counter at zero.

**Why it is here.** The counter is a diagnostic hook so a test (or a log line) can prove eviction happened.

.. CG-EXPLANATION-END id=method:_BoundedJobQueue.__init__

Method ``_BoundedJobQueue``. ``def _make_room``
-----------------------------------------------

.. CG-BLOCK id=method:_BoundedJobQueue._make_room lines=102-123

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 102-123
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoundedJobQueue._make_room

**What this does.** Evicts the oldest droppable events until there is room for a new one, never evicting the end-of-stream marker and putting one back if it is reached.

**Why it is here.** The marker is normally the last item enqueued, so it is rarely reached; the belt-and-braces put-back guarantees it is never lost.

.. CG-EXPLANATION-END id=method:_BoundedJobQueue._make_room

Method ``_BoundedJobQueue``. ``async def put``
----------------------------------------------

.. CG-BLOCK id=method:_BoundedJobQueue.put lines=124-128

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 124-128
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoundedJobQueue.put

**What this does.** Makes room if needed, then enqueues the event.

**Why it is here.** The async producer path onto the queue.

.. CG-EXPLANATION-END id=method:_BoundedJobQueue.put

Method ``_BoundedJobQueue``. ``def put_nowait``
-----------------------------------------------

.. CG-BLOCK id=method:_BoundedJobQueue.put_nowait lines=129-133

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 129-133
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoundedJobQueue.put_nowait

**What this does.** The synchronous enqueue used by the done-callback to inject the end-of-stream marker.

**Why it is here.** The done-callback runs outside an async context, so it needs a non-awaiting enqueue.

.. CG-EXPLANATION-END id=method:_BoundedJobQueue.put_nowait

Method ``_BoundedJobQueue``. ``async def get``
----------------------------------------------

.. CG-BLOCK id=method:_BoundedJobQueue.get lines=134-137

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 134-137
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoundedJobQueue.get

**What this does.** Awaits and returns the next event, or the end-of-stream marker.

**Why it is here.** The consumer path off the queue.

.. CG-EXPLANATION-END id=method:_BoundedJobQueue.get

Method ``_BoundedJobQueue``. ``def qsize``
------------------------------------------

.. CG-BLOCK id=method:_BoundedJobQueue.qsize lines=138-142

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 138-142
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoundedJobQueue.qsize

**What this does.** Returns the number of buffered events.

**Why it is here.** Used by the room-making logic and by tests.

.. CG-EXPLANATION-END id=method:_BoundedJobQueue.qsize

Class ``_JobEntry``
-------------------

.. CG-BLOCK id=class:_JobEntry lines=143-181

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 143-181
   :lineno-match:

.. CG-EXPLANATION-START id=class:_JobEntry

**What this does.** A dataclass holding one background job's bookkeeping: its running task, its event queue, its de-duplication key, when it was created and finished, whether a consumer attached, and an optional cancel flag.

**Why it is here.** The docstring records why each field exists: the created and finished times drive eviction ordering and the time-to-live sweep; the consumed flag limits the sweep to never-consumed jobs; and the cancel flag is a threading event (not an asyncio one) because the worker that checks it runs on a different thread from the code that sets it.

.. CG-EXPLANATION-END id=class:_JobEntry

Class ``JobRegistry`` — header
------------------------------

.. CG-BLOCK id=class:JobRegistry lines=182-205

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 182-205
   :lineno-match:

.. CG-EXPLANATION-START id=class:JobRegistry

**What this does.** The in-process registry mapping a job id to its live entry, held as a module singleton. A singleton is a single shared instance for the whole process.

**Why it is here.** A singleton so any router function can resolve the same registry; it is accessed only from coroutines on one event loop, so no locking is needed. It carries an injectable clock so tests can drive the time-to-live sweep with a fake time source.

.. CG-EXPLANATION-END id=class:JobRegistry

Method ``JobRegistry``. ``def __init__``
----------------------------------------

.. CG-BLOCK id=method:JobRegistry.__init__ lines=206-214

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 206-214
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry.__init__

**What this does.** Starts with empty job and active-key maps and stores the time source.

**Why it is here.** The active-key map is a reverse index kept in step with the jobs so a duplicate submission can be refused.

.. CG-EXPLANATION-END id=method:JobRegistry.__init__

Method ``JobRegistry``. ``def start``
-------------------------------------

.. CG-BLOCK id=method:JobRegistry.start lines=215-311

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 215-311
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry.start

**What this does.** Sweeps expired jobs, refuses a duplicate still-running key, enforces the job cap, then allocates a job id, builds the bounded queue, launches the background task, registers the entry, and wires a done-callback.

**Why it is here.** The caller passes a factory (not a coroutine) so the queue is built first and threaded in. A live duplicate key is refused with the running job's id so the caller can attach to the existing stream instead of starting a second identical import. The done-callback stamps the finish time, releases the key, and — crucially — injects the end-of-stream marker when the task raised before enqueuing it, so the consumer is never left waiting forever.

.. CG-EXPLANATION-END id=method:JobRegistry.start

Method ``JobRegistry``. ``def request_cancel``
----------------------------------------------

.. CG-BLOCK id=method:JobRegistry.request_cancel lines=312-343

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 312-343
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry.request_cancel

**What this does.** Sets a running job's cooperative cancel flag, returning whether a cancellable job was found.

**Why it is here.** The worker thread of a voxel build cannot be forcibly killed, so this cooperative flag it polls between phases is the only way to stop it; it is best-effort and idempotent, so a double-click on Cancel is harmless.

.. CG-EXPLANATION-END id=method:JobRegistry.request_cancel

Method ``JobRegistry``. ``def _sweep_expired``
----------------------------------------------

.. CG-BLOCK id=method:JobRegistry._sweep_expired lines=344-364

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 344-364
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry._sweep_expired

**What this does.** Evicts finished, never-consumed jobs older than the time-to-live.

**Why it is here.** A job whose progress stream never attached would otherwise sit in the registry forever; a consumed job is cleaned up by the stream itself, so only never-consumed ones are swept.

.. CG-EXPLANATION-END id=method:JobRegistry._sweep_expired

Method ``JobRegistry``. ``def _enforce_job_cap``
------------------------------------------------

.. CG-BLOCK id=method:JobRegistry._enforce_job_cap lines=365-378

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 365-378
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry._enforce_job_cap

**What this does.** Evicts the best victim repeatedly until the registry has room below the cap.

**Why it is here.** Called before registering a new job so the registry never exceeds the cap; a finished entry is preferred as the victim, and only when all are still running is the oldest cancelled — a last-resort guard against a leak.

.. CG-EXPLANATION-END id=method:JobRegistry._enforce_job_cap

Method ``JobRegistry``. ``def _pick_eviction_victim``
-----------------------------------------------------

.. CG-BLOCK id=method:JobRegistry._pick_eviction_victim lines=379-390

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 379-390
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry._pick_eviction_victim

**What this does.** Returns the oldest finished job, or the oldest of any kind when none has finished.

**Why it is here.** A finished job's work is done, so it is the safest thing to drop.

.. CG-EXPLANATION-END id=method:JobRegistry._pick_eviction_victim

Method ``JobRegistry``. ``def _evict``
--------------------------------------

.. CG-BLOCK id=method:JobRegistry._evict lines=391-401

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 391-401
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry._evict

**What this does.** Removes a job, cancelling its task if still running and releasing its key.

**Why it is here.** The single place that tears down an entry so the job and key maps never drift apart.

.. CG-EXPLANATION-END id=method:JobRegistry._evict

Method ``JobRegistry``. ``async def stream``
--------------------------------------------

.. CG-BLOCK id=method:JobRegistry.stream lines=402-456

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 402-456
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry.stream

**What this does.** Drains a job's queue as an async generator of events, returning when the end-of-stream marker arrives, and on an early client disconnect cancelling the still-running background task.

**Why it is here.** An async generator is a function that yields values one at a time as they arrive. Marking the entry consumed keeps the time-to-live sweep off it. Cancelling on an early disconnect stops an abandoned stream from running a long cold-cache import to completion server-side (issue #237.3); it is gated on the task not being done, so closing the stream right after the final event never cancels a completed task. XML already written to the on-disk cache is preserved, so a re-import is cache-warm.

.. CG-EXPLANATION-END id=method:JobRegistry.stream

Method ``JobRegistry``. ``def __len__``
---------------------------------------

.. CG-BLOCK id=method:JobRegistry.__len__ lines=457-464

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 457-464
   :lineno-match:

.. CG-EXPLANATION-START id=method:JobRegistry.__len__

**What this does.** Returns the number of registered jobs.

**Why it is here.** A convenience so the cap logic and tests can read the size.

.. CG-EXPLANATION-END id=method:JobRegistry.__len__

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=465-467

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 465-467
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Creates the module-level registry singleton.

**Why it is here.** One instance per process, shared by all router functions on the same event loop; a test that needs isolation replaces it.

.. CG-EXPLANATION-END id=module-statements

Function ``def get_job_registry``
---------------------------------

.. CG-BLOCK id=function:get_job_registry lines=468-478

.. literalinclude:: ../../../src/groundmodel/application/job_registry.py
   :language: python
   :lines: 468-478
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_job_registry

**What this does.** Returns the module-level registry singleton.

**Why it is here.** Provided as a dependency the web layer injects so a route resolves the shared registry.

.. CG-EXPLANATION-END id=function:get_job_registry

