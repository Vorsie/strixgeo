desktop.renderer.src.i18n.locales.en.launch
===========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/launch.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/launch.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/launch.ts
   :language: typescript
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``LAUNCH`` catalogue — the words for the three launch-prototype screens: the first-launch onboarding overlay, the licence/activation screen, and the update-available notification. It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language. The header records one deliberate exception: the product name and the paid-tier names (StrixGeo, Solo, Pro, Studio) and the demo licence keys are NOT translated — they are product identifiers, always rendered as their raw tokens, never routed through a second vocabulary. It cites docs/design/onboarding-activation-updater-proto.md, which is where the onboarding, activation and updater behaviour is designed.

.. CG-EXPLANATION-END id=module-header

``const LAUNCH``
----------------

.. CG-BLOCK id=const:LAUNCH lines=9-105

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/launch.ts
   :language: typescript
   :lines: 9-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:LAUNCH

**What this does.** The key-to-text pairs for the launch screens, in three groups: onboarding (``onboarding.*``) — the welcome, the load-sample-or-start-empty choice, and the skippable six-stage tour; licensing (``licensing.*``) — the activation screen with its status, the enter-key and Activate/Start-trial actions, the deactivate/transfer flow, the state labels (Not activated, Trial, Active, Offline grace, Expired…), and the error and success toasts; and updater (``updater.*``) — checking, available, downloading, ready-to-install and up-to-date messages. Values with ``{days}``, ``{version}`` or ``{percent}`` slots are filled in at display time.

**Why it is here.** The deactivate/transfer strings back an irreversible action, so the comment notes they drive a confirmation dialog (docs/ux.md). The state labels mirror the licence "states" the app decides between — a blocked build (not activated, expired, clock problem) shows the activation screen instead of the workspace, while active and the 30-day offline grace pass straight through. The demo-keys hint exists only because this is a prototype; a shipped build would not print licence keys on screen.

.. CG-EXPLANATION-END id=const:LAUNCH

