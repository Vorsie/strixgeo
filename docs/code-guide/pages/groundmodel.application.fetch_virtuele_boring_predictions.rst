groundmodel.application.fetch_virtuele_boring_predictions
=========================================================

.. CG-PAGE source=src/groundmodel/application/fetch_virtuele_boring_predictions.py complete=true

*Source file:* ``src/groundmodel/application/fetch_virtuele_boring_predictions.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-56

.. literalinclude:: ../../../src/groundmodel/application/fetch_virtuele_boring_predictions.py
   :language: python
   :lines: 1-56
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the Virtuele Boring overlay file. It imports the CPT and borehole repositories, the Virtuele Boring client and its constants, and the layer result type. The docstring lists four design choices.

**Why it is here.** The docstring records each choice with its reason: the API covers Flanders only in Lambert 72, so other-coordinate investigations are skipped with a per-row warning; one bad coordinate must not blank the whole overlay, so per-call failures are caught and skipped; the fan-out is bounded by a semaphore because DOV rate-limits above a ceiling; and nothing is persisted because these predictions are informative-only overlays (owner scope decision 2026-05-14).

.. CG-EXPLANATION-END id=module-header

Class ``InvestigationPrediction``
---------------------------------

.. CG-BLOCK id=class:InvestigationPrediction lines=57-90

.. literalinclude:: ../../../src/groundmodel/application/fetch_virtuele_boring_predictions.py
   :language: python
   :lines: 57-90
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvestigationPrediction

**What this does.** A frozen dataclass (an immutable data holder) carrying one investigation's overlay: whether it is a CPT or borehole, its id and name, its surface level, and one predicted layer list per model that succeeded.

**Why it is here.** The docstring records that the frontend joins the id against its in-memory list to position the ghost columns, that the surface level lets it convert absolute levels to per-investigation depths, and that a missing model key means that model's fetch failed or fell outside coverage.

.. CG-EXPLANATION-END id=class:InvestigationPrediction

Class ``VirtueleBoringPredictionsResult``
-----------------------------------------

.. CG-BLOCK id=class:VirtueleBoringPredictionsResult lines=91-117

.. literalinclude:: ../../../src/groundmodel/application/fetch_virtuele_boring_predictions.py
   :language: python
   :lines: 91-117
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringPredictionsResult

**What this does.** A frozen dataclass for the whole project's overlay: the model codes requested, one prediction per usable investigation, and a count of investigations skipped for the wrong coordinate system.

**Why it is here.** The models are echoed so the frontend can detect partial completion; skipped investigations are omitted from the list (they would not render) but their count is surfaced so the UI can say how many points have no overlay.

.. CG-EXPLANATION-END id=class:VirtueleBoringPredictionsResult

Class ``FetchVirtueleBoringPredictions`` — header
-------------------------------------------------

.. CG-BLOCK id=class:FetchVirtueleBoringPredictions lines=118-126

.. literalinclude:: ../../../src/groundmodel/application/fetch_virtuele_boring_predictions.py
   :language: python
   :lines: 118-126
   :lineno-match:

.. CG-EXPLANATION-START id=class:FetchVirtueleBoringPredictions

**What this does.** Opens the use case; construction takes a session and the HTTP client is built per call.

**Why it is here.** Building the client per call means the connection pool is owned by the use case and closed on every exit path.

.. CG-EXPLANATION-END id=class:FetchVirtueleBoringPredictions

Method ``FetchVirtueleBoringPredictions``. ``def __init__``
-----------------------------------------------------------

.. CG-BLOCK id=method:FetchVirtueleBoringPredictions.__init__ lines=127-131

.. literalinclude:: ../../../src/groundmodel/application/fetch_virtuele_boring_predictions.py
   :language: python
   :lines: 127-131
   :lineno-match:

.. CG-EXPLANATION-START id=method:FetchVirtueleBoringPredictions.__init__

**What this does.** Stores the session for the database reads.

**Why it is here.** The caller owns the session; this use case only reads through it.

.. CG-EXPLANATION-END id=method:FetchVirtueleBoringPredictions.__init__

Method ``FetchVirtueleBoringPredictions``. ``async def execute``
----------------------------------------------------------------

.. CG-BLOCK id=method:FetchVirtueleBoringPredictions.execute lines=132-297

.. literalinclude:: ../../../src/groundmodel/application/fetch_virtuele_boring_predictions.py
   :language: python
   :lines: 132-297
   :lineno-match:

.. CG-EXPLANATION-START id=method:FetchVirtueleBoringPredictions.execute

**What this does.** Fetches overlays for every investigation in a project. It de-duplicates the requested models, loads the project's CPTs and boreholes, keeps only those with Lambert-72 coordinates (counting the rest as skipped), then fans out one bounded call per investigation-and-model pair, and assembles the ordered result.

**Why it is here.** The reads are scoped to the project id so no data leaks across projects (the project-scope rule). Models keep the caller's order so the frontend's picker maps unchanged onto the response. The semaphore keeps the fan-out under DOV's per-IP ceiling even on large projects, and a failed call logs and returns so the rest of the sweep still surfaces overlays — nothing is written to the database.

.. CG-EXPLANATION-END id=method:FetchVirtueleBoringPredictions.execute

