groundmodel.api.routers.virtuele_boring
=======================================

.. CG-PAGE source=src/groundmodel/api/routers/virtuele_boring.py complete=true

*Source file:* ``src/groundmodel/api/routers/virtuele_boring.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-77

.. literalinclude:: ../../../src/groundmodel/api/routers/virtuele_boring.py
   :language: python
   :lines: 1-77
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring naming the two endpoints, then imports of the regular-expression tool, the id type, the network-error types, the router and query types, the session, the Virtuele Boring schemas, the application use case, the DOV HTTP client and its client class, and the logger. It creates two routers (one DOV-global, one project-scoped), caps the request at 12 models, and defines a strict pattern for a model code.

**Why it is here.** Two routers exist because the two endpoints live under different URL prefixes (one project-scoped, one DOV-global). The model-code pattern is a security gate (debt #50): each code is placed straight into the outbound DOV request path, and although the HTTP library normalises path traversal, an arbitrary user string in a backend-issued request contradicts the project's injection-defence posture, so anything that is not a real short code is rejected at the boundary. The comment records why the pattern uses start/end-of-string anchors that a trailing newline cannot slip past.

.. CG-EXPLANATION-END id=module-header

Function ``async def list_lagenmodellen``
-----------------------------------------

.. CG-BLOCK id=function:list_lagenmodellen lines=78-134

.. literalinclude:: ../../../src/groundmodel/api/routers/virtuele_boring.py
   :language: python
   :lines: 78-134
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_lagenmodellen

**What this does.** The handler for ``GET /dov/virtuele-boring/lagenmodellen`` — return the list of DOV layered models, passing DOV's catalogue straight through and skipping rows without a code.

**Why it is here.** The catalogue is small and cheap, so it is fetched live; the desktop caches it for the session. The DOV failures map to ``502``/``503``/``504`` as elsewhere. The Dutch descriptions are passed through raw, per the translate-at-the-presentation-boundary rule.

.. CG-EXPLANATION-END id=function:list_lagenmodellen

Function ``async def fetch_predictions``
----------------------------------------

.. CG-BLOCK id=function:fetch_predictions lines=135-241

.. literalinclude:: ../../../src/groundmodel/api/routers/virtuele_boring.py
   :language: python
   :lines: 135-241
   :lineno-match:

.. CG-EXPLANATION-START id=function:fetch_predictions

**What this does.** The handler for ``GET /projects/{project_id}/virtuele-boring/predictions`` — for every investigation with Belgian Lambert-72 coordinates, fetch one prediction per requested model and return them keyed by model code. It validates the comma-separated model list (at least one, at most twelve, each matching the code pattern) before fanning out.

**Why it is here.** Investigations outside Lambert 72 are counted as skipped rather than listed, because there is no place to render them. A per-investigation, per-model fetch failure is logged and shows up as a missing key rather than sinking the whole sweep. The invalid-code path deliberately does not echo the raw rejected values beyond a short capped preview, so the error cannot become a reflection surface.

.. CG-EXPLANATION-END id=function:fetch_predictions

