groundmodel.infrastructure.parsers.dov.dov_wfs_request
======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_wfs_request.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_wfs_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_request.py
   :language: python
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring, then the imports for the two shared functions that make the actual WFS web requests — a count request and a features request.

**Why it is here.** Five DOV clients share the same request shape and differ only in their layer name, optional filter, and how they build rows. Centralising the HTTP, the JSON reading, and the error logging here means a DOV rule change is fixed once, not five times — the docstring records that exactly this bit them in 2026 when DOV changed a rule without warning.

.. CG-EXPLANATION-END id=module-header

Function ``async def wfs_count``
--------------------------------

.. CG-BLOCK id=function:wfs_count lines=42-124

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_request.py
   :language: python
   :lines: 42-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:wfs_count

**What this does.** Asks DOV how many features match a rectangle (and optional filter) and returns that count. It reads the count out of the reply with a small pattern, logs the outcome with size and timing, and returns zero (with an error log) if the count cannot be found.

**Why it is here.** The count is the cheap question the recursive split leans on before fetching anything. Returning zero rather than crashing on a missing count is a defensive choice — a zero result keeps the split running rather than sinking the whole import. Logging the reply size and latency matters because DOV imports are slow in proportion to payload size, so those numbers are the "why was this slow" signal.

.. CG-EXPLANATION-END id=function:wfs_count

Function ``async def wfs_features_json``
----------------------------------------

.. CG-BLOCK id=function:wfs_features_json lines=125-182

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_request.py
   :language: python
   :lines: 125-182
   :lineno-match:

.. CG-EXPLANATION-START id=function:wfs_features_json

**What this does.** Fetches the actual features in a rectangle and returns them as a list of property bags, logging the reply's size, timing, and feature count.

**Why it is here.** Each caller turns these raw features into its own typed rows, because the field names and skip reasons differ per kind — so this shared function stops at handing back the raw list. The size and timing on the log line are again the load-bearing performance signal.

.. CG-EXPLANATION-END id=function:wfs_features_json

Function ``def _build_params``
------------------------------

.. CG-BLOCK id=function:_build_params lines=183-226

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_request.py
   :language: python
   :lines: 183-226
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_params

**What this does.** Builds the shared set of query parameters for a WFS request. When there is no attribute filter it adds a plain rectangle parameter; when there is one, it folds the rectangle into the filter string instead. Either way it first sorts the rectangle corners so the minimum is really the minimum.

**Why it is here.** DOV forbids sending both a rectangle parameter and a filter together, so the rectangle has to move inside the filter when a filter is present. The corner-sorting fixes a subtle bug: after the map projection, a very thin rectangle can end up with its south corner a few centimetres north of its north corner, and DOV's validator rejects that with an error — sorting once here covers both request shapes.

.. CG-EXPLANATION-END id=function:_build_params

