desktop.renderer.src.components.BackendRestartingBanner
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/BackendRestartingBanner.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/BackendRestartingBanner.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/BackendRestartingBanner.tsx
   :language: tsx
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the "backend restarting" banner, shown while the main process is bringing a mid-session-crashed engine back. It imports ``useEffect`` and ``useState`` and the translator.

**Why it is here.** The docstring places it among its two neighbours: unlike the unreachable banner (a dead end — restart the app) and the failed modal (a fatal give-up), this one is hopeful — the main process noticed the engine died, is respawning it once, and will clear the banner when it is serving again or escalate to the failed modal if it does not. It exists so the reconnecting gap reads as "hang on" rather than as a storm of failed requests. It subscribes to the signals itself (rather than being handed them) so the top component stays lean, and it is guarded on the preload channels being present so an older preload or a test harness renders nothing instead of throwing.

.. CG-EXPLANATION-END id=module-header

``function BackendRestartingBanner``
------------------------------------

.. CG-BLOCK id=function:BackendRestartingBanner lines=36-84

.. literalinclude:: ../../../desktop/src/renderer/src/components/BackendRestartingBanner.tsx
   :language: tsx
   :lines: 36-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:BackendRestartingBanner

**What this does.** The banner component. It remembers whether a restart is in flight, and on mount subscribes to the main process's restarting, ready and failed signals — turning the flag on when a restart begins and off when the engine is ready again or has given up — cleaning up those subscriptions when it unmounts. It draws a top-centred amber "reconnecting" banner while restarting, and nothing otherwise.

**Why it is here.** The channel guard means a preload without these signals leaves the banner inert rather than crashing the render. It clears its state on the failed signal too, because at that point the fatal modal takes over and the two must not both show. It is marked up as a status message so assistive tools announce the reconnecting state politely.

.. CG-EXPLANATION-END id=function:BackendRestartingBanner

