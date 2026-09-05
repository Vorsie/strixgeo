desktop.renderer.src.i18n.locales.nl.launch
===========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/launch.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/launch.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/launch.ts
   :language: typescript
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``LAUNCH_NL`` — the Dutch (Belgian) mirror of the English ``launch`` catalogue, for the onboarding, licence/activation and updater screens. Unlike most locale files it is typed as a partial list keyed against the English ``LAUNCH`` — meaning it may leave some keys out. It is the Dutch side.

**Why it is here.** Being typed a partial (``Partial<Record<keyof typeof LAUNCH, string>>``) is a safety net checked before the app runs: any Dutch key that does not exist in English is refused (so an English rename cannot leave an orphaned Dutch string behind), and any English key missing here simply falls back to the English string at run time, so a half-translated prototype still works. The header repeats that product and tier names (StrixGeo, Solo, Pro, Studio) and the demo keys are not here — they are raw product identifiers.

.. CG-EXPLANATION-END id=module-header

``const LAUNCH_NL``
-------------------

.. CG-BLOCK id=const:LAUNCH_NL lines=9-99

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/launch.ts
   :language: typescript
   :lines: 9-99
   :lineno-match:

.. CG-EXPLANATION-START id=const:LAUNCH_NL

**What this does.** The Dutch strings for the launch screens, key for key against English, in the same three groups: onboarding (welcome, the sample-or-empty choice, the skippable tour), licensing (the activation screen, its state labels and error/success toasts, the deactivate/transfer flow) and the updater notification. Values keep the same ``{days}`` / ``{version}`` / ``{percent}`` slots.

**Why it is here.** The words back the same behaviour designed in docs/design/onboarding-activation-updater-proto.md — a blocked build shows the activation screen instead of the workspace, and the deactivate/transfer strings drive an irreversible-action confirmation dialog. Because this is a prototype whose copy is still settling, leaving it a partial mirror lets untranslated keys fall back to English rather than block the screen.

.. CG-EXPLANATION-END id=const:LAUNCH_NL

