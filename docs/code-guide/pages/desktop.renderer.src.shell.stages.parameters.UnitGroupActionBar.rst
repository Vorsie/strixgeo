desktop.renderer.src.shell.stages.parameters.UnitGroupActionBar
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitGroupActionBar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitGroupActionBar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitGroupActionBar.tsx
   :language: tsx
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file and states its job: the bulk action bar that appears at the top of the Parameters unit list when at least one geotech body is ticked.

**Why it is here.** It follows the standard selection pattern from ``docs/ux.md`` — "N selected · [Action] · Clear". The comment is explicit that this component is presentation only: it draws the bar and reports button clicks, but the ticked-selection state and the actual Group / Ungroup calls to the engine live in the ``useUnitGrouping`` hook, keeping the drawing and the logic apart.

.. CG-EXPLANATION-END id=module-header

``interface UnitGroupActionBarProps``
-------------------------------------

.. CG-BLOCK id=interface:UnitGroupActionBarProps lines=9-45

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitGroupActionBar.tsx
   :language: tsx
   :lines: 9-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitGroupActionBarProps

**What this does.** The ``interface`` (a note naming the shape of an object) listing the inputs — the props — a parent hands this bar: how many bodies are ticked, whether the selection may be grouped (and why not if it cannot), the packing-class names in the selection, whether any ticked body is already grouped, whether a request is in flight, and the three callback functions for Group, Ungroup and Clear.

**Why it is here.** Props are the bar's only inputs — it holds no state of its own — so every value it draws and every button it wires has to arrive this way. ``selectedClassNames`` is carried so a refusal can name the offending classes in words rather than a bare "same packing class"; ``guard`` is carried so the Group button can be disabled with an explanation; ``busy`` disables both actions while a round-trip runs.

.. CG-EXPLANATION-END id=interface:UnitGroupActionBarProps

``function UnitGroupActionBar``
-------------------------------

.. CG-BLOCK id=function:UnitGroupActionBar lines=46-111

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitGroupActionBar.tsx
   :language: tsx
   :lines: 46-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitGroupActionBar

**What this does.** The component that draws the bar: "N selected", a Group button, an Ungroup button that appears only when something in the selection is already grouped, and a Clear link pushed to the right. Before drawing, it builds the hover hint that explains a disabled Group button — naming the clashing classes when the block is a cross-class one, or "pick two" when fewer than two bodies are ticked.

**Why it is here.** A greyed-out button that says nothing reads as broken, so ``docs/ux.md`` requires a disabled affordance to explain itself — hence the hint, which names the offending packing classes in words when it knows them. Grouping is a reversible action, so there is no confirmation dialog; Ungroup only shows when it can do something. The engine's own cross-class refusal stays the final authority — this bar only guides the engineer before the call is made.

.. CG-EXPLANATION-END id=function:UnitGroupActionBar

