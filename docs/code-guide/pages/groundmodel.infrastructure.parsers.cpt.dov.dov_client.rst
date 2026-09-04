groundmodel.infrastructure.parsers.cpt.dov.dov_client
=====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-82

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py
   :language: python
   :lines: 1-82
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring recording the live DOV endpoints and debugging tips, then the imports: async support, the process pool, the HTTP client library, and the shared DOV helpers this client leans on. It also defines the internal tuple shape returned per WFS feature.

**Why it is here.** This is the client that finds CPTs in a map rectangle and downloads them, all at once rather than one at a time — *async* is Python's way of juggling many waiting network calls on one thread. The docstring is deliberately practical: it names the exact URLs, the plausible Belgian coordinate ranges (to sanity-check an empty result), and where to look when downloads start returning "not found". The heavy lifting — the recursive rectangle split, the parallel download, the retry and back-off — is delegated to the shared DOV helpers, so this file mostly wires them together for CPTs.

.. CG-EXPLANATION-END id=module-header

Class ``WfsIndexEntry``
-----------------------

.. CG-BLOCK id=class:WfsIndexEntry lines=83-108

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py
   :language: python
   :lines: 83-108
   :lineno-match:

.. CG-EXPLANATION-START id=class:WfsIndexEntry

**What this does.** A small, unchangeable data-holder describing one CPT found in the discovery step, before any XML is downloaded: its permkey, its human name, the URL of its XML, and its position in Belgian Lambert 72.

**Why it is here.** Discovery is split from download so the screen can drop a pin on every sounding within about a second, while the slower downloads run in the background. This is the object that carries everything known at that early moment; being *frozen* (unchangeable) means nothing can quietly alter an entry after discovery.

.. CG-EXPLANATION-END id=class:WfsIndexEntry

Class ``DovClient`` — header
----------------------------

.. CG-BLOCK id=class:DovClient lines=109-128

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py
   :language: python
   :lines: 109-128
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovClient

**What this does.** Opens the CPT DOV client class and documents its three inputs: the shared HTTP client, an optional on-disk cache, and an optional rate-limit state.

**Why it is here.** The three inputs are passed in rather than built here so the same client works in production (real cache, real back-off) and in a test (neither). The rate-limit state is what lets a run that has been throttled by DOV automatically slow itself down instead of hammering the server into more refusals.

.. CG-EXPLANATION-END id=class:DovClient

Method ``DovClient``. ``def __init__``
--------------------------------------

.. CG-BLOCK id=method:DovClient.__init__ lines=129-139

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py
   :language: python
   :lines: 129-139
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovClient.__init__

**What this does.** Stores the HTTP client, the cache, and the rate-limit state, and registers the logger.

**Why it is here.** Plain wiring: it just keeps the collaborators it was handed.

.. CG-EXPLANATION-END id=method:DovClient.__init__

Method ``DovClient``. ``async def fetch_wfs_index``
---------------------------------------------------

.. CG-BLOCK id=method:DovClient.fetch_wfs_index lines=140-202

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py
   :language: python
   :lines: 140-202
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovClient.fetch_wfs_index

**What this does.** Phase one of an import. It converts the map rectangle from world coordinates (WGS84 degrees) to Belgian Lambert 72, asks DOV which soundings fall inside it (splitting the rectangle recursively when a piece holds too many to return at once), removes duplicates at the split boundaries, and returns one tidy entry per unique CPT.

**Why it is here.** WGS84 is the worldwide latitude/longitude system the map draws in; DOV answers in Belgian Lambert 72, so the rectangle must be converted first. Resolving the whole list before any download lets the caller show every pin immediately. The recursive split exists because a WFS reply is capped at a maximum number of features, so a busy rectangle has to be quartered until each piece fits.

.. CG-EXPLANATION-END id=method:DovClient.fetch_wfs_index

Method ``DovClient``. ``async def fetch_bbox_processed``
--------------------------------------------------------

.. CG-BLOCK id=method:DovClient.fetch_bbox_processed lines=203-323

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py
   :language: python
   :lines: 203-323
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovClient.fetch_bbox_processed

**What this does.** Phase two. Given the list of found CPTs, it downloads each XML and runs a parse on it, in parallel. Cache hits skip the network. Large XMLs are parsed in the process pool; small ones inline. It reports progress and returns each CPT's name paired with its parsed result.

**Why it is here.** Parsing each XML *inside* its own download task means the parse work happens during the waits for other downloads, so the parse time effectively disappears — the comment records this saved eight-plus seconds over parsing everything afterwards. A failure on one XML is caught per-CPT so one bad file cannot sink the whole batch, and the download concurrency automatically drops if DOV signalled it was being overloaded.

.. CG-EXPLANATION-END id=method:DovClient.fetch_bbox_processed

Method ``DovClient``. ``async def _wfs_count``
----------------------------------------------

.. CG-BLOCK id=method:DovClient._wfs_count lines=324-341

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py
   :language: python
   :lines: 324-341
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovClient._wfs_count

**What this does.** Asks DOV how many soundings are in a Lambert 72 rectangle, without fetching the soundings themselves, by delegating to the shared count helper.

**Why it is here.** The count is what the recursive split uses to decide whether a rectangle is small enough to fetch or must be quartered again — a cheap question asked before the expensive one.

.. CG-EXPLANATION-END id=method:DovClient._wfs_count

Method ``DovClient``. ``async def _wfs_features``
-------------------------------------------------

.. CG-BLOCK id=method:DovClient._wfs_features lines=342-428

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py
   :language: python
   :lines: 342-428
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovClient._wfs_features

**What this does.** Fetches the actual soundings in a rectangle and turns each into a tuple of (XML URL, name, x, y). It builds the direct proxy URL to skip a redirect, and — importantly — refuses any feature whose record URL does not point at an allow-listed DOV host. It logs how many features had no URL or an off-host URL.

**Why it is here.** The record URL comes from the WFS response, which is outside data, so before the client ever fetches it the URL is checked against the list of real DOV hosts. Without that guard a doctored response could steer the client into fetching an internal address it should never touch — the comment names this the SSRF (server-side request forgery) guard. Logging the available property names on a missing URL makes a DOV schema rename obvious at a glance.

.. CG-EXPLANATION-END id=method:DovClient._wfs_features

