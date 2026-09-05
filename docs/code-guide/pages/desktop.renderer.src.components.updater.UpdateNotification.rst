desktop.renderer.src.components.updater.UpdateNotification
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/updater/UpdateNotification.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/updater/UpdateNotification.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/components/updater/UpdateNotification.tsx
   :language: tsx
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment and the imports for the update notification — a small card in the bottom-right corner that reflects the app updater's progress. It imports React's hooks, a few icons, the Button, the translator hook, the logger, and the type describing an updater event. (An Electron app runs as two programs: the main process, with full access to the machine, and the renderer — the sandboxed web page the user sees; this is renderer code, and it talks to the main process over a fixed safe list of calls named ``window.electron.*``. A card is a small floating panel; a toast is a self-dismissing one.)

**Why it is here.** The comment records the behaviour and cites the design note (debt #6): an available update offers Download / Later, a download shows a progress bar, and a downloaded update offers Restart & install; the informational lines (up to date, disabled-in-dev, error, checking) only ever appear after a manual Help → Check for updates, because a development launch never auto-checks. It self-subscribes to the updater channel so ``App`` stays lean, and ALL the real update machinery is gated on ``app.isPackaged`` in the main process — so this card is inert in development except for the "disabled" acknowledgement. Because the feed is GitHub Releases with auto-download turned off, the renderer owns the Download choice.

.. CG-EXPLANATION-END id=module-header

``const INFO_PHASES``
---------------------

.. CG-BLOCK id=const:INFO_PHASES lines=23-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/updater/UpdateNotification.tsx
   :language: tsx
   :lines: 23-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:INFO_PHASES

**What this does.** A small set of the update phases that show a plain, dismissable one-line message rather than a full card: ``not-available``, ``disabled``, ``error`` and ``checking``. The comment block below is the manual for the component.

**Why it is here.** These phases are just acknowledgements with nothing for the user to do, so they get a quiet line with a close button instead of a card with action buttons.

.. CG-EXPLANATION-END id=const:INFO_PHASES

``function UpdateNotification``
-------------------------------

.. CG-BLOCK id=function:UpdateNotification lines=31-145

.. literalinclude:: ../../../desktop/src/renderer/src/components/updater/UpdateNotification.tsx
   :language: tsx
   :lines: 31-145
   :lineno-match:

.. CG-EXPLANATION-START id=function:UpdateNotification

**What this does.** The card itself. It remembers the latest updater event and whether the current one has been dismissed (values kept between redraws, called state). When it first appears on screen it subscribes once to the updater channel, and stores each event that arrives; every fresh event re-surfaces the card. It draws nothing at all until an event arrives — and nothing while idle or after the user dismisses one. Depending on the phase it then shows an "update available" card with Download / Later, a progress bar while downloading, a "downloaded" card with Restart & install / Later, or a one-line acknowledgement for the informational phases. Download and Restart ask the main process to act and log a warning if that fails.

**Why it is here.** The comments carry the reasons. The subscription is guarded so that a renderer running against an older preload — one that lacks the update channel — degrades to no notifications rather than crashing on the boot path. Auto-download is off, so the Download button is a deliberate user choice, never automatic. Every real action goes through the main process because only it may touch the updater.

.. CG-EXPLANATION-END id=function:UpdateNotification

