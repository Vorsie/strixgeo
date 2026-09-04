groundmodel.infrastructure.parsers.borehole.dov.dov_client
==========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-73

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py
   :language: python
   :lines: 1-73
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring noting how this borehole client mirrors the CPT one and where it differs, then the imports — including the shared WFS base class, the shared download helper, and the borehole-summary row type.

**Why it is here.** The borehole import follows the same scan-then-download shape as the CPT import, so this client leans on the same shared helpers. The differences it documents are the layer name (boreholes, not soundings), the extra WFS-only metadata each row carries, and a separate cache sub-folder so borehole record keys never clash with sounding keys.

.. CG-EXPLANATION-END id=module-header

Class ``DovBoreholeClient`` — header
------------------------------------

.. CG-BLOCK id=class:DovBoreholeClient lines=74-101

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py
   :language: python
   :lines: 74-101
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovBoreholeClient

**What this does.** Opens the borehole client, built on the shared WFS base class, and documents its inputs and the layer it queries.

**Why it is here.** By declaring its layer name as a class value, it inherits the base class's count and feature-fetch unchanged, and only needs to supply its own row-builder. The cache is rooted in a borehole sub-folder because DOV reuses the same key format across record types.

.. CG-EXPLANATION-END id=class:DovBoreholeClient

Method ``DovBoreholeClient``. ``def __init__``
----------------------------------------------

.. CG-BLOCK id=method:DovBoreholeClient.__init__ lines=102-110

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py
   :language: python
   :lines: 102-110
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoreholeClient.__init__

**What this does.** Passes the HTTP client and rate-limit state up to the base class and stores the cache.

**Why it is here.** Plain wiring on top of the shared base.

.. CG-EXPLANATION-END id=method:DovBoreholeClient.__init__

Method ``DovBoreholeClient``. ``async def fetch_bbox_processed``
----------------------------------------------------------------

.. CG-BLOCK id=method:DovBoreholeClient.fetch_bbox_processed lines=111-215

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py
   :language: python
   :lines: 111-215
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoreholeClient.fetch_bbox_processed

**What this does.** The whole borehole import for a rectangle: convert it, scan for boreholes (splitting when dense), refuse the import if it would discover more than the ceiling, then download every borehole XML in parallel and parse each. It returns the discovered count alongside each successfully-parsed borehole paired with its WFS row.

**Why it is here.** The discovery ceiling is checked before the download phase fans out, so a runaway import is refused before it launches thousands of downloads. Returning the WFS row beside each parse result is what lets the orchestrator enrich the parsed borehole with the WFS-only facts — the drilling method, the stream flags, an elevation fallback.

.. CG-EXPLANATION-END id=method:DovBoreholeClient.fetch_bbox_processed

Method ``DovBoreholeClient``. ``def _build_row``
------------------------------------------------

.. CG-BLOCK id=method:DovBoreholeClient._build_row lines=216-218

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py
   :language: python
   :lines: 216-218
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoreholeClient._build_row

**What this does.** The base class's required hook: turn one feature's properties into a borehole-summary row by calling the fuller builder below.

**Why it is here.** It is the one-line bridge the base class calls for each feature.

.. CG-EXPLANATION-END id=method:DovBoreholeClient._build_row

Method ``DovBoreholeClient``. ``def _emit_skip_warning``
--------------------------------------------------------

.. CG-BLOCK id=method:DovBoreholeClient._emit_skip_warning lines=219-233

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py
   :language: python
   :lines: 219-233
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoreholeClient._emit_skip_warning

**What this does.** Overrides the base skip-warning to use the borehole client's own historic wording, and logs the vertical coordinate system as a once-per-batch sanity check.

**Why it is here.** Keeping the exact old wording means log searches for the prior message keep matching, and naming the skipped-feature property list points straight at a DOV field rename.

.. CG-EXPLANATION-END id=method:DovBoreholeClient._emit_skip_warning

Method ``DovBoreholeClient``. ``def _build_wfs_row``
----------------------------------------------------

.. CG-BLOCK id=method:DovBoreholeClient._build_wfs_row lines=234-287

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py
   :language: python
   :lines: 234-287
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovBoreholeClient._build_wfs_row

**What this does.** Builds the full borehole-summary row from a feature's properties — permkey, test number, record URLs (building the direct proxy URL to skip a redirect), position, drilling method, and the eight interpretation-stream flags. It returns "nothing" when there is no record URL to fetch.

**Why it is here.** The position fields are allowed to be blank because DOV could ship a null coordinate, and the save step is what refuses a position-less borehole. The elevation is allowed to stay blank for the user to supply later. The coordinate systems are set directly because this is the DOV-only client and DOV always uses Belgian Lambert 72.

.. CG-EXPLANATION-END id=method:DovBoreholeClient._build_wfs_row

