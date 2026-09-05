groundmodel.application.import_cpt
==================================

.. CG-PAGE source=src/groundmodel/application/import_cpt.py complete=true

*Source file:* ``src/groundmodel/application/import_cpt.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-78

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 1-78
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the CPT-import file. It brings in the tools the import needs — the GEF file parser, the ``CptRepository`` (the object that reads and writes CPT rows in the database, so this file never writes raw SQL), the two database row shapes (``CptOrm`` for the header and ``CptSeriesOrm`` for the depth arrays), the elevation and water-table provenance markers, and the three refresh-related error types — and then defines two lists: ``_REFRESHED_COLUMNS`` (the header fields a re-import overwrites) and ``_REFRESHED_SERIES_COLUMNS`` (the measurement arrays it overwrites).

**Why it is here.** The two lists put the re-import policy in one place, and the comment above them spells out what is deliberately left OUT: the row id, project scope and creation time (every other table points at the id, so it must never change); the elevation and the engineer's water table (a hand edit outranks the file — debt #8); and the ``original_*`` rollback snapshots (those belong to the engineer's override history, not to the file). This is the ``Idempotency on ingest`` rule in CLAUDE.md: re-importing a file must refresh the existing row, never duplicate or wipe it.

.. CG-EXPLANATION-END id=module-header

Function ``def max_depth_m``
----------------------------

.. CG-BLOCK id=function:max_depth_m lines=79-101

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 79-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:max_depth_m

**What this does.** A small function that returns the deepest reading in a parsed CPT table, or nothing when the table is empty.

**Why it is here.** The docstring calls it the single source of truth for the stored ``max_depth_m`` summary: the value written on import and the old-versus-new difference shown when a re-import asks for confirmation are computed by this one function, so they agree by construction rather than by two copies of the same arithmetic drifting apart.

.. CG-EXPLANATION-END id=function:max_depth_m

Class ``ImportCpt`` — header
----------------------------

.. CG-BLOCK id=class:ImportCpt lines=102-118

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 102-118
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportCpt

**What this does.** Opens the ``ImportCpt`` class — the use case that parses one CPT file and saves it. The docstring gives a worked call example.

**Why it is here.** The docstring defines the term: a use case is one self-contained operation that arranges parsers and repositories without holding any geotechnical logic itself, and it owns exactly one database transaction (a unit of work that either fully happens or not at all). The session handed in is committed when the import succeeds and left for the caller to undo when it fails.

.. CG-EXPLANATION-END id=class:ImportCpt

Method ``ImportCpt``. ``def __init__``
--------------------------------------

.. CG-BLOCK id=method:ImportCpt.__init__ lines=119-124

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 119-124
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt.__init__

**What this does.** Stores the database session passed in and builds the CPT repository around it.

**Why it is here.** The caller owns the session; the use case only borrows it. Building the repository once here means every method below shares the same open transaction.

.. CG-EXPLANATION-END id=method:ImportCpt.__init__

Method ``ImportCpt``. ``async def execute``
-------------------------------------------

.. CG-BLOCK id=method:ImportCpt.execute lines=125-169

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 125-169
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt.execute

**What this does.** The public entry point. It reads the file's bytes, parses them, picks a display name (the test id, or the file name when the test id is blank), and hands off to ``persist`` — forwarding whether the caller has already consented to overwriting an existing CPT.

**Why it is here.** The file name is logged at DEBUG, not INFO, because a GEF file name carries the client's project or site code and the log file on disk is not redacted; the always-on completion line instead carries the stable ``cpt_id`` (owner: no user data leaks).

.. CG-EXPLANATION-END id=method:ImportCpt.execute

Method ``ImportCpt``. ``async def persist``
-------------------------------------------

.. CG-BLOCK id=method:ImportCpt.persist lines=170-300

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 170-300
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt.persist

**What this does.** The heart of the import. It refuses a file with no position or no coordinate-system code; then, when the same CPT already exists in this project, it either refuses an unusable re-parse, asks for confirmation, or refreshes the row in place; otherwise it maps the parse to a fresh database row, saves it, and (unless a bulk caller asked to defer) commits once. It returns the saved id plus the parse issues.

**Why it is here.** A position is mandatory because a CPT with no coordinate-system-tagged location cannot be placed on a map. The refresh branch is the consented-refresh contract in docs/api.md: a re-import is irreversible, so without consent it stops and reports the difference rather than overwriting. The order — refuse an unusable parse BEFORE asking for consent — is deliberate: no confirmation may authorise replacing a good series with an empty one. The ``commit`` switch lets a bulk import stage many CPTs and commit them all at once instead of paying one disk sync per CPT.

.. CG-EXPLANATION-END id=method:ImportCpt.persist

