desktop.renderer.src.shell.toolbarOverflow_constants
====================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/toolbarOverflow_constants.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/toolbarOverflow_constants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow_constants.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and explains, in a long comment, what it holds: a small set of fixed size measurements — all in screen pixels — that the toolbar's overflow planner uses to guess how wide each toolbar button will be. These are deliberate estimates, worked out from the button's text and its trimmings, not widths read back off the real screen.

**Why it is here.** The comment records the whole reason the file exists. If the planner measured the buttons as they actually sit on the screen and then hid some to make room, hiding them would change those very widths — the measurement would feed back into its own input and the row would flicker back and forth between two layouts right at the tipping point. Instead the planner is a *pure function* — a calculation whose answer depends only on the numbers handed to it, never peeking at the live screen and never changing anything on the side — so for one window width it always gives the same, steady answer. The numbers here are chosen a touch too big on purpose: over-estimating makes the row tidy itself a few pixels early, which nobody notices, whereas under-estimating would cut a label off mid-word, which is exactly the fault this whole mechanism exists to prevent. As a last safety net a scrollbar can still appear above the row, so even a badly wrong guess degrades to a scrollbar, never to a chopped label.

.. CG-EXPLANATION-END id=module-header

``interface ToolbarMetrics``
----------------------------

.. CG-BLOCK id=interface:ToolbarMetrics lines=17-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow_constants.ts
   :language: typescript
   :lines: 17-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ToolbarMetrics

**What this does.** Lists, by name, every measurement the planner needs. This is an *interface* (also called a *type*): a note describing which named fields a bundle of values must carry — it is checked before the app runs and then vanishes, producing no working code of its own. The fields are: ``charAdvancePx`` (the average width of one letter of a label), ``iconPx`` (the little picture box on every button), ``caretIconPx`` (the small down-arrow on menus), ``buttonPaddingPx`` (the blank breathing space to the left and right inside a button), ``intraGapPx`` (the gap between a button's icon, its text and its arrow), ``splitCaretPx`` (the extra width of a split button's arrow half), ``rowGapPx`` (the gap between two neighbouring buttons), and ``overflowTriggerPx`` (how much room the “⋯ More” button claims once anything has been folded away into it).

**Why it is here.** Each field carries a short comment saying why its number was chosen — for instance the per-letter width is set slightly above the true average so labels full of capitals and digits still fit. Writing the exact set of measurements down as a named shape means the planner and the actual numbers below it can never disagree about which measurements exist.

.. CG-EXPLANATION-END id=interface:ToolbarMetrics

``const DEFAULT_TOOLBAR_METRICS``
---------------------------------

.. CG-BLOCK id=const:DEFAULT_TOOLBAR_METRICS lines=38-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow_constants.ts
   :language: typescript
   :lines: 38-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_TOOLBAR_METRICS

**What this does.** The actual numbers, filled into the shape above: about 6.4 pixels per letter, a 13-pixel icon, an 11-pixel arrow, 20 pixels of side padding, and so on. This is the standard set every toolbar uses unless a caller deliberately hands in its own.

**Why it is here.** Keeping the real values in one named place means every toolbar measures with the same ruler, and a future tweak to the look (bigger padding, a wider font) is a single edit here rather than a hunt through the code. The values lean generous for the over-estimate-is-safe reason spelled out in the file header.

.. CG-EXPLANATION-END id=const:DEFAULT_TOOLBAR_METRICS

``const TOOLBAR_SEPARATOR_PX``
------------------------------

.. CG-BLOCK id=const:TOOLBAR_SEPARATOR_PX lines=50-50

.. literalinclude:: ../../../desktop/src/renderer/src/shell/toolbarOverflow_constants.ts
   :language: typescript
   :lines: 50-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:TOOLBAR_SEPARATOR_PX

**What this does.** One number: the width of the thin vertical divider line that can sit before a button — 5 pixels, made of a 1-pixel rule plus a 2-pixel margin on each side.

**Why it is here.** The divider's width is counted as part of the button that owns it, so that when that button is folded away the planner also frees the divider's width from the budget — which matches what actually disappears on screen. Naming it once keeps the estimate and the rendered rule in step.

.. CG-EXPLANATION-END id=const:TOOLBAR_SEPARATOR_PX

