desktop.renderer.src.i18n.locales.en.settings
=============================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/settings.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/settings.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/settings.ts
   :language: typescript
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``SETTINGS`` catalogue — the words for the Settings dialog: its section headings, the scope labels (stored in the project vs on this device), and the label-and-hint text for every tuning control. It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language; the header notes this file is WIRED, meaning the SettingsDialog reads these keys in the running app today. It cites ``locales/en/index.ts`` for the key-naming rules and the domain-canon carve-out.

.. CG-EXPLANATION-END id=module-header

``const SETTINGS``
------------------

.. CG-BLOCK id=const:SETTINGS lines=6-94

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/settings.ts
   :language: typescript
   :lines: 6-94
   :lineno-match:

.. CG-EXPLANATION-START id=const:SETTINGS

**What this does.** The key-to-text pairs for the Settings dialog, grouped by the four sections it shows: the litho segmenter (minimum layer thickness, unit weight above water, sand Dr factor, merge-same-lithology, normalise-qc, section-fill mode, litho-stratigraphy snap, auto-correlate window, open-extent length, voxel sizes); the geotechnical subdivision (min band thickness, gradient snap and its window); cross-sections (default projection buffer, vertical exaggeration, tie-section tolerance); and appearance (theme and interface language). Each control has a short label plus a longer hint, and many hints carry a ``{default}``, ``{min}`` or ``{max}`` slot filled in at display time.

**Why it is here.** The hints explain in plain terms what each dial changes and when to reach for it — for example the vertical-cell voxel hint warns that a fine Z multiplies build time, and the appearance-language hint states the presentation-boundary promise directly: field data keeps its source wording, so soil names, NAD packing classes and DOV codes are shown as recorded in every language. The blurbs also note that a litho or geotech tuning applies only to the NEXT Suggest or Subdivide, leaving already-accepted work unchanged.

.. CG-EXPLANATION-END id=const:SETTINGS

