desktop.renderer.src.i18n.locales.en.outputs
============================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/outputs.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/outputs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/outputs.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``OUTPUTS`` catalogue — the words for the two stages that read the finished model rather than build it: Parameters and Export. It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language. The header points to ``locales/en/index.ts`` for the key-naming rules and the domain-canon carve-out — soil and NAD names are shown as recorded and translated only at the presentation boundary, never here.

.. CG-EXPLANATION-END id=module-header

``const OUTPUTS``
-----------------

.. CG-BLOCK id=const:OUTPUTS lines=7-309

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/outputs.ts
   :language: typescript
   :lines: 7-309
   :lineno-match:

.. CG-EXPLANATION-START id=const:OUTPUTS

**What this does.** The key-to-text pairs for the Parameters and Export stages. The parameters block (``params.*``) covers the per-test / per-unit / methods views, the water-table editor and its provenance labels, the per-unit distribution plots (qc / fs / Rf), the identification-test and grain-size panels, the fence cutout, the unit roster, the grouping bulk-bar, the NAD characteristic-values block, and the methods table listing each correlation with its published reference. The export block (``export.*``) covers the DXF, Plaxis 2D/3D, D-Stability, D-Sheet and PDF-report exports, the 3-D view modes and the fence-diagram export. Values with ``{n}``, ``{name}`` or ``{error}`` slots are filled in at display time.

**Why it is here.** The repeated "characterisation only" and "design parameter — Phase 5" strings encode the platform's scope boundary in the wording itself: the values shown here describe the ground, and design-ready parameters (phi-prime, c-prime, cu, E50, OCR, Vs) are not derived here. The method references cite the published sources only — Robertson & Wride (1998), Mayne (2007), Kulhawy & Mayne (2014), Uzielli (2013), Robertson (2015/2009) and the NAD table — so the credit in the interface points at the literature, not at any private workbook.

.. CG-EXPLANATION-END id=const:OUTPUTS

