groundmodel.api.schemas.virtuele_boring
=======================================

.. CG-PAGE source=src/groundmodel/api/schemas/virtuele_boring.py complete=true

*Source file:* ``src/groundmodel/api/schemas/virtuele_boring.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../src/groundmodel/api/schemas/virtuele_boring.py
   :language: python
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring naming the two Virtuele Boring surfaces (the model catalogue and the per-project predictions), then imports of the exact-value type helper, the id type, and Pydantic's base model and field helper.

**Why it is here.** Virtuele Boring is DOV's layered-model prediction service. This file's shapes mirror the application layer's result objects one-to-one, so the desktop can populate its model picker and draw prediction overlays from a live source.

.. CG-EXPLANATION-END id=module-header

Class ``VirtueleBoringLagenmodelEntry``
---------------------------------------

.. CG-BLOCK id=class:VirtueleBoringLagenmodelEntry lines=23-38

.. literalinclude:: ../../../src/groundmodel/api/schemas/virtuele_boring.py
   :language: python
   :lines: 23-38
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringLagenmodelEntry

**What this does.** One available DOV layered model: its code, a Dutch description (``beschrijving``), and the allowed resolutions.

**Why it is here.** The shape is passed through as DOV returns it (including the raw Dutch ``beschrijving``), so a new model DOV adds automatically appears in the desktop picker with no code change. This follows the project rule to pass raw upstream tokens through and translate only at the presentation boundary (Data Integrity Rule 2).

.. CG-EXPLANATION-END id=class:VirtueleBoringLagenmodelEntry

Class ``VirtueleBoringLayerResponse``
-------------------------------------

.. CG-BLOCK id=class:VirtueleBoringLayerResponse lines=39-57

.. literalinclude:: ../../../src/groundmodel/api/schemas/virtuele_boring.py
   :language: python
   :lines: 39-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringLayerResponse

**What this does.** One predicted layer at one investigation point: its DOV code and name, a Dutch description, top and base heights in mTAW, thickness, an optional colour, and an optional reference link.

**Why it is here.** It carries everything the renderer needs to draw the ghost column without a second catalogue lookup. The internal DOV code is kept for debugging and cross-referencing.

.. CG-EXPLANATION-END id=class:VirtueleBoringLayerResponse

Class ``VirtueleBoringInvestigationResponse``
---------------------------------------------

.. CG-BLOCK id=class:VirtueleBoringInvestigationResponse lines=58-74

.. literalinclude:: ../../../src/groundmodel/api/schemas/virtuele_boring.py
   :language: python
   :lines: 58-74
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringInvestigationResponse

**What this does.** One overlay row per investigation: whether it is a CPT or borehole, its id and name, its elevation, and a map from each requested model code to that model's predicted layers.

**Why it is here.** A missing key in the map means the prediction fetch failed for that investigation-and-model pair, which the desktop shows as a placeholder rather than as "no layers" — the two are different and the engineer must not confuse them.

.. CG-EXPLANATION-END id=class:VirtueleBoringInvestigationResponse

Class ``VirtueleBoringPredictionsResponse``
-------------------------------------------

.. CG-BLOCK id=class:VirtueleBoringPredictionsResponse lines=75-86

.. literalinclude:: ../../../src/groundmodel/api/schemas/virtuele_boring.py
   :language: python
   :lines: 75-86
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringPredictionsResponse

**What this does.** The full predictions payload: the requested model codes, the per-investigation rows, and a count of investigations skipped.

**Why it is here.** The skipped count reports investigations whose coordinate system was not the one DOV needs (or that lacked coordinates), so the desktop can explain the gap between how many investigations exist and how many the overlay could cover.

.. CG-EXPLANATION-END id=class:VirtueleBoringPredictionsResponse

