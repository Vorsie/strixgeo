desktop.main.diagnosticsUploaderConstants
=========================================

.. CG-PAGE source=desktop/src/main/diagnosticsUploaderConstants.ts complete=false

*Source file:* ``desktop/src/main/diagnosticsUploaderConstants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is nothing but a labelled set of tuning dials for
the diagnostics uploader — the endpoint path, the size cap, the queue limit, the
retry timing, and how often to try sending. The header comment explains that they
live together here rather than being scattered inline in the logic.

**Why it is here.** Gathering every number in one place means each value is a
single source of truth, and a reviewer can read the whole "how we transmit"
policy at a glance without opening the working code — which follows the project's
rule of naming constants in a dedicated file. It also records that the uploader
sends to the *same* server as activation (owner ruling, 31 August 2026), so the
base web address comes from the activation config and this file only adds the
path suffix and the transmit-side dials.

.. CG-EXPLANATION-END id=module-header

``const DIAGNOSTICS_UPLOAD_PATH``
---------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_UPLOAD_PATH lines=26-35

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 26-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_UPLOAD_PATH

**What this does.** The path added onto the activation web address to reach the
diagnostics endpoint: ``v1/diagnostics``.

**Why it is here.** The comment explains the ``v1`` on purpose: the diagnostics
body is the newest and richest shape of the three sibling endpoints and the most
likely to grow, so it carries its own version number in the path — giving, for
example, ``https://strixgeo.com/api/activation/v1/diagnostics``.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_UPLOAD_PATH

``const DIAGNOSTICS_MAX_PAYLOAD_BYTES``
---------------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_MAX_PAYLOAD_BYTES lines=36-45

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 36-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_MAX_PAYLOAD_BYTES

**What this does.** The hard ceiling on one uploaded bundle: 512 kilobytes of
text.

**Why it is here.** As the comment says, it is far more than any single support
question needs and small enough that a beta tester on a poor connection is never
asked to push a big file. When a bundle would exceed it, the builder drops the
oldest records until it fits and marks the result as truncated.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_MAX_PAYLOAD_BYTES

``const DIAGNOSTICS_QUEUE_MAX``
-------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_QUEUE_MAX lines=46-48

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 46-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_QUEUE_MAX

**What this does.** The most bundles allowed to sit waiting on disk at once: 20.

**Why it is here.** The queue is a durable outbox that survives restarts until a
bundle is sent, refused, or evicted. Bounding it at 20 stops a permanently
offline machine from slowly filling the disk; when a 21st arrives the oldest —
the least useful — is dropped.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_QUEUE_MAX

``const DIAGNOSTICS_QUEUE_DIR_NAME``
------------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_QUEUE_DIR_NAME lines=49-51

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 49-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_QUEUE_DIR_NAME

**What this does.** The name of the sub-folder that holds the queued bundles:
``outbox``.

**Why it is here.** A named folder, next to the diagnostics log, where the
waiting-to-send bundles live.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_QUEUE_DIR_NAME

``const DIAGNOSTICS_HIGHWATER_FILENAME``
----------------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_HIGHWATER_FILENAME lines=52-54

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_HIGHWATER_FILENAME

**What this does.** The name of the little "high-water" file, ``highwater.json``,
that remembers which events have already been queued.

**Why it is here.** It marks the newest event already put into a bundle, so the
same events are never queued a second time on a later launch.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_HIGHWATER_FILENAME

``const DIAGNOSTICS_UPLOAD_TIMEOUT_MS``
---------------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_UPLOAD_TIMEOUT_MS lines=55-63

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 55-63
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_UPLOAD_TIMEOUT_MS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_UPLOAD_TIMEOUT_MS

``const DIAGNOSTICS_RETRY_BASE_MS``
-----------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_RETRY_BASE_MS lines=64-66

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 64-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_RETRY_BASE_MS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_RETRY_BASE_MS

``const DIAGNOSTICS_RETRY_MAX_MS``
----------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_RETRY_MAX_MS lines=67-76

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 67-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_RETRY_MAX_MS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_RETRY_MAX_MS

``const DIAGNOSTICS_DRAIN_INTERVAL_MS``
---------------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_DRAIN_INTERVAL_MS lines=77-92

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 77-92
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_DRAIN_INTERVAL_MS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_DRAIN_INTERVAL_MS

``const ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS``
---------------------------------------------------

.. CG-BLOCK id=const:ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS lines=93-93

.. literalinclude:: ../../../desktop/src/main/diagnosticsUploaderConstants.ts
   :language: typescript
   :lines: 93-93
   :lineno-match:

.. CG-EXPLANATION-START id=const:ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS

