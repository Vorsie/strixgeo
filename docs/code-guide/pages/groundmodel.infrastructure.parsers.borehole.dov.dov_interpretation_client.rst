groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_client
=========================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py
   :language: python
   :lines: 1-85
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing a client that fetches interpretations across all eight DOV interpretation streams at once, then the imports.

**Why it is here.** A borehole can carry several kinds of specialist interpretation, each published in its own WFS layer. This client queries all eight layers in parallel, splits any dense one on its own, and downloads every interpretation XML through one shared parallel pool so a crowded stream cannot starve a sparse one. The docstring explains it is kept as its own client, not folded into the borehole one, because they differ enough (one layer versus eight, different row fields) that sharing would be awkward — following the rule not to build a shared layer before it is needed.

.. CG-EXPLANATION-END id=module-header

Class ``DovInterpretationClient`` — header
------------------------------------------

.. CG-BLOCK id=class:DovInterpretationClient lines=86-107

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py
   :language: python
   :lines: 86-107
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovInterpretationClient

**What this does.** Opens the interpretation client and documents its inputs.

**Why it is here.** Like the other clients its collaborators are passed in — the HTTP client, an optional cache rooted in an interpretation sub-folder, and the shared rate-limit state — so one throttle slows the whole borehole import.

.. CG-EXPLANATION-END id=class:DovInterpretationClient

Method ``DovInterpretationClient``. ``def __init__``
----------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationClient.__init__ lines=108-119

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py
   :language: python
   :lines: 108-119
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationClient.__init__

**What this does.** Stores the HTTP client, cache, and rate-limit state, and registers the logger.

**Why it is here.** Plain wiring of the collaborators it was handed.

.. CG-EXPLANATION-END id=method:DovInterpretationClient.__init__

Method ``DovInterpretationClient``. ``async def fetch_bbox_processed``
----------------------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationClient.fetch_bbox_processed lines=120-226

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py
   :language: python
   :lines: 120-226
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationClient.fetch_bbox_processed

**What this does.** Runs the whole interpretation import: it kicks off all eight per-stream rectangle scans in parallel, gathers the rows, optionally keeps only the ones whose parent borehole the caller already has, then downloads and parses every interpretation XML through the shared parallel pool.

**Why it is here.** Running the eight scans together means the total wait is the slowest single stream, not the sum. The optional filter avoids downloading interpretations for boreholes the caller did not import, and the shared download pool gives every stream a fair share of the concurrency.

.. CG-EXPLANATION-END id=method:DovInterpretationClient.fetch_bbox_processed

Method ``DovInterpretationClient``. ``async def _wfs_count``
------------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationClient._wfs_count lines=227-240

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py
   :language: python
   :lines: 227-240
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationClient._wfs_count

**What this does.** Asks how many interpretations of one stream are in a rectangle, via the shared count helper.

**Why it is here.** It takes the layer as an argument because this client counts across several layers, one per stream.

.. CG-EXPLANATION-END id=method:DovInterpretationClient._wfs_count

Method ``DovInterpretationClient``. ``async def _wfs_features``
---------------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationClient._wfs_features lines=241-290

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py
   :language: python
   :lines: 241-290
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationClient._wfs_features

**What this does.** Fetches one stream's interpretations in a rectangle and turns each into a typed row, tagging it with the stream's kind. It skips rows missing a record URL or a parent borehole number, counting each reason separately and warning with the available property names.

**Why it is here.** The stream kind is stamped on the row here because the WFS feature does not carry it — the client knows it from which layer it queried. Counting the two skip reasons apart makes a DOV schema change diagnosable.

.. CG-EXPLANATION-END id=method:DovInterpretationClient._wfs_features

Method ``DovInterpretationClient``. ``def _build_wfs_row``
----------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationClient._build_wfs_row lines=291-320

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py
   :language: python
   :lines: 291-320
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationClient._build_wfs_row

**What this does.** Builds one interpretation row from a feature's properties — permkey, parent borehole number, stream kind, and the record URLs (with the direct proxy URL to skip a redirect) — returning "nothing" when the record URL or the parent number is missing.

**Why it is here.** Both of those are mandatory: without the URL there is no XML to fetch, and without the parent number there is no borehole to attach the interpretation to.

.. CG-EXPLANATION-END id=method:DovInterpretationClient._build_wfs_row

