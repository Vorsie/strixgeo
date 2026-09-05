desktop.renderer.src.api.clients.codelist
=========================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/codelist.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/codelist.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and import for the codelist and Virtuele Boring client. It covers two things: the static reference catalogues shipped with each build (the G3Dv3 Flanders stratigraphy and the DOV formal-stratigraphy list), and DOV's synthetic-borehole overlays — informative-only predictions from DOV's 3D models.

**Why it is here.** These reads share one file because both are lookup data rather than project state. Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page (here only its ``get`` wrapper is needed).

.. CG-EXPLANATION-END id=module-header

``interface G3Dv3UnitResponse``
-------------------------------

.. CG-BLOCK id=interface:G3Dv3UnitResponse lines=26-42

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 26-42
   :lineno-match:

.. CG-EXPLANATION-START id=interface:G3Dv3UnitResponse

**What this does.** Describes one unit from the Flanders stratigraphic catalogue: its numeric code and abbreviation, whether it is a formation or a member, its parent when it is a member, the Dutch name, an age rank, and a prescribed colour.

**Why it is here.** The docstring says it powers the formation dialog's autocomplete and colour autofill so engineers do not retype canonical names and colours. The Dutch name and codes are raw catalogue tokens; the colour is nullable for the rare unit with no colour row.

.. CG-EXPLANATION-END id=interface:G3Dv3UnitResponse

``interface G3Dv3CatalogResponse``
----------------------------------

.. CG-BLOCK id=interface:G3Dv3CatalogResponse lines=43-56

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 43-56
   :lineno-match:

.. CG-EXPLANATION-START id=interface:G3Dv3CatalogResponse

**What this does.** Describes the whole catalogue answer — simply a list of units.

**Why it is here.** A thin wrapper so the endpoint returns one named object rather than a bare list.

.. CG-EXPLANATION-END id=interface:G3Dv3CatalogResponse

``interface FormalStratigraphyUnitResponse``
--------------------------------------------

.. CG-BLOCK id=interface:FormalStratigraphyUnitResponse lines=57-66

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 57-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormalStratigraphyUnitResponse

**What this does.** Describes one DOV formal-stratigraphy unit: its code, canonical Dutch name, age rank and colour.

**Why it is here.** The docstring says it powers the informal-to-formal link in the formation dialog — picking one stores its code on the formation. The code and name are raw DOV tokens.

.. CG-EXPLANATION-END id=interface:FormalStratigraphyUnitResponse

``interface FormalStratigraphyCatalogResponse``
-----------------------------------------------

.. CG-BLOCK id=interface:FormalStratigraphyCatalogResponse lines=67-79

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 67-79
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormalStratigraphyCatalogResponse

**What this does.** Describes the whole formal-stratigraphy answer — a list of units.

**Why it is here.** A thin wrapper matching the G3Dv3 catalogue shape.

.. CG-EXPLANATION-END id=interface:FormalStratigraphyCatalogResponse

``interface VirtueleBoringLagenmodelEntry``
-------------------------------------------

.. CG-BLOCK id=interface:VirtueleBoringLagenmodelEntry lines=80-86

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 80-86
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtueleBoringLagenmodelEntry

**What this does.** Describes one entry in the Virtuele Boring model picker: its code, description, and the resolutions it offers.

**Why it is here.** The docstring points to the design rationale in CLAUDE.md debt #10; the description is a raw DOV token.

.. CG-EXPLANATION-END id=interface:VirtueleBoringLagenmodelEntry

``interface VirtueleBoringLayer``
---------------------------------

.. CG-BLOCK id=interface:VirtueleBoringLayer lines=87-98

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 87-98
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtueleBoringLayer

**What this does.** Describes one predicted layer from a DOV 3D model at a chosen investigation: code, name and description, its top and base in mTAW, thickness, colour, and an optional reference link.

**Why it is here.** It is the shape of a single synthetic-borehole band drawn as an informative overlay; the descriptive tokens stay raw.

.. CG-EXPLANATION-END id=interface:VirtueleBoringLayer

``interface VirtueleBoringInvestigationPrediction``
---------------------------------------------------

.. CG-BLOCK id=interface:VirtueleBoringInvestigationPrediction lines=99-109

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 99-109
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtueleBoringInvestigationPrediction

**What this does.** Describes the prediction for one investigation: whether it is a CPT or a borehole, its id and name, its elevation, and its predicted layers grouped by the model codes that were requested.

**Why it is here.** The comment records that a model key missing from the grouping means the per-call fetch failed for that investigation-and-model pair — recording what was NOT found rather than silently dropping it.

.. CG-EXPLANATION-END id=interface:VirtueleBoringInvestigationPrediction

``interface VirtueleBoringPredictionsResponse``
-----------------------------------------------

.. CG-BLOCK id=interface:VirtueleBoringPredictionsResponse lines=110-120

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 110-120
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtueleBoringPredictionsResponse

**What this does.** Describes the whole predictions answer: the models requested, one prediction per investigation, and a count of how many were skipped.

**Why it is here.** The skipped count reports the investigations that could not be predicted, so the overlay can say what it left out.

.. CG-EXPLANATION-END id=interface:VirtueleBoringPredictionsResponse

``const codelistClient``
------------------------

.. CG-BLOCK id=const:codelistClient lines=121-131

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 121-131
   :lineno-match:

.. CG-EXPLANATION-START id=const:codelistClient

**What this does.** The object of typed calls for the static catalogues: fetch the G3Dv3 catalogue, or the formal-stratigraphy catalogue.

**Why it is here.** Two plain reads over the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page, wired under ``api.codelists``.

.. CG-EXPLANATION-END id=const:codelistClient

``const virtueleboringClient``
------------------------------

.. CG-BLOCK id=const:virtueleboringClient lines=132-143

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/codelist.ts
   :language: typescript
   :lines: 132-143
   :lineno-match:

.. CG-EXPLANATION-START id=const:virtueleboringClient

**What this does.** The object of typed calls for the DOV overlays: list the available layer models, or fetch per-investigation predictions for a project and a chosen set of models.

**Why it is here.** Both are reads over the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page; the predictions call joins the requested model codes into the query string.

.. CG-EXPLANATION-END id=const:virtueleboringClient

