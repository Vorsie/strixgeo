groundmodel.infrastructure.parsers.dov.dov_fixture_transport
============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 1-121
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring giving the full route table and settings for a test-only mock that serves DOV web traffic from on-disk sample files, then the imports and the module's constants — the controlling environment variables, the fixture region's rectangle, the per-kind URL prefixes, and the layer-to-filename map.

**Why it is here.** For the end-to-end tests to run offline and give the same result every time, all DOV network calls are redirected to hand-authored sample files. This is that redirection. Crucially it is allowed only in a development backend — a packaged build runs as production and ignores the switch — so a shipped app can never be steered to serve fake data. The fixture region's rectangle lets "draw an empty area" tests get an empty result.

.. CG-EXPLANATION-END id=module-header

Function ``def _extract_bbox_l72``
----------------------------------

.. CG-BLOCK id=function:_extract_bbox_l72 lines=122-170

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 122-170
   :lineno-match:

.. CG-EXPLANATION-START id=function:_extract_bbox_l72

**What this does.** Reads the request's rectangle out of either place it can live — a plain rectangle parameter, or one folded inside a filter string — and returns its sorted corners, or "nothing" if none is found.

**Why it is here.** The CPT path sends the rectangle one way and the borehole and sample paths send it the other, so both shapes are read here — this lets the mock decide whether a request's rectangle overlaps the sample region and, if not, serve an empty reply.

.. CG-EXPLANATION-END id=function:_extract_bbox_l72

Function ``def _bbox_overlaps_fixture``
---------------------------------------

.. CG-BLOCK id=function:_bbox_overlaps_fixture lines=171-181

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 171-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:_bbox_overlaps_fixture

**What this does.** Returns whether a request's rectangle overlaps the fixed region the sample data covers.

**Why it is here.** So a test that draws a box somewhere else — an empty area, or out at sea — gets an empty result rather than the full sample list, which is exactly what the rejection-path tests need to see.

.. CG-EXPLANATION-END id=function:_bbox_overlaps_fixture

Function ``def _layer_slug``
----------------------------

.. CG-BLOCK id=function:_layer_slug lines=182-223

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 182-223
   :lineno-match:

.. CG-EXPLANATION-START id=function:_layer_slug

**What this does.** Maps a WFS layer name (plus, where needed, the filter) to a safe filename stem for the matching sample file.

**Why it is here.** Layer names carry colons and hyphens that are not safe in filenames, so they are turned into plain slugs. The one shared observations layer is split into grain-size versus scalar by inspecting the filter, and an unknown layer maps to a stem that matches no file so the request cleanly 404s.

.. CG-EXPLANATION-END id=function:_layer_slug

Function ``def _build_fixture_transport``
-----------------------------------------

.. CG-BLOCK id=function:_build_fixture_transport lines=224-345

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 224-345
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_fixture_transport

**What this does.** Builds the mock transport. Inside it, a handler reads each request's URL and query, routes WFS requests to the right count or features sample file (serving an empty one when the rectangle does not overlap or no file exists), and routes each per-record XML request to its file by kind and permkey. Anything unmatched returns a descriptive 404.

**Why it is here.** The 404 on a missing file is deliberate — a missing sample surfaces the test as a clear failure with a message, rather than silently passing. Falling back to an empty file for layers with no sample data lets those calls return cleanly rather than aborting the import.

.. CG-EXPLANATION-END id=function:_build_fixture_transport

Function ``def _serve_fixture``
-------------------------------

.. CG-BLOCK id=function:_serve_fixture lines=346-375

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 346-375
   :lineno-match:

.. CG-EXPLANATION-START id=function:_serve_fixture

**What this does.** Reads a sample file and returns it as a successful reply with the right content type, or a 404 with a helpful message when the file is absent.

**Why it is here.** It centralises the read-and-respond step, and its 404 message names the exact missing path so a test author knows which file to create or which rectangle to fix.

.. CG-EXPLANATION-END id=function:_serve_fixture

Function ``def _fixture_mode_allowed``
--------------------------------------

.. CG-BLOCK id=function:_fixture_mode_allowed lines=376-403

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 376-403
   :lineno-match:

.. CG-EXPLANATION-START id=function:_fixture_mode_allowed

**What this does.** A pure decision — no environment access — that returns true only when the fixture switch is exactly on and the backend is running in development.

**Why it is here.** Splitting the decision out from reading the environment makes the production-refusal rule testable without touching real environment variables. The rule itself is the point: a shipped app runs as production, so this returns false there and the test seam is unreachable for an end user.

.. CG-EXPLANATION-END id=function:_fixture_mode_allowed

Function ``def is_fixture_mode``
--------------------------------

.. CG-BLOCK id=function:is_fixture_mode lines=404-421

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 404-421
   :lineno-match:

.. CG-EXPLANATION-START id=function:is_fixture_mode

**What this does.** Reads the environment and the current mode and returns whether fixture mode is both requested and permitted.

**Why it is here.** It is the one call the rest of the code asks; it combines "was it requested" with "is it allowed here" so no caller can accidentally honour the switch in production.

.. CG-EXPLANATION-END id=function:is_fixture_mode

Function ``def fixture_root_path``
----------------------------------

.. CG-BLOCK id=function:fixture_root_path lines=422-430

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py
   :language: python
   :lines: 422-430
   :lineno-match:

.. CG-EXPLANATION-START id=function:fixture_root_path

**What this does.** Returns the folder the sample files live in, from an environment override or a default.

**Why it is here.** So a test run can point the mock at a different folder of samples without changing code.

.. CG-EXPLANATION-END id=function:fixture_root_path

