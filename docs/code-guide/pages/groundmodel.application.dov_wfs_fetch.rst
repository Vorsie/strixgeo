groundmodel.application.dov_wfs_fetch
=====================================

.. CG-PAGE source=src/groundmodel/application/dov_wfs_fetch.py complete=true

*Source file:* ``src/groundmodel/application/dov_wfs_fetch.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/application/dov_wfs_fetch.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A small shared module. Its docstring explains that every DOV import wraps its bbox fetch in the identical try-and-log-then-re-raise block, so this module centralises that block.

**Why it is here.** Centralising it means the error wording and the network-to-HTTP-status mapping cannot drift across the CPT, borehole, sample, grain-size and interpretation imports (debt #198) — the ``don't repeat logic`` rule. The per-phase timing and success logs stay in each caller because they differ per phase.

.. CG-EXPLANATION-END id=module-header

Function ``async def fetch_wfs_or_raise``
-----------------------------------------

.. CG-BLOCK id=function:fetch_wfs_or_raise lines=22-65

.. literalinclude:: ../../../src/groundmodel/application/dov_wfs_fetch.py
   :language: python
   :lines: 22-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:fetch_wfs_or_raise

**What this does.** Awaits a DOV fetch and returns its result; on a non-2xx response it logs the status and a truncated body and re-raises, and on a network-level failure it logs the error type and re-raises.

**Why it is here.** Logging the truncated response body makes a failed request debuggable from the log alone without re-running, which is the external-call logging rule in the Definition of Done. It passes the caller's own logger so the log line keeps the caller's module name.

.. CG-EXPLANATION-END id=function:fetch_wfs_or_raise

