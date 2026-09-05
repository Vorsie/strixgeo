desktop.renderer.src.shell.AppShell
===================================

.. CG-PAGE source=desktop/src/renderer/src/shell/AppShell.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/AppShell.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/AppShell.tsx
   :language: tsx
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file that draws the whole screen once a project is open. StrixGeo's interface is built with React — a tool that assembles the on-screen interface out of small reusable pieces called *components*, each one a function that returns a description of what to draw. This component, ``AppShell``, is the outermost frame: it stacks a thin bar across the top (the ``StageToolbar``), a narrow rail of workflow buttons down the left (the ``StageSpine``), the large working area in the middle (the ``StageCanvas``), and a panel on the right (the ``Inspector``). The middle working area is wrapped in a ``StageErrorBoundary``, a safety net explained on its own page. The lines at the very top are comments — notes for programmers that the computer ignores — and they even draw the exact box-inside-box shape; the ``import`` lines below them borrow the smaller pieces this frame arranges.

**Why it is here.** The comments record two decisions. First, this file — not the one above it — is where the shared ``ShellContext`` is switched on; a *context* is a way to hand one bundle of shared values to every piece below it without passing it down by hand at each step, so any stage can read the current project and selection directly. Second, the note marked "§8 Risk 2" warns that the bundle handed in must be a *memo* — a value the app keeps and only rebuilds when its ingredients actually change — because if a brand-new bundle were built on every redraw, every stage reading it would needlessly redraw too. docs/desktop.md describes the result as a staged-screen shell: one fixed frame around many interchangeable work stages.

.. CG-EXPLANATION-END id=module-header

``interface AppShellProps``
---------------------------

.. CG-BLOCK id=interface:AppShellProps lines=39-70

.. literalinclude:: ../../../desktop/src/renderer/src/shell/AppShell.tsx
   :language: tsx
   :lines: 39-70
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AppShellProps

**What this does.** Describes the single input this frame is handed. In React, the inputs a component receives from whatever uses it are called its *props*. ``AppShell`` takes exactly one prop, ``context`` — the fully assembled bundle of shared app state. This block is an *interface*: in TypeScript, the typed dialect it is written in, an interface is simply a written note listing which fields a value must carry and of what kind; it is checked before the app runs and then disappears, adding nothing at run time.

**Why it is here.** The docstring repeats the Risk 2 rule in force here: the ``context`` bundle must be wrapped in a memo at the place that hands it in. It states plainly what breaks otherwise — an unwrapped, freshly-built bundle makes every consumer redraw on every redraw of the whole app. Writing the requirement into the input's own description puts the warning exactly where the next reader will meet it.

.. CG-EXPLANATION-END id=interface:AppShellProps

``function AppShell``
---------------------

.. CG-BLOCK id=function:AppShell lines=71-378

.. literalinclude:: ../../../desktop/src/renderer/src/shell/AppShell.tsx
   :language: tsx
   :lines: 71-378
   :lineno-match:

.. CG-EXPLANATION-START id=function:AppShell

**What this does.** The frame itself, plus the behaviour that ties the stages together. It opens by reading four values from ``useShellState`` — a *hook* (a helper whose name starts with ``use`` that lets a component remember things and react to changes): which stage is active, whether the inspector is open, and the two functions that change them. A remembered value like this is called *state*, and changing it makes the component redraw. Then come six *effects* — an effect is a piece of code React runs *after* drawing, to do something beyond drawing, each set to re-run only when a value it names actually changes. In order: (1) on opening any project, jump back to the Data stage; (2) a "deep link" from a cross-section that opens the Sections stage on the geological axis and pulses the chosen contact; (3) a deep link that opens a section and, after a short wait, pans to and pulses the target contacts or centres a named column; (4) a deep link that opens the Parameters stage already narrowed to a chosen unit; (5) whenever a CPT or borehole detail is selected, switch to the Data stage, which is the only place that detail is actually shown; and (6) the Escape key backs out of an open detail. Finally it returns the *JSX* — the HTML-like description of what to draw — laying out the toolbar, the left spine, the centre canvas inside its crash guard, and the right inspector, all wrapped in the shared-context provider.

**Why it is here.** Each effect carries the reason it is shaped the way it is. The reset-to-Data effect fires when the project id changes, because opening a *different* project should start on Data rather than wherever the previous one was left. The Sections deep link waits 600 milliseconds before pulsing, because the freshly-opened section must first fetch its CPT plots and borehole details — measured at about 440 milliseconds on the test project — or the pan-to-target arithmetic reads empty data and lands the target off-screen; and it clears its trigger *inside* the timer, never before, because clearing early would make React run the effect's cleanup and cancel the very timer just set (the exact regression that broke this twice). The Parameters deep link, by contrast, clears immediately, because nothing there is deferred. The Escape handler restores a behaviour the shell rework had dropped (debt #43): a gINT- or Plaxis-trained engineer reflexively presses Escape to leave a chart, so it clears the Data-stage detail — but it deliberately steps aside for any more specific owner of Escape (an open dialog, an active draw mode, a text field, the Sections editor's own layer-by-layer peel) and never closes the always-on inspector. The per-render log line is a ``trace`` line, not ``debug``, because the shell redraws dozens of times a second during a drag and would otherwise bury every other log line (owner report, 2 August 2026). Each ``eslint-disable`` note carries a written reason, as the project requires: it explains that the listed setter functions are stable and that the one named trigger value is the only thing that should re-run that effect.

.. CG-EXPLANATION-END id=function:AppShell

