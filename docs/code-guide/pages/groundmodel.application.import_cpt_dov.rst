groundmodel.application.import_cpt_dov
======================================

.. CG-PAGE source=src/groundmodel/application/import_cpt_dov.py complete=true

*Source file:* ``src/groundmodel/application/import_cpt_dov.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_dov.py
   :language: python
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the DOV-CPT bulk-import file. It gathers the shared WFS-fetch wrapper, the single-file ``ImportCpt`` use case it reuses, the DOV client / parser / on-disk XML cache, the feature-count ceiling, and the progress and rate-limit helpers, and defines the type and helper for the ``pins`` callback.

**Why it is here.** DOV (Databank Ondergrond Vlaanderen) is Flanders' public subsurface database; WFS is its map-query web service and a bbox is a rectangle of coordinates. This module runs the 5-phase DOV pipeline in docs/parsers-dov.md. The ``pins`` callback exists so the map can show every pending marker the instant discovery finishes, before any download starts.

.. CG-EXPLANATION-END id=module-header

Function ``async def _fire_pins``
---------------------------------

.. CG-BLOCK id=function:_fire_pins lines=38-71

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_dov.py
   :language: python
   :lines: 38-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:_fire_pins

**What this does.** Calls the pins callback with the discovered index, awaiting it when it is asynchronous, and turns any callback failure into a warning instead of an error.

**Why it is here.** The callback usually pushes a server-sent event (SSE — a one-way stream of progress messages to the desktop). A broken SSE connection is the common failure, and the docstring says it must never abort the import, so the error is logged and swallowed.

.. CG-EXPLANATION-END id=function:_fire_pins

Class ``ImportCptDov`` — header
-------------------------------

.. CG-BLOCK id=class:ImportCptDov lines=72-98

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_dov.py
   :language: python
   :lines: 72-98
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportCptDov

**What this does.** Opens the DOV bulk-CPT use case. The docstring lays out its two phases — a fast WFS index pass that lets the map paint pending pins, then the heavy download-parse-persist pass — and states the atomic-import contract.

**Why it is here.** It reuses ``ImportCpt.persist`` so validation, duplicate detection and row-mapping are shared with the single-file path (do not repeat logic). The docstring records the deliberate contract: every parsed CPT is staged without committing and the whole batch lands in one commit, so a failure rolls the batch back rather than leaving a half-imported project (docs/parsers-dov.md).

.. CG-EXPLANATION-END id=class:ImportCptDov

Method ``ImportCptDov``. ``def __init__``
-----------------------------------------

.. CG-BLOCK id=method:ImportCptDov.__init__ lines=99-112

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_dov.py
   :language: python
   :lines: 99-112
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCptDov.__init__

**What this does.** Stores the session, builds the reused single-file importer and the repository, and constructs the persistent on-disk XML cache from settings.

**Why it is here.** DOV measurement data is historical and never changes, so a cached XML is valid forever; building the cache once per use case (not per request) means the directory-creation line only logs once.

.. CG-EXPLANATION-END id=method:ImportCptDov.__init__

Method ``ImportCptDov``. ``async def execute``
----------------------------------------------

.. CG-BLOCK id=method:ImportCptDov.execute lines=113-331

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_dov.py
   :language: python
   :lines: 113-331
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCptDov.execute

**What this does.** Runs the whole bbox import. Phase 1 asks WFS which CPTs sit in the box and fires the pins event; a runaway count is refused here. Phase 2 downloads and parses every XML in parallel. Phase 3 runs one batch duplicate query for all incoming test ids. Phase 4 saves the non-duplicates without committing, isolating each per-CPT failure. Phase 5 commits the whole batch once. It reports imported, duplicate and failed counts plus the ids.

**Why it is here.** This is the 5-phase pipeline of docs/parsers-dov.md, cache-first and single-commit. The count ceiling is refused before pins so a too-large import never even paints markers. Progress fires at every phase boundary so the desktop can show a live bar. The commit is deferred to Phase 5 so all inserts land in one network exchange, and a single bad XML is counted, not fatal — the ``[i/total]`` prefix on the per-CPT log is the bulk-loop progress rule from the Definition of Done.

.. CG-EXPLANATION-END id=method:ImportCptDov.execute

