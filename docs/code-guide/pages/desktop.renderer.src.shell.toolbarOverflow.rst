desktop.renderer.src.shell.toolbarOverflow
==========================================

.. CG-PAGE source=desktop/src/renderer/src/shell/toolbarOverflow.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/toolbarOverflow.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and brings in the fixed measurements from the constants file next door. This file is the brain of the responsive toolbar: given how wide each button would be and how much room the row has, it decides which buttons keep their full label, which shrink to just an icon, and which fold away into a “⋯ More” menu. It does this entirely by calculation — it never touches the screen.

**Why it is here.** The long comment records the exact bug this replaces (owner dogfeed 2026-08-26). The stage/axis pill in the Sections toolbar was marked ``overflow-hidden``, and by a rule of the CSS layout engine (Flexbox §4.5) a flex item with hidden overflow is allowed to shrink all the way to zero width. So when the row ran out of room, the layout engine dumped the entire shortfall onto that one pill, and the pill's own hidden overflow then sliced its last word in half — the notorious “Geology | Litho | Geote”. The fallback scrollbar never showed either, because the pill had already swallowed the overflow before the row could grow past its container; the two safety mechanisms silently cancelled each other out. The fix is the model described here: each button declares how important it is and which smaller forms it will accept, and a *pure function* — a calculation whose answer depends only on the widths and the available room, reading nothing back off the screen and changing nothing on the side — decides the layout. Because it plans from the full-label widths every time, the result is a steady function of the window width and never flickers, and nothing is ever clipped or made unreachable.

.. CG-EXPLANATION-END id=module-header

``type ToolbarPriority``
------------------------

.. CG-BLOCK id=type:ToolbarPriority lines=45-54

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 45-54
   :lineno-match:

.. CG-EXPLANATION-START id=type:ToolbarPriority

**What this does.** Lists the four importance levels a button can be given — ``pinned``, ``high``, ``medium`` and ``low`` — as a fixed set of allowed words. This is a *type*: a note fixing which values are legal, checked before the app runs and then gone. The docstring explains each: ``pinned`` is the control that says which model the panel below is showing — it is never folded and never reduced to a bare icon, its only concession being a purpose-built short form; ``high`` are the verbs pressed on nearly every pass; ``medium`` are used several times per section; ``low`` are the occasional escape hatches and housekeeping verbs.

**Why it is here.** The whole responsive behaviour hangs off these labels: when room runs short the row gives up the least-important buttons first, so declaring importance up front is what lets a busy verb keep its label while a once-a-week verb quietly steps aside.

.. CG-EXPLANATION-END id=type:ToolbarPriority

``type ToolbarPresentation``
----------------------------

.. CG-BLOCK id=type:ToolbarPresentation lines=55-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 55-57
   :lineno-match:

.. CG-EXPLANATION-START id=type:ToolbarPresentation

**What this does.** Lists the four forms a button can take on screen: ``full`` (icon plus its whole label), ``compact`` (icon plus a purpose-built short label), ``icon`` (icon only — the label moves into the hover tooltip and the name a screen reader announces), and ``overflow`` (not in the bar at all — it appears instead as a labelled row inside the “⋯ More” menu).

**Why it is here.** These are the rungs of the ladder the planner walks down as space tightens. Naming them once gives every later piece of the file — the width calculator, the concession list, the renderer — one shared vocabulary for “how is this button being shown right now”.

.. CG-EXPLANATION-END id=type:ToolbarPresentation

``type ToolbarItemKind``
------------------------

.. CG-BLOCK id=type:ToolbarItemKind lines=58-60

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 58-60
   :lineno-match:

.. CG-EXPLANATION-START id=type:ToolbarItemKind

**What this does.** Lists the four kinds of control the toolbar can hold — a plain ``button``, a ``dropdown`` (a button that opens a menu), a ``split`` button (a main action welded to a little menu arrow), or a ``custom`` control the estimator cannot model on its own.

**Why it is here.** The kind drives the width estimate: a dropdown needs room for its trailing arrow, a split button for its extra arrow half, and so on. So the calculator has to know which kind each control is to guess its width correctly.

.. CG-EXPLANATION-END id=type:ToolbarItemKind

``interface ToolbarItemSizing``
-------------------------------

.. CG-BLOCK id=interface:ToolbarItemSizing lines=61-92

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 61-92
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ToolbarItemSizing

**What this does.** The shape of what a toolbar hands in for one control before any widths are worked out. It carries a stable ``id`` (the name the planner tracks the control by), its ``priority`` and ``kind`` from above, its ``label`` (also the wording used for its row in the ⋯ menu), an optional ``compactLabel`` short form, an optional explicit ``widthPx`` for a custom control the estimator can't measure, and three yes/no switches: ``iconOnly`` (may this control ever drop to just an icon?), ``foldable`` (may it fold into the ⋯ menu?) and ``separatorBefore`` (does it own a vertical divider line to its left?).

