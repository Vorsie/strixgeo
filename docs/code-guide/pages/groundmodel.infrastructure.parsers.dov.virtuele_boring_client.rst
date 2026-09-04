groundmodel.infrastructure.parsers.dov.virtuele_boring_client
=============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py
   :language: python
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing DOV's Virtuele Boring ("virtual borehole") web service and the two calls this client makes against it, then the imports.

**Why it is here.** Virtuele Boring is a DOV service that, given a single point, returns the modelled sequence of geological layers there — a synthetic borehole from the public Flanders subsurface models. This platform uses it as an informative overlay, never as stored data. The two calls are a single-point pick and a list of the available models; both share one web client so the connection stays warm across the typical fan-out of many points times a couple of models.

.. CG-EXPLANATION-END id=module-header

Class ``VirtueleBoringFetchError`` — header
-------------------------------------------

.. CG-BLOCK id=class:VirtueleBoringFetchError lines=41-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py
   :language: python
   :lines: 41-49
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringFetchError

**What this does.** A named error raised when the Virtuele Boring service answers with anything other than success, carrying the status, a trimmed body, and the URL.

**Why it is here.** The application layer catches this and skips just that one point rather than failing the whole sweep — one bad point should not sink a hundred good ones. Carrying the status and body means the failure can be triaged from the log without re-running.

.. CG-EXPLANATION-END id=class:VirtueleBoringFetchError

Method ``VirtueleBoringFetchError``. ``def __init__``
-----------------------------------------------------

.. CG-BLOCK id=method:VirtueleBoringFetchError.__init__ lines=50-56

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py
   :language: python
   :lines: 50-56
   :lineno-match:

.. CG-EXPLANATION-START id=method:VirtueleBoringFetchError.__init__

**What this does.** Builds the error message from the status, body, and URL, and keeps each on the error.

**Why it is here.** So a caller has both a ready-made message and the individual pieces to log or branch on.

.. CG-EXPLANATION-END id=method:VirtueleBoringFetchError.__init__

Class ``VirtueleBoringClient`` — header
---------------------------------------

.. CG-BLOCK id=class:VirtueleBoringClient lines=57-65

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py
   :language: python
   :lines: 57-65
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringClient

**What this does.** Opens the client class. Its only state is the injected web client and its logger.

**Why it is here.** Being stateless, it is safe to share across many concurrent point-picks as long as the underlying web client stays open.

.. CG-EXPLANATION-END id=class:VirtueleBoringClient

Method ``VirtueleBoringClient``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:VirtueleBoringClient.__init__ lines=66-78

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py
   :language: python
   :lines: 66-78
   :lineno-match:

.. CG-EXPLANATION-START id=method:VirtueleBoringClient.__init__

**What this does.** Stores the web client and registers the logger.

**Why it is here.** The web client is passed in rather than built here so the whole sweep of point-picks shares one warm connection.

.. CG-EXPLANATION-END id=method:VirtueleBoringClient.__init__

Method ``VirtueleBoringClient``. ``async def fetch_doorprik``
-------------------------------------------------------------

.. CG-BLOCK id=method:VirtueleBoringClient.fetch_doorprik lines=79-138

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py
   :language: python
   :lines: 79-138
   :lineno-match:

.. CG-EXPLANATION-START id=method:VirtueleBoringClient.fetch_doorprik

**What this does.** Fetches the modelled layer stack at one point for one model. It logs the request and the reply, raises the named fetch error on a non-success reply, and otherwise parses the reply into a result with the layers plus the point and model echoed back.

**Why it is here.** Coordinates must already be in Belgian Lambert 72 — the method does not transform them, the caller gates on that — because out-of-Flanders coordinates would get a meaningless extrapolation. Logging the body on a failure follows the project rule for external calls, so a failure is diagnosable from the log alone.

.. CG-EXPLANATION-END id=method:VirtueleBoringClient.fetch_doorprik

Method ``VirtueleBoringClient``. ``async def fetch_lagenmodel_catalog``
-----------------------------------------------------------------------

.. CG-BLOCK id=method:VirtueleBoringClient.fetch_lagenmodel_catalog lines=139-176

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py
   :language: python
   :lines: 139-176
   :lineno-match:

.. CG-EXPLANATION-START id=method:VirtueleBoringClient.fetch_lagenmodel_catalog

**What this does.** Fetches DOV's list of available layered models and passes the raw list straight through, raising the named error on a non-success reply and returning empty if the reply is not a list.

**Why it is here.** Passing the raw shape through to the desktop means a model newly added by DOV shows up in the picker with no code change on our side.

.. CG-EXPLANATION-END id=method:VirtueleBoringClient.fetch_lagenmodel_catalog

Function ``def _parse_doorprik_payload``
----------------------------------------

.. CG-BLOCK id=function:_parse_doorprik_payload lines=177-237

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py
   :language: python
   :lines: 177-237
   :lineno-match:

.. CG-EXPLANATION-START id=function:_parse_doorprik_payload

**What this does.** Merges the reply's two parallel lists — the per-layer rows present at the point, and the model's full catalogue of unit descriptions — into one flat list where each layer already carries its own name, description, colour, and optional reference link.

**Why it is here.** Joining the catalogue onto each row means the consumer gets self-describing layers and never needs a second lookup table. A layer that appears in the point data but not the catalogue is rare and would signal a service bug; it is still emitted, with blank metadata and a warning, so the data point is not silently lost.

.. CG-EXPLANATION-END id=function:_parse_doorprik_payload

