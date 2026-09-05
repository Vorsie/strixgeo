groundmodel.api.schemas.project.geotech_band_edit.geotech_band_edit_response
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_edit_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_edit_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_edit_response.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID`` (a universally-unique id — the long random identifier every stored row carries), the Pydantic tools, and the plan schema from the previous file.

**Why it is here.** The same request/response-schema pattern introduced on the plan-response page. It embeds the plan schema so a committed edit reports the same preview shape.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechBandEditResponse``
---------------------------------

.. CG-BLOCK id=class:GeotechBandEditResponse lines=14-69

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_edit_response.py
   :language: python
   :lines: 14-69
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBandEditResponse

**What this does.** The shape returned after a split or merge is actually committed: the model and single column that changed, the plan that was carried out, and several lists of row and correlation ids — the resulting bands, the rows created and deleted, the ties (correlation links) flagged for review, cleared, or dropped, and the subset of dropped ties the engineer had personally accepted.

**Why it is here.** Recalculation is local to one column, so the response names only that column — no other column's classes moved. The docstring records the flag-not-drop change (2026-08-07): accepted ties that no longer match are now flagged for review rather than deleted, so ``deleted_edge_ids`` is narrower than before, and ``deleted_accepted_edge_ids`` is separated out because a withdrawn machine proposal and a deleted accepted tie mean opposite things to the engineer. Returning the full outcome lets the desktop update its view without a second request.

.. CG-EXPLANATION-END id=class:GeotechBandEditResponse

