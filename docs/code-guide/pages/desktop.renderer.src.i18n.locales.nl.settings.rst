desktop.renderer.src.i18n.locales.nl.settings
=============================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/settings.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/settings.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/settings.ts
   :language: typescript
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``SETTINGS_NL`` — the Dutch (Belgian) mirror of the English ``settings`` catalogue, for the Settings dialog. It is the Dutch side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language, checked key-for-key against English by the ``localeParity`` test. The header notes this file is WIRED (the SettingsDialog reads these keys today) and points to ``locales/nl/index.ts`` for the terminology rules.

.. CG-EXPLANATION-END id=module-header

``const SETTINGS_NL``
---------------------

.. CG-BLOCK id=const:SETTINGS_NL lines=5-99

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/settings.ts
   :language: typescript
   :lines: 5-99
   :lineno-match:

.. CG-EXPLANATION-START id=const:SETTINGS_NL

**What this does.** The Dutch strings for the Settings dialog, key for key against English, in the same four sections — the litho segmenter (headed "Lagenherkenning"), the geotechnical subdivision, cross-sections ("Dwarsprofielen"), and appearance (theme and interface language). Each control keeps its label-plus-hint shape and the same ``{default}`` / ``{min}`` / ``{max}`` slots as English.

**Why it is here.** The comments record owner rulings and judgement calls: the owner chose "Lagenherkenning" for the segmenter section, and "Dwarsprofielen" is FLAGGED against "Profielen" as the long form of a term that must win everywhere the same way (see the spine label). The appearance-language hint states the presentation-boundary promise in Dutch: field data keeps its source wording, so soil names, NAD packing classes and DOV codes are shown as recorded in every language.

.. CG-EXPLANATION-END id=const:SETTINGS_NL

