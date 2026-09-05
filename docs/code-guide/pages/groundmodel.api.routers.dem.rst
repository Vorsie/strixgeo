groundmodel.api.routers.dem
===========================

.. CG-PAGE source=src/groundmodel/api/routers/dem.py complete=true

*Source file:* ``src/groundmodel/api/routers/dem.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../src/groundmodel/api/routers/dem.py
   :language: python
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring naming the one endpoint, then imports of the network-error types, the router and query types, the DEM sample schemas, the provider factory, settings, the DEM-specific exceptions, and the logger. It makes the ``/dem`` router and caps a request at 2000 samples.

**Why it is here.** A *DEM* (digital elevation model) is the gridded ground-surface height dataset. The one endpoint draws the ground line under a cross-section. The provider is chosen from the coordinate system (Belgian Lambert 72 to the Flemish DHMVII, Dutch RD to AHN4), so an unsupported system returns a clear 400 the desktop can explain. The 2000-sample cap guards against a runaway request asking for a million points.

.. CG-EXPLANATION-END id=module-header

Function ``async def sample_along_line``
----------------------------------------

.. CG-BLOCK id=function:sample_along_line lines=43-179

.. literalinclude:: ../../../src/groundmodel/api/routers/dem.py
   :language: python
   :lines: 43-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:sample_along_line

**What this does.** The handler for ``GET /dem/sample`` — return evenly-spaced elevations along a line given by its two endpoints and coordinate system. It picks the DEM provider from the coordinate system, rejects a zero-length line, samples the line, and maps each failure kind to its own status.

**Why it is here.** The failures are separated deliberately: an impossible extent (section-space coordinates, a non-finite bound, a span past the tile cap) is the caller's bug and is answered ``422`` with the numbers, so the next occurrence is diagnosable from the response alone instead of looking like an outage; a connect error is ``503``, a timeout ``504``, and any other upstream or malformed response ``502``. As with DOV, the user-facing message is category-only and the full exception is logged on the server (debt #43).

.. CG-EXPLANATION-END id=function:sample_along_line

