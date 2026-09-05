desktop.renderer.src.api.clients.cpt
====================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/cpt.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/cpt.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the CPT client — the typed calls for every ``/cpt/*`` endpoint (list, detail, plot, batch-plot, delete, elevation edit, and import). It pulls the shared HTTP helpers from the shared layer and re-exports one type it borrows from the borehole client.

**Why it is here.** Each subject keeps its own client file with its request and response shapes co-located; this one owns everything CPT. Every call here goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page.

.. CG-EXPLANATION-END id=module-header

``interface CptListItem``
-------------------------

.. CG-BLOCK id=interface:CptListItem lines=21-44

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 21-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptListItem

**What this does.** Describes one summary row in the CPT list: id, name, type, max depth, row count, location, coordinate system, surface elevation and where that elevation came from, and the raw start date.

**Why it is here.** An *interface* is a note listing the fields a value carries. Several fields are marked "or null" — an optional value by design, matching the additive-only API rule where new fields arrive as nullable. The comments record why some fields ride along on the list row: the elevation is here so the sidebar can show a "needs Z" badge without a second fetch, and ``elevation_source`` and ``start_date`` are raw pass-through tokens from the GEF/DOV parser — the desktop normalises the date before comparing or showing it, honouring the store-raw, translate-at-the-boundary rule.

.. CG-EXPLANATION-END id=interface:CptListItem

``interface CptResponse``
-------------------------

.. CG-BLOCK id=interface:CptResponse lines=45-67

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 45-67
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptResponse

**What this does.** Describes the metadata answer for a single CPT (no depth series): identity, location, elevation and its source, pre-drill depth, cone area ratio, the depth to groundwater and where it came from, and the depth and row totals.

**Why it is here.** The nullable fields are additive-by-design. The comments note two provenance rules: every DOV-imported CPT has no recorded water depth (hence null), and a water table typed by the engineer is stamped ``engineer`` and is deliberately not overwritten by a later re-import of the same file — a derived-value provenance rule.

.. CG-EXPLANATION-END id=interface:CptResponse

``type GwtProvenance``
----------------------

.. CG-BLOCK id=type:GwtProvenance lines=68-82

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 68-82
   :lineno-match:

.. CG-EXPLANATION-START id=type:GwtProvenance

**What this does.** Names the three possible origins of the water table a derived profile used: ``recorded``, ``engineer`` or ``assumed``.

**Why it is here.** Fixing the set to three tokens lets any screen drawing a normalised profile state which water table it was computed under, which Data Integrity Rule 1 requires for a derived value.

.. CG-EXPLANATION-END id=type:GwtProvenance

``interface CptSbtProfileResponse``
-----------------------------------

.. CG-BLOCK id=interface:CptSbtProfileResponse lines=83-98

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 83-98
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptSbtProfileResponse

**What this does.** Describes the answer from the SBT-profile endpoint: the depth points, and alongside them both Robertson soil-behaviour-type classifications — the normalised index Ic and its zone, and the non-normalised index and its zone — plus the water table used and its provenance.

**Why it is here.** The docstring records that the arrays run shallow-to-deep in step with the plot response so both draw on one shared depth axis, that a ``null`` marks a depth neither classifier could evaluate and is never a filled-in guess, and that the water-table provenance applies only to the normalised columns (Data Integrity Rule 1). These are characterisation outputs — Ic zone and the like are MVP outputs, not the design-ready parameters held to Phase 5.

.. CG-EXPLANATION-END id=interface:CptSbtProfileResponse

``interface WaterTablePatchBody``
---------------------------------

.. CG-BLOCK id=interface:WaterTablePatchBody lines=99-110

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 99-110
   :lineno-match:

.. CG-EXPLANATION-START id=interface:WaterTablePatchBody

**What this does.** Describes the tiny body sent when editing a CPT's water table: a single depth value, or null.

**Why it is here.** The docstring notes that sending null clears the value back to "nothing recorded", so the one field covers both setting and clearing.

.. CG-EXPLANATION-END id=interface:WaterTablePatchBody

``interface CptPlotResponse``
-----------------------------

.. CG-BLOCK id=interface:CptPlotResponse lines=111-124

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 111-124
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptPlotResponse

**What this does.** Describes the full plot payload — every depth series lined up on the same index: depths, cone resistance, sleeve friction, pore pressure, friction ratio, the two corrected-resistance columns, Ic, and where the friction ratio came from.

**Why it is here.** The docstring spells out the load-bearing distinction the schema keeps: ``qt_mpa`` (piezocone corrected resistance) and ``q_total_mpa`` (mechanical-cone total resistance) are physically different measurements and are never stored in the same column — an independent-quantities rule, so one is never silently derived from the other.

.. CG-EXPLANATION-END id=interface:CptPlotResponse

``interface ImportCptResponse``
-------------------------------

.. CG-BLOCK id=interface:ImportCptResponse lines=125-144

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 125-144
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ImportCptResponse

**What this does.** Describes the answer from importing a GEF file: the CPT id, whether the parse had errors, the list of issues, whether an existing row was refreshed in place, and the display name the backend saved.

**Why it is here.** The ``refreshed`` flag records the consented-refresh outcome: true (and HTTP 200) when a file already in the project overwrote the existing row keeping the same id, false (and 201) for a genuinely new CPT. The saved name rides along so the "refreshed" message can name the CPT without a follow-up fetch.

.. CG-EXPLANATION-END id=interface:ImportCptResponse

``interface CptRefreshDiff``
----------------------------

.. CG-BLOCK id=interface:CptRefreshDiff lines=145-163

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 145-163
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptRefreshDiff

**What this does.** Describes the old-versus-new comparison a refresh is decided on: the stored CPT's id and name, its current versus freshly-parsed max depth and row count, and the error and warning counts from the fresh parse.

**Why it is here.** The docstring records the consented-CPT-refresh rule (``docs/api.md``): when a re-import would overwrite an existing row the engine answers 409 with this diff and writes nothing, so the engineer decides on these numbers and the client re-posts with confirmation — replacing a stored series is irreversible and so is consented per file.

.. CG-EXPLANATION-END id=interface:CptRefreshDiff

``class CptRefreshConfirmationRequiredError``
---------------------------------------------

.. CG-BLOCK id=class:CptRefreshConfirmationRequiredError lines=164-173

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 164-173
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptRefreshConfirmationRequiredError

**What this does.** A failure value carrying the refresh diff, thrown when an import would overwrite an existing CPT.

**Why it is here.** The docstring stresses it is not really an error but the engine asking a question: the import is simply retried with confirmation if the engineer agrees and dropped if not. Carrying the diff as a field lets the confirm dialog show the old-versus-new numbers.

.. CG-EXPLANATION-END id=class:CptRefreshConfirmationRequiredError

``class DuplicateCptError``
---------------------------

.. CG-BLOCK id=class:DuplicateCptError lines=174-191

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 174-191
   :lineno-match:

.. CG-EXPLANATION-START id=class:DuplicateCptError

**What this does.** A failure value carrying the existing CPT's id, thrown for the older duplicate case where a caller opted out of the refresh flow.

**Why it is here.** It preserves the legacy 409 behaviour for callers that do not want the consented-refresh diff, still handing back the existing id so the caller can react.

.. CG-EXPLANATION-END id=class:DuplicateCptError

``const PLOT_BATCH_MAX_IDS``
----------------------------

.. CG-BLOCK id=const:PLOT_BATCH_MAX_IDS lines=192-194

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 192-194
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLOT_BATCH_MAX_IDS

**What this does.** Sets the cap to 500 — the most CPT ids the batch-plot endpoint accepts in one request.

**Why it is here.** The comment records that the backend schema rejects a body over 500 ids with a 422, that a dense project can project up to ~5000 CPTs onto one section, and that this value is kept in sync with the backend schema; the batch call splits its work at this size.

.. CG-EXPLANATION-END id=const:PLOT_BATCH_MAX_IDS

``const cptClient``
-------------------

.. CG-BLOCK id=const:cptClient lines=195-330

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/cpt.ts
   :language: typescript
   :lines: 195-330
   :lineno-match:

.. CG-EXPLANATION-START id=const:cptClient

**What this does.** The object of typed calls for every ``/cpt/*`` endpoint: list the project's CPTs, fetch one CPT's metadata, plot, or SBT profile; edit the water table or the elevation; fetch many plots at once; and import a GEF file. The batch-plot call splits a long id list into 500-id chunks fired in parallel and merged back in input order, and the import call reads the file over Electron's bridge, uploads it, and turns a 409 into the refresh or duplicate error.

**Why it is here.** Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page, except import, which uses a bare upload because it sends a file. The comments carry the discipline: a project id is required on every by-id call so a guessed id cannot leak a CPT from another project (the scope guard); the SBT call must pass the engineer's unit-weight settings so the normalised strip and the ghost boundaries agree; the water-table edit stamps ``engineer`` provenance a re-import will not overwrite; and the import consents the irreversible refresh per file (``docs/ux.md`` reversible-versus-irreversible) by throwing the diff when confirmation is not yet given.

.. CG-EXPLANATION-END id=const:cptClient