Method ``ImportCpt``. ``def _refuse_unusable_refresh``
------------------------------------------------------

.. CG-BLOCK id=method:ImportCpt._refuse_unusable_refresh lines=301-354

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 301-354
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt._refuse_unusable_refresh

**What this does.** Blocks a re-import when the fresh parse has zero data rows or carries ERROR-level problems, raising a refusal in either case.

**Why it is here.** Both shapes would replace a real measurement with a worse one, and a refresh has no undo, so neither is recoverable by confirming (docs/api.md: this is the 422 ``cpt_refresh_refused`` case). The warning logs the stored CPT's id, not its name, because the name is the test id and encodes the client's site code; the raised message still names the CPT, because that text is shown to the engineer looking at their own project.

.. CG-EXPLANATION-END id=method:ImportCpt._refuse_unusable_refresh

Method ``ImportCpt``. ``def _confirmation_required``
----------------------------------------------------

.. CG-BLOCK id=method:ImportCpt._confirmation_required lines=355-398

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 355-398
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt._confirmation_required

**What this does.** Builds the confirmation refusal, packing in the old-versus-new comparison: row counts, maximum depths, and how many errors and warnings the fresh parse carries.

**Why it is here.** A refresh destroys the stored series with no undo, so it is never automatic (docs/api.md: the 409 ``cpt_refresh_confirmation_required`` answer). The engineer sees the difference in a dialog and decides. Again the numeric diff is logged (it carries no client identity) while the name stays at DEBUG.

.. CG-EXPLANATION-END id=method:ImportCpt._confirmation_required

Method ``ImportCpt``. ``async def _refresh``
--------------------------------------------

.. CG-BLOCK id=method:ImportCpt._refresh lines=399-522

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 399-522
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt._refresh

**What this does.** Overwrites an existing CPT from a fresh parse while keeping its id. It copies the refreshed header columns, keeps a manual collar elevation and an engineer-set water table when present (otherwise takes the file's), replaces the depth arrays in place, and flips the derived 3-D caches to stale.

**Why it is here.** Re-importing is how a parser fix reaches a project the engineer already imported into; the alternative — delete then re-import — would destroy every interpretation anchored to the row, so the row is updated in place and its id, scope, review status and every referencing row survive. A manual elevation outranks the file (debt #8); an engineer's water table outranks it too, because the whole Robertson normalisation hangs off that number and a silent re-parse would re-interpret a column the engineer already read. The series is mutated rather than swapped because the series id equals the CPT id, so a delete-plus-insert of the same key in one flush can trip the primary-key constraint. The caches are staled because a corrected series moves every contact anchored on it.

.. CG-EXPLANATION-END id=method:ImportCpt._refresh

Method ``ImportCpt``. ``def _parse``
------------------------------------

.. CG-BLOCK id=method:ImportCpt._parse lines=523-536

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 523-536
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt._parse

**What this does.** Chooses the parser by file extension — a ``.gef`` file goes to the GEF parser; anything else is refused.

**Why it is here.** Format is determined by extension, and the comment notes that GEF is the only CPT format supported in Phase 1 (AGS and LAS are Phase 2).

.. CG-EXPLANATION-END id=method:ImportCpt._parse

Method ``ImportCpt``. ``def _to_orm``
-------------------------------------

.. CG-BLOCK id=method:ImportCpt._to_orm lines=537-600

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 537-600
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt._to_orm

**What this does.** Maps a parse result into the database row pair: the ``CptOrm`` header plus its ``CptSeriesOrm`` depth arrays. It asserts the coordinates are present, stamps the elevation and water-table provenance markers, and deliberately drops the corrected cone resistance from the stored series.

**Why it is here.** The asserts let a future refactor that bypasses ``persist`` crash loudly rather than write meaningless zero coordinates. The provenance stamps record where a value came from so a later refresh can overwrite a file-derived value without clobbering a manual one (debt #8). The corrected cone resistance (qt) is not persisted per Data Integrity Rule 1 and the ``q_total_mpa`` versus ``qt_mpa`` separation — it is recomputed on read, never stored.

.. CG-EXPLANATION-END id=method:ImportCpt._to_orm

Method ``ImportCpt``. ``def _make_point``
-----------------------------------------

.. CG-BLOCK id=method:ImportCpt._make_point lines=601-606

.. literalinclude:: ../../../src/groundmodel/application/import_cpt.py
   :language: python
   :lines: 601-606
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportCpt._make_point

**What this does.** Builds a PostGIS map point in the file's own coordinate system, or nothing when coordinates are missing.

**Why it is here.** The stored geometry is what lets the CPT answer spatial (map and nearest-neighbour) queries; keeping it in the native coordinate system means no lossy conversion happens at import time.

.. CG-EXPLANATION-END id=method:ImportCpt._make_point

