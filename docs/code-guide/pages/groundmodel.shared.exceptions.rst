groundmodel.shared.exceptions
=============================

.. CG-PAGE source=src/groundmodel/shared/exceptions.py complete=true

*Source file:* ``src/groundmodel/shared/exceptions.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the exceptions module and imports ``UUID`` (a *universally unique identifier* — a 128-bit code used as a database row's key). An *exception* is a signal the code raises when something goes wrong, which travels up the call chain until something catches it.

**Why it is here.** This one file gathers the whole *exception hierarchy* — the family of error types arranged as a tree so a catcher can catch a whole branch by its base type. CLAUDE.md's "one class per file" rule explicitly exempts ``shared/exceptions.py``, where the hierarchy is grouped together by convention.

.. CG-EXPLANATION-END id=module-header

Class ``GroundModelError``
--------------------------

.. CG-BLOCK id=class:GroundModelError lines=8-11

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 8-11
   :lineno-match:

.. CG-EXPLANATION-START id=class:GroundModelError

**What this does.** The base error type every other error in the engine inherits from.

**Why it is here.** Grouping them under one base lets a caller catch "any ground-model error" with a single type, and cleanly separates the engine's own deliberate errors from unexpected Python errors.

.. CG-EXPLANATION-END id=class:GroundModelError

Class ``ParseError``
--------------------

.. CG-BLOCK id=class:ParseError lines=12-15

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 12-15
   :lineno-match:

.. CG-EXPLANATION-START id=class:ParseError

**What this does.** Raised when a data file cannot be parsed.

**Why it is here.** A named type so a failed parse is caught and reported distinctly, not confused with a database or a validation failure.

.. CG-EXPLANATION-END id=class:ParseError

Class ``DomainValidationError``
-------------------------------

.. CG-BLOCK id=class:DomainValidationError lines=16-19

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 16-19
   :lineno-match:

.. CG-EXPLANATION-START id=class:DomainValidationError

**What this does.** Raised when a domain invariant — a rule the geotechnical model must always satisfy — is violated.

**Why it is here.** Separates "the data broke a modelling rule" from "the file was unreadable" or "the row is missing", so each can be handled its own way.

.. CG-EXPLANATION-END id=class:DomainValidationError

Class ``NotFoundError``
-----------------------

.. CG-BLOCK id=class:NotFoundError lines=20-23

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 20-23
   :lineno-match:

.. CG-EXPLANATION-START id=class:NotFoundError

**What this does.** Raised when a requested resource does not exist.

**Why it is here.** The API layer turns this into a 404 ("not found") answer; giving it its own type keeps that mapping clean.

.. CG-EXPLANATION-END id=class:NotFoundError

Class ``RepositoryError``
-------------------------

.. CG-BLOCK id=class:RepositoryError lines=24-27

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 24-27
   :lineno-match:

.. CG-EXPLANATION-START id=class:RepositoryError

**What this does.** Raised on an unexpected database or repository failure. A *repository* is the layer that reads and writes database rows.

**Why it is here.** A named type for storage-layer failures so they are distinguishable from domain errors when something goes wrong deep in the data layer.

.. CG-EXPLANATION-END id=class:RepositoryError

Class ``DuplicateCptError`` — header
------------------------------------

.. CG-BLOCK id=class:DuplicateCptError lines=28-30

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 28-30
   :lineno-match:

.. CG-EXPLANATION-START id=class:DuplicateCptError

**What this does.** Raised when a CPT with the same project id and test id already exists in the project.

**Why it is here.** The legacy duplicate signal; it carries the existing row's id so the caller can point at the row that is already there (the older 409 path, kept for callers that do not want a refresh).

.. CG-EXPLANATION-END id=class:DuplicateCptError

Method ``DuplicateCptError``. ``def __init__``
----------------------------------------------

.. CG-BLOCK id=method:DuplicateCptError.__init__ lines=31-36

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 31-36
   :lineno-match:

.. CG-EXPLANATION-START id=method:DuplicateCptError.__init__

**What this does.** Stores a human-readable message and the id of the existing record on the error.

**Why it is here.** So the caller has both the message to show and the row id of the duplicate to act on.

.. CG-EXPLANATION-END id=method:DuplicateCptError.__init__

Class ``CptRefreshConfirmationRequiredError`` — header
------------------------------------------------------

.. CG-BLOCK id=class:CptRefreshConfirmationRequiredError lines=37-62

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 37-62
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptRefreshConfirmationRequiredError

**What this does.** Raised when re-importing a CPT would overwrite stored data without confirmation. It carries the old-versus-new diff — deepest reading, row counts, and issue counts from the fresh parse.

**Why it is here.** The docstring and ``docs/ux.md`` ("Reversible vs irreversible") record that replacing a CPT's series is irreversible: the previous parse is gone and every contact anchored on it now sits against different depths. A confirmation dialog is the only protection against that class of mistake, so the import refuses until the caller re-posts with ``confirm_refresh=true`` — and the engineer decides on the numbers, not on a filename.

.. CG-EXPLANATION-END id=class:CptRefreshConfirmationRequiredError

Method ``CptRefreshConfirmationRequiredError``. ``def __init__``
----------------------------------------------------------------

.. CG-BLOCK id=method:CptRefreshConfirmationRequiredError.__init__ lines=63-90

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 63-90
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRefreshConfirmationRequiredError.__init__

**What this does.** Builds a sentence describing the replacement (old rows and depth to new rows and depth) and stores the row identity plus the full diff on the error.

**Why it is here.** So the confirmation dialog can show the exact change the engineer is being asked to consent to.

.. CG-EXPLANATION-END id=method:CptRefreshConfirmationRequiredError.__init__

Class ``CptRefreshRefusedError`` — header
-----------------------------------------

.. CG-BLOCK id=class:CptRefreshRefusedError lines=91-107

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 91-107
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptRefreshRefusedError

**What this does.** Raised when a fresh parse is too broken to overwrite stored data with — it produced no rows, or it produced parse errors. Refused regardless of confirmation.

**Why it is here.** The docstring records that a refresh is destructive and has no undo, so a truncated download or the wrong revision of a file must never replace a good measurement with an empty parse; the engineer cannot consent their way into overwriting good data. The API answers 422 (unprocessable).

.. CG-EXPLANATION-END id=class:CptRefreshRefusedError

Method ``CptRefreshRefusedError``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:CptRefreshRefusedError.__init__ lines=108-113

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 108-113
   :lineno-match:

.. CG-EXPLANATION-START id=method:CptRefreshRefusedError.__init__

**What this does.** Stores a machine-readable reason (``"no_rows"`` / ``"parse_errors"``) and a human-readable message on the error.

**Why it is here.** So the API can both branch on the reason code and show the message naming what is wrong with the file.

.. CG-EXPLANATION-END id=method:CptRefreshRefusedError.__init__

Class ``LithoLayerOverlapError`` — header
-----------------------------------------

.. CG-BLOCK id=class:LithoLayerOverlapError lines=114-121

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 114-121
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerOverlapError

**What this does.** Raised when a litho-layer edit would overlap an accepted sibling layer on the same investigation column. It carries the offending layer's id.

**Why it is here.** The docstring records this is the clean translation of the ``litho_layer_accepted_no_overlap`` database constraint (see ``db_constraints.py``), so the API answers 409 (conflict) instead of leaking a raw 500 (server error).

.. CG-EXPLANATION-END id=class:LithoLayerOverlapError

Method ``LithoLayerOverlapError``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:LithoLayerOverlapError.__init__ lines=122-129

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 122-129
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerOverlapError.__init__

**What this does.** Builds a message naming the layer and stores its id on the error.

**Why it is here.** So the answer names which layer's edit was rejected.

.. CG-EXPLANATION-END id=method:LithoLayerOverlapError.__init__

Class ``VoxelGridTooLargeError`` — header
-----------------------------------------

.. CG-BLOCK id=class:VoxelGridTooLargeError lines=130-148

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 130-148
   :lineno-match:

.. CG-EXPLANATION-START id=class:VoxelGridTooLargeError

**What this does.** Raised when a requested 3-D voxel build resolves to more cells than the budget allows. A *voxel* is a 3-D pixel — one small cube of the model. It carries a horizontal spacing at which the same model would fit.

**Why it is here.** The docstring records it is deliberately NOT a plain ``ValueError``: the build treats a ``ValueError`` from the labeller as "this model is unbuildable" and clears the stored 3-D solids, so a spacing the engineer can simply retype must not travel that path. The router maps it to 422.

.. CG-EXPLANATION-END id=class:VoxelGridTooLargeError

Method ``VoxelGridTooLargeError``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:VoxelGridTooLargeError.__init__ lines=149-154

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 149-154
   :lineno-match:

.. CG-EXPLANATION-START id=method:VoxelGridTooLargeError.__init__

**What this does.** Stores the refusal message and the fitting spacing on the error.

**Why it is here.** So the client can offer the spacing that would work rather than making the engineer guess a new number.

.. CG-EXPLANATION-END id=method:VoxelGridTooLargeError.__init__

Class ``CrossLithoBodyCorrelationError`` — header
-------------------------------------------------

.. CG-BLOCK id=class:CrossLithoBodyCorrelationError lines=155-165

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 155-165
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossLithoBodyCorrelationError

**What this does.** Raised when a geotech packing correlation would connect two bands that belong to different lithostratigraphic bodies.

**Why it is here.** The docstring records that a NAD packing class is always a subdivision inside ONE litho body, so a packing edge must never merge two separate bodies — and "same lithology" alone is not enough, because two separate sand bodies must stay separate. The router maps it to 422.

.. CG-EXPLANATION-END id=class:CrossLithoBodyCorrelationError

Method ``CrossLithoBodyCorrelationError``. ``def __init__``
-----------------------------------------------------------

.. CG-BLOCK id=method:CrossLithoBodyCorrelationError.__init__ lines=166-182

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 166-182
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossLithoBodyCorrelationError.__init__

**What this does.** Builds the message, naming the two judged bands when the caller knows them and falling back to a generic sentence otherwise.

**Why it is here.** So the refusal points at the two specific bands the engineer tried to connect, telling them to correlate the lithology first in the litho stage.

.. CG-EXPLANATION-END id=method:CrossLithoBodyCorrelationError.__init__

Class ``CrossingCorrelationError`` — header
-------------------------------------------

.. CG-BLOCK id=class:CrossingCorrelationError lines=183-201

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 183-201
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossingCorrelationError

**What this does.** Raised when a packing correlation would cross another tie already drawn in the same gap.

**Why it is here.** The docstring records the owner's 2026-08-17 ruling that a crossing is a hard conflict: the renderer suspends both ties and neither side bands, so a crossing that lands silently kills the fill on that gap. Refusing at the write is the only moment the engineer still has the gesture in mind; the message names columns and depths, never a database id. The router maps it to 422.

.. CG-EXPLANATION-END id=class:CrossingCorrelationError

Method ``CrossingCorrelationError``. ``def __init__``
-----------------------------------------------------

.. CG-BLOCK id=method:CrossingCorrelationError.__init__ lines=202-216

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 202-216
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossingCorrelationError.__init__

**What this does.** Builds the message naming the tie the gesture would have crossed, in the engineer's own vocabulary (columns and depths).

**Why it is here.** So the engineer can see exactly which existing tie to redraw first.

.. CG-EXPLANATION-END id=method:CrossingCorrelationError.__init__

Class ``DemExtentRefusedError`` — header
----------------------------------------

.. CG-BLOCK id=class:DemExtentRefusedError lines=217-238

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 217-238
   :lineno-match:

.. CG-EXPLANATION-START id=class:DemExtentRefusedError

**What this does.** Raised when a DEM tile request's extent cannot be a real place — coordinates outside the project CRS's area of use (the classic case is an extent anchored at (0,0), section-space numbers that were never map coordinates), a non-finite bound, or a span so large the tile would be hundreds of megapixels. It carries the refused extent. A *DEM* is the public ground-surface height data; *WCS* is the web service that serves it; a *CRS* is the numbered coordinate system the coordinates are measured in; the *extent* is the rectangle being asked for.

**Why it is here.** The docstring records this guards the WCS providers against extents no upstream could answer. It is deliberately not a network error because the request never reaches the network; the router maps it to 422 with the refused extent quoted, so the caller sees WHICH numbers were wrong instead of a generic "service unavailable".

.. CG-EXPLANATION-END id=class:DemExtentRefusedError

Method ``DemExtentRefusedError``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:DemExtentRefusedError.__init__ lines=239-244

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 239-244
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemExtentRefusedError.__init__

**What this does.** Stores the refusal message and the offending extent on the error.

**Why it is here.** So the client is shown which coordinates were rejected.

.. CG-EXPLANATION-END id=method:DemExtentRefusedError.__init__

Class ``DemUpstreamRecentlyFailedError`` — header
-------------------------------------------------

.. CG-BLOCK id=class:DemUpstreamRecentlyFailedError lines=245-266

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 245-266
   :lineno-match:

.. CG-EXPLANATION-START id=class:DemUpstreamRecentlyFailedError

**What this does.** Raised when a DEM tile key permanently failed upstream a short time ago. It carries how many seconds until the key is retried.

**Why it is here.** The docstring records the negative cache (see ``dem_negative_cache.py``) remembers the exact tile key a permanent upstream failure occurred for, so a UI that re-mounts and re-fetches cannot turn one bad extent into a flood of requests. A *negative cache* stores the fact that a request failed, for a time-to-live window. The routers map it to 502 on ``/dem/sample`` (the section's surface line is optional) and 503 on the ground-surface build (retry later).

.. CG-EXPLANATION-END id=class:DemUpstreamRecentlyFailedError

Method ``DemUpstreamRecentlyFailedError``. ``def __init__``
-----------------------------------------------------------

.. CG-BLOCK id=method:DemUpstreamRecentlyFailedError.__init__ lines=267-272

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 267-272
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemUpstreamRecentlyFailedError.__init__

**What this does.** Stores the message and the remaining suppression window (seconds until retry) on the error.

**Why it is here.** So the client knows when it is worth asking again.

.. CG-EXPLANATION-END id=method:DemUpstreamRecentlyFailedError.__init__

Class ``IncompleteRecomputeCoverageError``
------------------------------------------

.. CG-BLOCK id=class:IncompleteRecomputeCoverageError lines=273-287

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 273-287
   :lineno-match:

.. CG-EXPLANATION-START id=class:IncompleteRecomputeCoverageError

**What this does.** Raised when a body-identity recompute payload does not speak for every section in the project.

**Why it is here.** The docstring records that the recompute replaces a model's geometry facts wholesale (audit P1-3), so a payload covering only some sections would silently erase the omitted sections' connectivity evidence and split persisted bodies on the next run. The backend cannot infer completeness from geometry, so the payload's named section set must EQUAL the project's; a stale or partly loaded client is refused. The router maps it to 422.

.. CG-EXPLANATION-END id=class:IncompleteRecomputeCoverageError

Class ``EmptyRecomputePayloadError``
------------------------------------

.. CG-BLOCK id=class:EmptyRecomputePayloadError lines=288-300

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 288-300
   :lineno-match:

.. CG-EXPLANATION-START id=class:EmptyRecomputePayloadError

**What this does.** Raised when a body-identity recompute arrives carrying no partition content — zero sections or zero regions.

**Why it is here.** The docstring records that because the recompute replaces geometry facts wholesale, an empty payload is never a legitimate "nothing is connected" statement — it is a frontend that fired before its data loaded. Accepting it would wipe every geometric merge and split bodies across the model. The router maps it to 422; the frontend treats that 422 as a bug signal, not a user error.

.. CG-EXPLANATION-END id=class:EmptyRecomputePayloadError

Class ``DovImportTooLargeError`` — header
-----------------------------------------

.. CG-BLOCK id=class:DovImportTooLargeError lines=301-323

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 301-323
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovImportTooLargeError

**What this does.** Raised when a DOV import would discover more features than the ceiling. It carries the discovered count and the limit.

**Why it is here.** The docstring records that DOV discovery counts features cheaply BEFORE any XML is downloaded, so when the area resolves more than the limit the import stops here — before the download phase fans out to thousands of parallel requests — and a mis-drawn box can never launch a runaway import. It is the second line of defence after the bounding-box area guard. The synchronous endpoints map it to 422; the streaming path emits a terminal error event carrying the same message.

.. CG-EXPLANATION-END id=class:DovImportTooLargeError

Method ``DovImportTooLargeError``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:DovImportTooLargeError.__init__ lines=324-333

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 324-333
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovImportTooLargeError.__init__

**What this does.** Builds a message with the discovered count and the limit, and stores both on the error.

**Why it is here.** So the answer names how many records the area holds and the ceiling it crossed, and suggests drawing a smaller area.

.. CG-EXPLANATION-END id=method:DovImportTooLargeError.__init__

Class ``DuplicateImportJobError`` — header
------------------------------------------

.. CG-BLOCK id=class:DuplicateImportJobError lines=334-351

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 334-351
   :lineno-match:

.. CG-EXPLANATION-START id=class:DuplicateImportJobError

**What this does.** Raised when an import for the same scope is already running. It carries the id of the job already running.

**Why it is here.** The docstring records that the job registry refuses a second start with the same de-duplication key (built from the resource kind, bounding box and project) while the first job's task is still running, so a double-click or an over-eager retry cannot launch a second identical import that races the first on the same cache folder and rows. The endpoints map it to 409 and echo the running job's id so the client can attach to the existing progress stream (an *SSE* stream — a one-way live feed of server events) instead.

.. CG-EXPLANATION-END id=class:DuplicateImportJobError

Method ``DuplicateImportJobError``. ``def __init__``
----------------------------------------------------

.. CG-BLOCK id=method:DuplicateImportJobError.__init__ lines=352-357

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 352-357
   :lineno-match:

.. CG-EXPLANATION-START id=method:DuplicateImportJobError.__init__

**What this does.** Stores the id of the already-running job in the message.

**Why it is here.** So the client can attach to that job's stream rather than starting a new one.

.. CG-EXPLANATION-END id=method:DuplicateImportJobError.__init__

Class ``BuildCancelled``
------------------------

.. CG-BLOCK id=class:BuildCancelled lines=358-376

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 358-376
   :lineno-match:

.. CG-EXPLANATION-START id=class:BuildCancelled

**What this does.** Raised inside a voxel 3-D build when a cooperative cancel is requested.

**Why it is here.** The docstring records that the build's CPU phases run in a worker thread Python cannot forcibly kill, so cancellation is cooperative: a flag is checked between voxel columns and between phases, and when it is set the worker raises this, the use case rolls its transaction back so a cancelled build writes nothing, and the background job emits a terminal cancel event. It is deliberately not a ``ValueError`` so the labeller's "unbuildable model" arm cannot mistake a cancel for a reason to clear the previous model.

.. CG-EXPLANATION-END id=class:BuildCancelled

Class ``BodyPartitionContentionError`` — header
-----------------------------------------------

.. CG-BLOCK id=class:BodyPartitionContentionError lines=377-399

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 377-399
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyPartitionContentionError

**What this does.** Raised when a body-partition write waits past the lock timeout for its lock. It carries the operation name and the model id.

**Why it is here.** The docstring records that an advisory lock serialises every body-partition rewrite for one model, and under the session's ``lock_timeout`` the blocking acquire aborts rather than hanging forever if another writer holds the lock the whole window. This turns that abort into a clean 409 (``body_partition_locked``) naming the operation, instead of a raw 500 or a hung request. An *advisory lock* is a named lock the code takes voluntarily to make writers take turns.

.. CG-EXPLANATION-END id=class:BodyPartitionContentionError

Method ``BodyPartitionContentionError``. ``def __init__``
---------------------------------------------------------

.. CG-BLOCK id=method:BodyPartitionContentionError.__init__ lines=400-408

.. literalinclude:: ../../../src/groundmodel/shared/exceptions.py
   :language: python
   :lines: 400-408
   :lineno-match:

.. CG-EXPLANATION-START id=method:BodyPartitionContentionError.__init__

**What this does.** Builds a message naming the waiting operation and the contended model, and stores both on the error.

**Why it is here.** So the 409 tells the engineer which body operation was busy and to try again in a moment.

.. CG-EXPLANATION-END id=method:BodyPartitionContentionError.__init__

