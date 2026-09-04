groundmodel.infrastructure.parsers.dov.dov_wfs_download
=======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_wfs_download.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_wfs_download.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_download.py
   :language: python
   :lines: 1-67
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring, then the imports for a shared helper that downloads many DOV XML files at once, checking the cache first and parsing each as it arrives.

**Why it is here.** Three DOV clients followed the same download pattern after their rectangle scan finished, and each carried a 50-line copy of it — so every change to the cache check, the concurrency limit, or the error wording had to be made three times, and the last time it was, one copy was fixed days after the others. This helper is the single copy they all now share; the caller passes in the rows, the cache, and small functions for the per-row URL, key, and error label.

.. CG-EXPLANATION-END id=module-header

Function ``def classify_download_failure``
------------------------------------------

.. CG-BLOCK id=function:classify_download_failure lines=68-94

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_download.py
   :language: python
   :lines: 68-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:classify_download_failure

**What this does.** Labels a per-row failure as one of three kinds: a network/HTTP failure, a crashed parse-worker process, or a bad XML.

**Why it is here.** Each kind points at a different fix — retry or check the endpoint; reduce concurrency or investigate a crashing worker; or chase a malformed document or a schema change — so naming the kind in the log turns a raw error into a pointer at the right next step.

.. CG-EXPLANATION-END id=function:classify_download_failure

Function ``async def parallel_download_and_process``
----------------------------------------------------

.. CG-BLOCK id=function:parallel_download_and_process lines=95-241

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_download.py
   :language: python
   :lines: 95-241
   :lineno-match:

.. CG-EXPLANATION-START id=function:parallel_download_and_process

**What this does.** Downloads every row's XML in parallel, up to a set concurrency, running a parse on each. It checks the cache before taking a concurrency slot, writes fresh downloads back to the cache, runs the parse outside the slot so a freed slot starts the next download, and reports progress. It returns each row paired with its parse result, dropping and logging the rows that failed, and finishes with a cache hit/miss summary.

**Why it is here.** Checking the cache before the concurrency slot means a cheap disk read never has to queue behind the network. Running the parse outside the slot is what lets parse work overlap the next download. Catching each row's failure separately means one bad file cannot sink the whole batch, and the rate-limit state is threaded through so a throttle slows the whole run down.

.. CG-EXPLANATION-END id=function:parallel_download_and_process

Function ``async def _download_one``
------------------------------------

.. CG-BLOCK id=function:_download_one lines=242-384

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_download.py
   :language: python
   :lines: 242-384
   :lineno-match:

.. CG-EXPLANATION-START id=function:_download_one

**What this does.** Handles one row: check the cache, and on a miss take a concurrency slot and download (with throttle-retry), writing the result back to the cache; then parse. If a *cached* file fails to parse it throws that entry away and re-fetches once from the network; if a *fresh* download fails to parse it gives up on that row.

**Why it is here.** The difference in handling is deliberate: a cached file that will not parse may simply have rotted on disk (a flipped bit, a truncated write) while the real DOV document is fine, so it is worth one fresh try — but a fresh document that will not parse is a genuine bad file and retrying it would just fail again. This lives as its own top-level function, rather than nested, so each parallel task carries only its own arguments.

.. CG-EXPLANATION-END id=function:_download_one

