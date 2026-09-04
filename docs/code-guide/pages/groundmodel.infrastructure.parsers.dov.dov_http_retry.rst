groundmodel.infrastructure.parsers.dov.dov_http_retry
=====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing the retry-and-back-off handling for DOV requests, then the imports, and a small type alias for an injectable sleep function.

**Why it is here.** DOV answers a per-address rate limit with status 429 and a brief outage with 503. Before this file, either of those aborted an otherwise-fine import. Two mechanisms live here: a get-with-retry wrapper that rides out a throttle, and a small state object that halves the download concurrency the first time a 429 is seen so a throttled import backs itself off rather than provoking more refusals. The sleep function is injectable so tests can drive the back-off schedule without actually waiting.

.. CG-EXPLANATION-END id=module-header

Class ``DovRateLimitState`` — header
------------------------------------

.. CG-BLOCK id=class:DovRateLimitState lines=47-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py
   :language: python
   :lines: 47-67
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovRateLimitState

**What this does.** A small per-import record of the download concurrency to use and whether a throttle has been seen yet.

**Why it is here.** One of these is created per import and threaded through the request and download layers, so a 429 seen anywhere in the import can trim the concurrency for the rest of it. It is deliberately simple and single-threaded, which is safe because all this async work runs on one thread.

.. CG-EXPLANATION-END id=class:DovRateLimitState

Method ``DovRateLimitState``. ``def note_throttle``
---------------------------------------------------

.. CG-BLOCK id=method:DovRateLimitState.note_throttle lines=68-89

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py
   :language: python
   :lines: 68-89
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovRateLimitState.note_throttle

**What this does.** Records that DOV rate-limited the import and halves the download concurrency — but only the first time, never below one.

**Why it is here.** Doing it only once stops a burst of 429s from spiralling the concurrency down to nothing. It logs the reduction so the slow-down is visible in the log.

.. CG-EXPLANATION-END id=method:DovRateLimitState.note_throttle

Function ``def _parse_retry_after``
-----------------------------------

.. CG-BLOCK id=function:_parse_retry_after lines=90-105

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py
   :language: python
   :lines: 90-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:_parse_retry_after

**What this does.** Reads a server's ``Retry-After`` header when it is a plain number of seconds, returning "nothing" otherwise.

**Why it is here.** DOV sends this header as seconds in practice, so the date form is deliberately not parsed — the exponential back-off simply takes over in that case, avoiding a date parser for a case that does not arise.

.. CG-EXPLANATION-END id=function:_parse_retry_after

Function ``def _retry_delay``
-----------------------------

.. CG-BLOCK id=function:_retry_delay lines=106-122

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py
   :language: python
   :lines: 106-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:_retry_delay

**What this does.** Works out how long to wait before the next attempt: the server's requested delay when it gave one, otherwise a delay that doubles each attempt — and either way capped at a maximum.

**Why it is here.** The cap matters for safety: a hostile or mis-set ``Retry-After: 86400`` must not be allowed to freeze an import for a day.

.. CG-EXPLANATION-END id=function:_retry_delay

Function ``async def dov_get_with_retry``
-----------------------------------------

.. CG-BLOCK id=function:dov_get_with_retry lines=123-193

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py
   :language: python
   :lines: 123-193
   :lineno-match:

.. CG-EXPLANATION-START id=function:dov_get_with_retry

**What this does.** Fetches a URL, and if the reply is a throttle (429/503) it waits and retries up to a small limit, honouring the server's requested delay. A normal reply — success or a genuine error — is handed straight back on the first try, and network errors are not retried at all.

**Why it is here.** By returning a non-throttle reply untouched, it leaves the caller's own success and error handling exactly as it was — this wrapper only adds the riding-out of a temporary throttle. When all retries are used up it returns the last throttled reply so the caller's normal error path reports it with full context.

.. CG-EXPLANATION-END id=function:dov_get_with_retry

