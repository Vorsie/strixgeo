groundmodel.api.schemas.project.geotech_suggestion.divide_borehole_preview_response
===================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_preview_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_preview_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_preview_response.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining why the preview payload is three nested schemas (model, column, band), then imports of ``UUID`` and the Pydantic tools.

**Why it is here.** The docstring gives two reasons: the payload is a tree the renderer draws one ghost rectangle per band from, so the three schemas are one wire shape, meaningless apart; and NO NAD label text is sent — only the class integer, because the English names live in the desktop's lookup and CLAUDE.md's translate-at-the-presentation-boundary rule keeps them there, so a label copied here would be a second place to update.

.. CG-EXPLANATION-END id=module-header

Class ``DivideBoreholePreviewDonor``
------------------------------------

.. CG-BLOCK id=class:DivideBoreholePreviewDonor lines=21-50

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_preview_response.py
   :language: python
   :lines: 21-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholePreviewDonor

**What this does.** One CPT a previewed band's packing was read from: its name, which side of the borehole it sat on (or "nearest" in the map-distance fallback), and its distance along the section and across the map.

**Why it is here.** This is the tooltip provenance — which test spoke and how far away — so the engineer can see the evidence; a band with no donors was filled conservatively with no CPT behind it (Data Integrity Rule 1: provenance is tracked).

.. CG-EXPLANATION-END id=class:DivideBoreholePreviewDonor

Class ``DivideBoreholePreviewBand``
-----------------------------------

.. CG-BLOCK id=class:DivideBoreholePreviewBand lines=51-117

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_preview_response.py
   :language: python
   :lines: 51-117
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholePreviewBand

**What this does.** One packing band the commit would write on a borehole column: its depth range, NAD class, a provenance source and confidence, the mode by which the packing was reached, the donor CPTs, and the section they were read along.

**Why it is here.** The docstring's key note is a deliberate omission: there is NO body id, because the commit re-stamps every band's body after the fact, so a body id reported now is a value the commit would change — and the parity test caught exactly that. Only fields the plan genuinely owns are promised. The ``mode`` field is additive and optional so an older client keeps working.

.. CG-EXPLANATION-END id=class:DivideBoreholePreviewBand

Class ``DivideBoreholePreviewColumn``
-------------------------------------

.. CG-BLOCK id=class:DivideBoreholePreviewColumn lines=118-138

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_preview_response.py
   :language: python
   :lines: 118-138
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholePreviewColumn

**What this does.** Every planned band on one borehole column, top to bottom: the borehole id, its display name, and the list of bands.

**Why it is here.** The name is included so the desktop never has to resolve the id itself; a plain grouping of the tree's middle level.

.. CG-EXPLANATION-END id=class:DivideBoreholePreviewColumn

Class ``DivideBoreholePreviewResponse``
---------------------------------------

.. CG-BLOCK id=class:DivideBoreholePreviewResponse lines=139-202

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_preview_response.py
   :language: python
   :lines: 139-202
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholePreviewResponse

**What this does.** The top of the preview tree: the model a commit would write into, the per-borehole columns, and a set of summary counts (boreholes, how many would be divided into several bands versus one, total rows, and how many accepted ties would be carried, flagged, or lost).

**Why it is here.** The docstring stresses nothing is persisted — the request issues only reads and the session is rolled back — and it is produced by the SAME planner the commit uses, so every band shown is a band the button would write and the preview and commit counts are comparable.

.. CG-EXPLANATION-END id=class:DivideBoreholePreviewResponse