**Why it is here.** The comments pin the careful defaults. ``iconOnly`` defaults to yes but is set to no for destructive verbs — docs/ux.md rules that a lone trash-can icon is not an acceptable face for an irreversible action — and for any control whose label carries a value the user must be able to read without hovering, such as ``qc: median``. The divider's width is charged to the control that owns it so that folding the control also removes its divider from the budget, which is exactly what the eye sees happen on screen.

.. CG-EXPLANATION-END id=interface:ToolbarItemSizing

``interface ToolbarItemMeasure``
--------------------------------

.. CG-BLOCK id=interface:ToolbarItemMeasure lines=93-104

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 93-104
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ToolbarItemMeasure

**What this does.** The shape of one control after the calculator has turned its declaration into actual widths: its ``id`` and ``priority`` carried through, its ``fullPx`` (width with the whole label), and optionally ``compactPx`` and ``iconPx`` — present only when the control actually has a short form or is allowed to shrink to an icon — plus a plain ``foldable`` yes/no.

**Why it is here.** This is the tidy, widths-in-hand form the planner works from. Splitting “what the caller declared” from “the measured widths” lets the planner be handed numbers from the built-in estimator or from real measurements taken some other way, without caring which.

.. CG-EXPLANATION-END id=interface:ToolbarItemMeasure

``interface ToolbarPlan``
-------------------------

.. CG-BLOCK id=interface:ToolbarPlan lines=105-118

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 105-118
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ToolbarPlan

**What this does.** The shape of the planner's answer for one row: a ``presentation`` lookup giving the chosen form for every control's id (each input id appears exactly once), an ``overflowIds`` list naming the controls folded into the ⋯ menu in their original left-to-right order, and ``widthPx``, the total width the planned row will occupy including the gaps between controls and the ⋯ trigger.

**Why it is here.** This is the single object the row component reads to draw itself, so it bundles everything the drawing step needs: how to show each control, which controls moved into the menu, and how wide the result is.

.. CG-EXPLANATION-END id=interface:ToolbarPlan

``function chromePx``
---------------------

.. CG-BLOCK id=function:chromePx lines=119-159

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 119-159
   :lineno-match:

.. CG-EXPLANATION-START id=function:chromePx

**What this does.** A helper that returns the width of a control's *trimmings* — its side padding, its icon and the gaps around them — for a given kind of control, before any label text is added. A plain button pays for padding, an icon and one gap; a dropdown adds a trailing arrow and its gap; a split button adds its second arrow half; a custom control pays nothing here because its width is supplied whole. The comment block that follows in this same view is the plain-English contract for the estimator function shown in the next section.

**Why it is here.** Pulling the fixed, text-free part of each control's width into one small named calculation keeps the main estimator readable and makes sure a dropdown's arrow or a split button's caret is never accidentally left out of the budget.

.. CG-EXPLANATION-END id=function:chromePx

``function measureToolbarItems``
--------------------------------

.. CG-BLOCK id=function:measureToolbarItems lines=160-212

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 160-212
   :lineno-match:

.. CG-EXPLANATION-START id=function:measureToolbarItems

**What this does.** The estimator: it takes the list of declared controls and turns each into a measured control. For every one it adds up the trimmings width (from ``chromePx``) plus the label length times the per-letter width, adds a divider's width when the control owns one, and works out the short-label and icon-only widths where those forms are allowed. A pinned control is never given an icon-only or foldable form. If a custom control was declared without an explicit width, it stops with a clear error rather than guessing.

**Why it is here.** The docstring stresses that the estimate is deliberately generous — an over-estimate is safe (the row tidies a little early, unseen) while an under-estimate is the clipping bug this whole file exists to kill. Refusing a custom control with no width is the same principle made strict: a silently-assumed width of zero would let that control clip, so the code fails loudly instead. The metrics are handed in rather than hard-wired so tests, or any caller measuring differently, can drive the planner with their own numbers.

.. CG-EXPLANATION-END id=function:measureToolbarItems

``const PRIORITY_RANK``
-----------------------

.. CG-BLOCK id=const:PRIORITY_RANK lines=213-219

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 213-219
   :lineno-match:

.. CG-EXPLANATION-START id=const:PRIORITY_RANK

**What this does.** A tiny lookup that turns the four importance words into numbers — ``low`` 0, ``medium`` 1, ``high`` 2, ``pinned`` 3 — so the code can sort by importance. Lower number means “give this up first”.

**Why it is here.** The comment records the reasoning behind the ranking, in the engineer's own working terms: the verbs the hands live on — Suggest, Correlate, the packing pipeline, New cross-section — are pressed dozens of times per section, so they cling to their labels longest; Bodies, Display, Export and Suggest tie-sections are pressed only a few times; Undo already has a keyboard shortcut, so its button is a reminder rather than the main route; and Admixtures and Recompute bodies are reached once in a while, so they are the first to step aside.

