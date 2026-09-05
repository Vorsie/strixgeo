groundmodel.api.routers._helpers
================================

.. CG-PAGE source=src/groundmodel/api/routers/_helpers.py complete=true

*Source file:* ``src/groundmodel/api/routers/_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/api/routers/_helpers.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the file is a private toolbox for the routers, then imports of the web-error and response types, the database types, and two shared constants.

**Why it is here.** The leading underscore in the file name marks it "only routers import from here" so these helpers do not leak into the application or domain layers. The docstring records why the file exists: the project-scope guard (fetch a row, confirm it belongs to the project in the URL, answer 404 otherwise) had been copied verbatim into 14 places, well past the point where the project's don't-repeat rule says to extract it once.

.. CG-EXPLANATION-END id=module-header

Function ``async def apply_view_state_patch``
---------------------------------------------

.. CG-BLOCK id=function:apply_view_state_patch lines=35-98

.. literalinclude:: ../../../src/groundmodel/api/routers/_helpers.py
   :language: python
   :lines: 35-98
   :lineno-match:

.. CG-EXPLANATION-START id=function:apply_view_state_patch

**What this does.** Merges a small patch of settings into a row's ``view_state`` (a free-form JSON bag of per-user display state) using ONE database statement: each top-level key in the patch overwrites its namesake, a key whose value is empty is removed, and untouched keys are left alone.

**Why it is here.** Doing the read, merge, and write in Python would be a *lost-update race*: two edits arriving at once read the same starting bag and the second write silently drops the first person's change. Expressing the merge as a single database update closes that race with no lock, because the database re-evaluates the merge against the newest row version. The docstring records that nesting is deliberately not deep-merged (the API cannot decide, for the caller, whether a nested list should replace or append) and that the guarding ``CASE`` is load-bearing: without it a bag that is empty or holds a bare null would be turned into a list instead of merged.

.. CG-EXPLANATION-END id=function:apply_view_state_patch

Function ``def export_response``
--------------------------------

.. CG-BLOCK id=function:export_response lines=99-126

.. literalinclude:: ../../../src/groundmodel/api/routers/_helpers.py
   :language: python
   :lines: 99-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:export_response

**What this does.** Turns a packaged export (bytes, filename, media type) from the application layer into a file-download reply, setting the header that tells the browser to save it under the proposed filename.

**Why it is here.** It is the single place the download header is built, so the six export routes cannot drift in how they propose a filename (debt #110).

.. CG-EXPLANATION-END id=function:export_response

Function ``def parse_error_as_404``
-----------------------------------

.. CG-BLOCK id=function:parse_error_as_404 lines=127-154

.. literalinclude:: ../../../src/groundmodel/api/routers/_helpers.py
   :language: python
   :lines: 127-154
   :lineno-match:

.. CG-EXPLANATION-START id=function:parse_error_as_404

**What this does.** A small wrapper used around a snapshot builder: if the builder cannot resolve an id the caller supplied and raises a ``ParseError``, this turns that into a ``404 Not Found``.

**Why it is here.** The usual reason a snapshot cannot be built is that a project, model, or section id does not exist in this project, and 404 is the honest answer. Wrapping it here keeps the two export routers mapping the failure the same way (debt #110).

.. CG-EXPLANATION-END id=function:parse_error_as_404

Function ``def require_model_kind``
-----------------------------------

.. CG-BLOCK id=function:require_model_kind lines=155-196

.. literalinclude:: ../../../src/groundmodel/api/routers/_helpers.py
   :language: python
   :lines: 155-196
   :lineno-match:

.. CG-EXPLANATION-START id=function:require_model_kind

**What this does.** Checks that a fetched model is of the expected kind (for example lithostratigraphic) and, if not, raises a structured ``422`` naming the operation that rejected it.

**Why it is here.** The litho and geotech operations run this right after the scope guard so passing, say, a geological model id to a litho-only operation gives a clear error instead of a silent no-op. The docstring records that this block had drifted across 5 copies with different error codes; the canonical shape (``invalid_model_kind``) is the majority one.

.. CG-EXPLANATION-END id=function:require_model_kind

Function ``async def get_in_project_or_404``
--------------------------------------------

.. CG-BLOCK id=function:get_in_project_or_404 lines=197-245

.. literalinclude:: ../../../src/groundmodel/api/routers/_helpers.py
   :language: python
   :lines: 197-245
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_in_project_or_404

**What this does.** The shared project-scope guard: it awaits a row-fetch, and if the row is missing OR belongs to a different project than the one named in the URL, it raises a ``404``; otherwise it returns the row.

**Why it is here.** This is the single implementation of the project-scope guard the API contract mandates on every by-id endpoint (``docs/api.md``; debt #4). Answering 404 for a foreign id (rather than 403) is deliberate: it stops a caller from probing ids to learn what exists in other projects. Extracting it here replaced the 14 hand-copied versions the module docstring describes.

.. CG-EXPLANATION-END id=function:get_in_project_or_404

Function ``def litho_layer_write_conflict``
-------------------------------------------

.. CG-BLOCK id=function:litho_layer_write_conflict lines=246-295

.. literalinclude:: ../../../src/groundmodel/api/routers/_helpers.py
   :language: python
   :lines: 246-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:litho_layer_write_conflict

**What this does.** Turns a database integrity error raised while saving litho layers into the right client answer: a ``409`` naming an overlap when the no-overlap rule was the cause, or a ``422`` "write rejected" for any other violation.

**Why it is here.** The constraint name is checked rather than assumed, because a different violation (a depth-ordering check, a missing value, a bad foreign key) is a rejected write, not an overlap conflict, and reporting "overlap" for it would send the engineer hunting for an overlap that does not exist. Either branch names the reason, so an unmapped violation never reaches the client as a bare 500.

.. CG-EXPLANATION-END id=function:litho_layer_write_conflict

