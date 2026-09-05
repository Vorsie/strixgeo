desktop.renderer.src.i18n.locales.en.sections
=============================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/sections.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/sections.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/sections.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``SECTIONS`` catalogue — the words for the cross-section stage: the section canvas, its toolbar, the inspector, the section header, the right-click context menus and the on-canvas overlay hints. The comment calls it the largest single surface in the app. It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language. It cites ``locales/en/index.ts`` for the key-naming rules and the domain-canon carve-out — soil and NAD tokens are translated only at the presentation boundary, never here.

.. CG-EXPLANATION-END id=module-header

``const SECTIONS``
------------------

.. CG-BLOCK id=const:SECTIONS lines=7-854

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/sections.ts
   :language: typescript
   :lines: 7-854
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTIONS

**What this does.** The key-to-text pairs for the whole cross-section stage — by far the longest catalogue. It covers the section list, properties and model-actions in the inspector; the axis pill that switches between the Stratigraphy, Litho and Geotech models; every toolbar verb and its dropdown menus for all three axes (Suggest, Correlate, Bodies, Admixtures on the litho axis; the four-step Packing pipeline, Correlate-packing and the qc-statistic on the geotech axis); the export dropdown (DXF, Plaxis, D-Stability, D-Sheet, PDF); the tie-section flow; the CPT-channel and borehole-stream header toggles; the pan/zoom and layer-drag hints; the context menus; the lens, band-edit and correlation dialogs; and the whole family of result toasts. Values with ``{n}``, ``{name}``, ``{level}`` or ``{depth}`` slots are filled in at display time.

**Why it is here.** Because the same section edits all three model levels, model-level words (``sections.level.litho`` / ``.geotech`` / ``.geological``) are their own keys so a tooltip like "No active {level} model" reads grammatically in each language. The comments record owner rulings behind the wording — the body verbs were cut to Join and Un-join only (owner 2026-09-01, "way too complicated"), and the cross-body Join refusal is two messages picked by whether the soils differ (``crossPacking`` vs ``crossLitho``). Long tooltips spell out the multi-step pipeline behaviour verbatim so the interface teaches the workflow as the engineer hovers.

.. CG-EXPLANATION-END id=const:SECTIONS