.. CG-EXPLANATION-END id=const:PRIORITY_RANK

``interface Move``
------------------

.. CG-BLOCK id=interface:Move lines=220-248

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 220-248
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Move

**What this does.** A tiny shape describing one *concession* the planner can make: the ``index`` of the control to change and the presentation ``to`` change it to. The doc comment that follows in this view belongs to the ``degradationOrder`` function shown next, and lays out the order those concessions are made in.

**Why it is here.** Naming a single step as a small labelled pair lets the planner build a whole ordered list of “if we still need room, do this next” moves and then walk that list, which is far clearer than deciding what to shrink on the fly.

.. CG-EXPLANATION-END id=interface:Move

``function degradationOrder``
-----------------------------

.. CG-BLOCK id=function:degradationOrder lines=249-272

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 249-272
   :lineno-match:

.. CG-EXPLANATION-START id=function:degradationOrder

**What this does.** Builds the ordered list of concessions, cheapest first. First it lets the pinned control take its short form. Then it works through the importance bands from lowest to highest, and inside each band it first turns every control that may to an icon, then folds every foldable control into the ⋯ menu — finishing one whole band before touching the next. Inside a band it always degrades the last-declared control first, so a toolbar erodes from its far end.

**Why it is here.** The docstring spells out why this order, not the obvious one. Shortening the pinned mode control first costs the user nothing — all three modes stay fully spelled out — so it happens before any verb loses its label. Spending one whole band before touching the next is deliberate: the naive “turn everything to icons, then fold everything” route reaches a state where a verb pressed dozens of times a section is a bare icon while a once-a-week verb still shows its full label; the band order instead buries the rare verb in the menu and keeps the constant one spelled out, which is what the owner asked for, and it also spreads the ⋯ trigger's own width across a whole band rather than paying it to hide one small button. Eroding from the far end matches the GitHub Primer action-bar behaviour, so the verbs a user reaches by muscle memory do not shift around.

.. CG-EXPLANATION-END id=function:degradationOrder

``function presentedPx``
------------------------

.. CG-BLOCK id=function:presentedPx lines=273-286

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 273-286
   :lineno-match:

.. CG-EXPLANATION-START id=function:presentedPx

**What this does.** A one-line helper: given a measured control and the form it has been assigned, it returns the width that form occupies — zero for a folded (overflow) control, its short-label width for compact, its icon width for icon-only, and its full width for full. Where a form's width is missing it safely falls back to the full width.

**Why it is here.** The row-width tally needs the width of each control in whatever form the plan gave it; isolating that single lookup keeps the tally itself short and stops the fallback rule from being retyped in several places.

.. CG-EXPLANATION-END id=function:presentedPx

``function rowPx``
------------------

.. CG-BLOCK id=function:rowPx lines=287-333

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 287-333
   :lineno-match:

.. CG-EXPLANATION-START id=function:rowPx

**What this does.** Adds up the total width of the row for a given set of chosen forms: it sums each shown control's width, counts how many are folded away, and — if anything is folded — adds the width of the ⋯ trigger and counts it as one more shown control. Finally it adds the gaps between neighbouring controls. The doc comment that follows in this view is the plain-English contract for the main planner shown in the next section.

**Why it is here.** This is the yardstick the planner checks against the available room after each concession: it has to include the between-button gaps and the ⋯ trigger, because a plan that forgot those would think it had fit when it had not — and clipping is the one outcome this file must never allow.

.. CG-EXPLANATION-END id=function:rowPx

``function planToolbarLayout``
------------------------------

.. CG-BLOCK id=function:planToolbarLayout lines=334-365

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow.ts
   :language: typescript
   :lines: 334-365
   :lineno-match:

.. CG-EXPLANATION-START id=function:planToolbarLayout

**What this does.** The main entry point that decides how a row renders in the space it has. It starts with every control at its full label, then walks the concession list from ``degradationOrder`` making one change at a time, re-measuring after each, and stops the moment the row fits. It never walks a control back up the ladder — a control already folded is skipped, and a control already an icon is not asked to become an icon again. It returns the finished plan: the form for each id, the folded ids in order, and the row's width.

**Why it is here.** The docstring pins one subtle rule: an available width of zero or less means “not measured yet” — the very first draw, before the browser has reported the row's real size — and in that case every control is drawn at its full label. Collapsing on an unmeasured row would make the first flash of every toolbar a ⋯ menu, which the code refuses to do. Skipping already-degraded controls holds the guarantee that the concessions only ever move in the cheap-first direction, so a later step can never quietly undo an earlier one.

.. CG-EXPLANATION-END id=function:planToolbarLayout

