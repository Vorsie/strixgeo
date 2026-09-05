desktop.renderer.src.App
========================

.. CG-PAGE source=desktop/src/renderer/src/App.tsx complete=true

*Source file:* ``desktop/src/renderer/src/App.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-71

.. literalinclude:: ../../../desktop/src/renderer/src/App.tsx
   :language: tsx
   :lines: 1-71
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports for the whole application. In order they bring in: four React building blocks (``useEffect``, ``useMemo``, ``useState``, ``useCallback`` — the tools a component uses to remember values and run side tasks); roughly twenty of the app's own *hooks*, one per concern (toasts, boot, the map, the geological model, sections, investigation data, body recompute, the project lifecycle, the three recovery hooks, map state, the shell context, the project itself, undo/redo, a persisted set, theme); a few small utilities (set helpers, keyboard helper, the logger, a viewport filter); and roughly twenty presentational components (the welcome screen, the recovery prompt, the new-project dialog, the boot-error and backend-trouble screens, the CPT-refresh confirm dialog, the loading splash, the bundled dialogs, settings, the cheat-sheet). A clearly-marked group brings in the *launch prototypes* — the onboarding overlay, the tutorial overlay, the licensing dialog and the update notification — followed by the translation helper, three preference helpers (geotech subdivision, litho segmenter, section defaults), and finally ``AppShell`` and the shell context.

**Why it is here.** ``App`` is the single top *component* — the piece of interface that owns the app's state and wires every other piece together — so everything the app is built from is gathered here in one place. React itself has no opinion about structure; the app's convention is that each self-contained concern lives in its own ``use…`` hook and each screen in its own component, and ``App`` is the coordinator that holds them. The launch-prototype imports carry a pointer to ``docs/design/onboarding-activation-updater-proto.md`` because that licence / onboarding / updater layer is a reviewable prototype, not yet a finished feature. This file is knowingly large — it is the god-component tracked as debt #201, to be broken up later; the block comments below are the map that keeps it readable until then.

.. CG-EXPLANATION-END id=module-header

``type View``
-------------

.. CG-BLOCK id=type:View lines=72-73

.. literalinclude:: ../../../desktop/src/renderer/src/App.tsx
   :language: tsx
   :lines: 72-73
   :lineno-match:

.. CG-EXPLANATION-START id=type:View

**What this does.** Names a small *type* called ``View`` that can only be the text ``'map'`` or the text ``'chart'``.

**Why it is here.** A *type* is a note, checked before the app runs, that fixes the set of allowed values — so a stray ``'graph'`` is caught as a mistake rather than accepted. It records that a view can be exactly one of two things, the map or a depth chart, and nothing else.

.. CG-EXPLANATION-END id=type:View

``function App``
----------------

.. CG-BLOCK id=function:App lines=74-1539

.. literalinclude:: ../../../desktop/src/renderer/src/App.tsx
   :language: tsx
   :lines: 74-1539
   :lineno-match:

.. CG-EXPLANATION-START id=function:App

**What this does.** The whole application component. It follows one shape throughout: first it calls its hooks and declares its state and handlers, and only at the very end does it decide what to draw. The hooks come first and always in the same order (React's *rules of hooks*): toasts (small corner messages) are set up first because other hooks are handed the ``toast`` function; then ``useProject`` (the open project, its saved copy, the unsaved-changes flag, the file path, the stratigraphy-lumping map, the manifest of which investigations belong to the project, and every open / save / restore / close action); then the activation-gate state and ``useAppBoot`` (which only starts waiting for the engine once the gate reads ``'pass'``); then theme, undo/redo, and a keyboard listener for Ctrl+Z / Ctrl+Y. The long middle wires the rest: investigation data (CPT and borehole lists), the geological and litho models, sections, body recompute, the three crash-recovery hooks, map state and overlays, the value shared through the shell context, the launch-prototype handlers (onboarding, licence status changes, update events), and the three preference readers. Then comes the render. A few pieces — the backend-failed modal and the two backend-trouble banners — are prepared once and drawn in every branch, because the engine can fall over at any instant and the branch that happens to be on screen must not decide whether the engineer is told. After that the *gate guards* run in order, each returning early: if the activation gate says ``'block'`` it shows the licence dialog full-window instead of the app; if the boot ended in error it shows the boot-error screen; if the engine is not ready yet it shows the loading splash; if no project is open it shows the welcome screen (with the recovery prompt and onboarding layered on); otherwise it draws the real workspace — ``AppShell`` filling the window, the backend banners above it, the CPT-refresh confirm dialog, and the app-level overlays (toasts and the global dialogs).

**Why it is here.** Every hook sits above every early ``return`` on purpose: React's *rules of hooks* require the same hooks to be called in the same order on every redraw, so a ``return`` must never come before a hook, or the app crashes on the next render. Keeping all the guards at the bottom (change R5, debt #12) also lets ``App`` read top-to-bottom as "coordinator, then a scannable list of which screen wins". The order of the guards encodes the boot story from ``docs/design/onboarding-activation-updater-proto.md`` and the boot design: the licence gate comes before the boot checks because a blocked packaged build has its engine deferred, so the "Starting StrixGeo API…" splash would otherwise wait forever (installer #8); ``active`` and ``grace`` verdicts pass straight through, honouring the 30-day offline grace so a month on site with no internet is a non-event. Recovery is offered from the welcome branch because a crash loses no interpretation — the database outlives the window — only a small unsaved session delta, which the prompt restores (``docs/design/autosave-recovery.md``). The backend modal and banners are drawn in every branch because they are portals that must survive the early returns. Several comments in the body carry hard-won discipline: the undo-stack wrapper object must never go into an effect's dependency list or it would spin an endless redraw loop, and the caches tied to a project are cleared when the project changes because their contents belong to the old project. The size is acknowledged debt (#201): the file is the coordinator that the shell and stages hang from, kept navigable by its section comments until it is split up.

.. CG-EXPLANATION-END id=function:App

