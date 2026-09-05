desktop.renderer.src.shell.ResponsiveToolbarRow
===============================================

.. CG-PAGE source=desktop/src/renderer/src/shell/ResponsiveToolbarRow.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/ResponsiveToolbarRow.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ResponsiveToolbarRow.tsx
   :language: tsx
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and brings in its tools. This file is a *component* — one reusable piece of on-screen interface, written with React (the library that builds the interface out of such pieces) as a function that returns what to draw. This particular component is the actual row of verb buttons at the top of every stage. It imports React's memory-and-effect helpers, the pure planner and its shapes from ``toolbarOverflow``, the fixed measurements, the shared menu pieces from ``ToolbarPrimitives``, and the translation helper so its own text follows the chosen language.

**Why it is here.** The comment states the design rule: every stage toolbar renders its verbs through this one component, so the responsive behaviour is written down exactly once. A stage simply declares its controls; this component measures the room it was given, asks the pure planner what fits, and draws that. The invariant the owner cares about is spelled out — nothing is ever cut off mid-word, and every verb stays reachable at every width, either in the bar or as a labelled row in “⋯ More”. The closing note explains the layout choice ``flex-1 min-w-0``: it makes the row's reported width equal the room the scrolling zone can actually give it, which is precisely the planner's budget, while the row's children keep their natural minimum size — so if the estimate were ever a little short the children spill and a scrollbar (debt #23) appears, meaning a wrong guess degrades to “scroll”, never to “clip”.

.. CG-EXPLANATION-END id=module-header

``type ToolbarRenderPresentation``
----------------------------------

.. CG-BLOCK id=type:ToolbarRenderPresentation lines=35-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ResponsiveToolbarRow.tsx
   :language: tsx
   :lines: 35-37
   :lineno-match:

.. CG-EXPLANATION-START id=type:ToolbarRenderPresentation

**What this does.** A narrower version of the four possible forms: the same list minus ``overflow``. In other words, the three forms a control might actually be asked to *draw itself* as — full label, short label, or icon only.

**Why it is here.** A control that folded into the ⋯ menu is not drawn in the bar at all — the menu draws it instead — so a control's own draw function should never be handed the ``overflow`` case. Removing it from the type makes that impossible to get wrong: the mistake is caught before the app runs, not discovered on screen.

.. CG-EXPLANATION-END id=type:ToolbarRenderPresentation

``interface ToolbarItemSpec``
-----------------------------

.. CG-BLOCK id=interface:ToolbarItemSpec lines=38-61

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ResponsiveToolbarRow.tsx
   :language: tsx
   :lines: 38-61
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ToolbarItemSpec

**What this does.** The full description of one control in a stage toolbar. It builds on the planner's sizing shape (id, priority, kind, label and the switches) and adds two things the planner does not need but the drawing does: a ``render`` function that, given the chosen form, returns the actual button to draw; and an ``overflowItems`` list — the rows this control contributes to the ⋯ menu when it folds. It also repeats the optional ``separatorBefore`` divider switch.

**Why it is here.** The comments make ``overflowItems`` do double duty as a safety valve. A control with sub-actions (a dropdown, a split button) lists them; a plain button lists just itself, under wording that reads on its own (“Delete cross-section”, not a bare “Delete”). Crucially, an *empty* list means the control cannot fold — so if a toolbar author forgets to supply the menu rows, the control stays in the bar and, at worst, spills into the scrollbar, rather than silently vanishing where the user can never reach it.

.. CG-EXPLANATION-END id=interface:ToolbarItemSpec

``interface ResponsiveToolbarRowProps``
---------------------------------------

.. CG-BLOCK id=interface:ResponsiveToolbarRowProps lines=62-96

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ResponsiveToolbarRow.tsx
   :language: tsx
   :lines: 62-96
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ResponsiveToolbarRowProps

**What this does.** The *props* — the inputs this component is handed by whatever uses it. There are four: ``items`` (the controls in left-to-right order), ``overflowMenuLabel`` (the spoken name for the ⋯ menu, which names the stage so two open menus can be told apart), ``measureWidth`` (how the row learns its own width), and ``metrics`` (the estimator's measurements).

**Why it is here.** The comments explain why the last two are inputs rather than fixed. Handing in the width source lets the tests, or any host that measures differently, drive the planner without a real on-screen layout pass; the default reads the element's own width, and the jsdom test environment reports 0, which the planner correctly reads as “not measured yet” and so draws everything at full label. The metrics are injected for the same testability reason.

.. CG-EXPLANATION-END id=interface:ResponsiveToolbarRowProps

``function ResponsiveToolbarRow``
---------------------------------

.. CG-BLOCK id=function:ResponsiveToolbarRow lines=97-218

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ResponsiveToolbarRow.tsx
   :language: tsx
   :lines: 97-218
   :lineno-match:

.. CG-EXPLANATION-START id=function:ResponsiveToolbarRow

**What this does.** The component itself. Near the top it sets up its remembered values in the fixed order React requires: the menu's spoken label (falling back to a translated generic if the caller gave none), a *ref* (a remembered box that does not trigger a redraw) for the row element and one for the ⋯ button, a piece of *state* (a remembered value whose change forces a redraw) holding the row's measured width, and the shared open/close machinery for the ⋯ menu. An *effect* — code that runs after drawing — measures the row once and then watches it with a size observer, re-measuring whenever the row changes size; where no observer exists (the test environment) the single first measurement stands. It builds a short text key summarising the current labels so the plan is recomputed when a label changes (a busy verb reading “Subdividing…” is wider than “1 · Subdivide CPTs”). A cached calculation (a *memo*, recomputed only when its inputs change) turns the specs into measured widths and runs the planner. Finally it splits the controls into those still visible and those folded into the menu, and returns the drawing: the visible controls, each drawn in its planned form with a divider where earned, followed — only when something folded — by a “⋯ More” button that opens the shared floating menu holding the folded verbs.

**Why it is here.** Several choices carry recorded reasons. The size observer is what keeps the layout correct as the window is dragged. The eslint-disable note explains that the plan is deliberately recomputed on the text key rather than on the raw ``items`` array: that array is rebuilt fresh on every parent redraw (it holds new one-off functions each time), so depending on it directly would re-run the planner on every keystroke — the text key is its true value-identity. The divider is drawn only between two visible controls, never leading and never doubled, because a leading rule reads as a stray tick and two touching rules would appear the instant the control between them folds. The ⋯ button carries a spoken name and a count so screen-reader and hover users know how many actions hide inside it, and it keeps ``shrink-0`` so it is never itself clipped — the very trap the planner exists to avoid.

.. CG-EXPLANATION-END id=function:ResponsiveToolbarRow

``function defaultMeasureWidth``
--------------------------------

.. CG-BLOCK id=function:defaultMeasureWidth lines=219-221

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ResponsiveToolbarRow.tsx
   :language: tsx
   :lines: 219-221
   :lineno-match:

.. CG-EXPLANATION-START id=function:defaultMeasureWidth

**What this does.** The default way the row learns its width when the caller supplies none: it simply reports the row element's own inner content width.

**Why it is here.** Named and kept separate so it can be swapped out through the ``measureWidth`` input — the real app uses this straightforward reading, while tests hand in their own so they can drive the planner to any width without a live browser layout.

.. CG-EXPLANATION-END id=function:defaultMeasureWidth

