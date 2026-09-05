desktop.main.diagnosticsUploader
================================

.. CG-PAGE source=desktop/src/main/diagnosticsUploader.ts complete=true

*Source file:* ``desktop/src/main/diagnosticsUploader.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-61

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploader.ts
   :language: typescript
   :lines: 1-61
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring*) and its ``import`` lines. The note explains that this file is the *transmit* half of diagnostics — the capture half writes the redacted NDJSON log the user owns, and this file sends that log to the strixgeo.com server. It sets out the mechanism: each upload is queued on disk as one JSON file in an ``outbox/`` folder next to the log, drained oldest-first over the same HTTP plumbing the activation client uses; a success (an HTTP 2xx reply) removes a bundle, a client-refusal (4xx) drops it, and a server fault or dead link (5xx or a network failure) keeps it for a later retry. The imports pull in file helpers, a UUID generator, the atomic-write helper, the payload builder, the shared ``postJson`` transport, and the tunables from the constants file.

**Why it is here.** This file runs in Electron's *main process* — the part of the app with full computer access. Its entire behaviour hangs on two gates that never move: nothing is sent unless *consent* is on (the recorded opt-in, whose default is off) AND an endpoint is configured (the same server as activation, per the owner's 31 August 2026 ruling). With either gate closed the uploader is completely inert — it queues nothing and sends nothing, which is the ordinary mock/dogfeed state. It imports only Node built-ins and the global ``fetch`` (never Electron itself), so the automated tests can drive it without a real app running.

.. CG-EXPLANATION-END id=module-header

``interface DrainSummary``
--------------------------

.. CG-BLOCK id=interface:DrainSummary lines=62-73

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploader.ts
   :language: typescript
   :lines: 62-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DrainSummary

**What this does.** Describes what one upload pass reports back (an *interface* is a written description of the fields a value must carry): ``sent`` (bundles accepted and removed), ``dropped`` (bundles refused or unreadable and discarded), ``kept`` (bundles held for a later retry), and ``serverDown`` (true when the pass stopped because the server or link was down).

**Why it is here.** Returning a plain tally of what happened lets the tests check the exact outcome and lets the scheduler decide whether to back off (server was down) or drain again soon (progress was made).

.. CG-EXPLANATION-END id=interface:DrainSummary

``interface DiagnosticsUploaderConfig``
---------------------------------------

.. CG-BLOCK id=interface:DiagnosticsUploaderConfig lines=74-96

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploader.ts
   :language: typescript
   :lines: 74-96
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DiagnosticsUploaderConfig

**What this does.** Describes the settings the uploader is handed: ``queueDir`` (the outbox folder), ``baseUrl`` (the server address, or ``null`` for "no endpoint"), ``consent`` (a function that reads the current opt-in each time it is called), and several optional overrides — a ``fetchImpl`` to use, a per-request ``timeoutMs``, a ``maxQueue`` bound, a ``maxPayloadBytes`` cap, and an ``onLog`` sink.

**Why it is here.** ``baseUrl`` being ``null`` is what makes every method a no-op in the mock/dogfeed default. ``consent`` is a *function* rather than a stored true/false so the live opt-in is re-read at each step and a user turning it off takes effect immediately. The fetch, timeout and bounds are injectable so tests can drive the uploader with a fake network and tiny limits.

.. CG-EXPLANATION-END id=interface:DiagnosticsUploaderConfig

``function isObject``
---------------------

.. CG-BLOCK id=function:isObject lines=97-101

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploader.ts
   :language: typescript
   :lines: 97-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:isObject

**What this does.** A tiny yes/no helper that reports whether a value is a plain JSON object — and not an array or ``null``, both of which the language would otherwise also call an "object".

**Why it is here.** Values read from a file on disk or returned by the server are of unknown shape, so this guard is run before the code reaches into their fields, stopping a stray array or ``null`` from causing a crash.

.. CG-EXPLANATION-END id=function:isObject

``function backoffMs``
----------------------

.. CG-BLOCK id=function:backoffMs lines=102-107

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploader.ts
   :language: typescript
   :lines: 102-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:backoffMs

**What this does.** Computes how long to wait after a run of failed upload passes: it doubles a base delay for each consecutive failure and never exceeds a fixed ceiling.

**Why it is here.** A server fault or a dead link affects every queued bundle equally, so retrying immediately would just repeat the failure; waiting longer after each failure — an *exponential backoff* — spares a down server while still recovering on its own once the link returns.

.. CG-EXPLANATION-END id=function:backoffMs

``function serverIdSuffix``
---------------------------

.. CG-BLOCK id=function:serverIdSuffix lines=108-119

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploader.ts
   :language: typescript
   :lines: 108-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:serverIdSuffix

**What this does.** Builds a short text tail like ``" id=<x>"`` when the server's reply carried an id, and an empty string otherwise. The block also carries the note that leads into the next symbol.

**Why it is here.** When the server echoes its own id for an accepted bundle, printing it in the success log line gives support a shared reference to match the local record against the server's.

.. CG-EXPLANATION-END id=function:serverIdSuffix

``class DiagnosticsUploader``
-----------------------------

.. CG-BLOCK id=class:DiagnosticsUploader lines=120-407

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploader.ts
   :language: typescript
   :lines: 120-407
   :lineno-match:

.. CG-EXPLANATION-START id=class:DiagnosticsUploader

**What this does.** The whole uploader, one instance per app run. It holds the settings, the queue bound, the payload cap, a retry timer, a running flag and a count of consecutive failures. Its private helpers build the upload URL and the high-water path, list the queue files oldest-first (their names begin with a zero-padded time stamp so a plain sort is chronological), read and write the high-water marker (the timestamp of the newest event already queued), evict the oldest files down to the bound, and delete a file. Its public methods are: ``enqueueRecentDiagnostics``, which builds a bundle from only the events newer than the marker and queues it, then advances the marker; ``enqueue``, which writes one payload into the outbox and trims to the bound; ``drainOnce``, which uploads queued bundles oldest-first — removing on a 2xx, dropping on a 4xx or an unparseable file, and keeping-then-stopping on a 5xx or network failure; ``start``, which drains now and then re-drains on a timer while the queue is non-empty; ``stop``, which cancels the timer; and the private ``tick``, one scheduled round that chooses the next delay (the backoff after a failure, the routine cadence after progress, or nothing once the queue empties). Every public method first checks both gates and does nothing if either is closed. Several methods are *async* — they pause with ``await`` while a network reply is on its way, letting the rest of the app keep running in the meantime.

**Why it is here.** This is the automatic sending path, and its whole design serves two promises. First, the consent-and-endpoint gate is checked at the top of every method, so "nothing leaves the machine unless the user opted in and a server is configured" holds no matter which entry point is called. Second, the on-disk queue can never wedge: bundles are durable across restarts, a down server is retried later on a backoff rather than hammered now, and a bundle the server will always refuse (a 4xx) is dropped so it cannot block everything queued behind it forever. The high-water marker stops the same events being queued twice, and the timer goes fully idle when the queue empties, so a healthy machine with nothing to send does no work at all.

.. CG-EXPLANATION-END id=class:DiagnosticsUploader

