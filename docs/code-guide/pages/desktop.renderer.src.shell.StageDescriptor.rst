desktop.renderer.src.shell.StageDescriptor
==========================================

.. CG-PAGE source=desktop/src/renderer/src/shell/StageDescriptor.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/StageDescriptor.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageDescriptor.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file writes down the *contract* every work stage must satisfy — the agreed shape of the description each stage hands to the shell. The opening comments explain that a stage description is a plain data object (not a component itself), that the shell reads it to fill its three zones, and that a stage's own centre area is free to switch between different views internally (the Data stage, for instance, flips between a map and a chart). The two ``import`` lines borrow only *type* information: a place to say "this field holds a React component" and "this field holds a Lucide icon" (Lucide is the icon set the app draws its glyphs from). The block closes with the written description of ``StageId``, the list of stage names that follows in the next block.

**Why it is here.** The comments make the design boundary explicit: the shell does not reach inside a stage, and a stage does not dictate a single frozen view. Keeping the contract in one tiny file, with no live code, means adding a new stage is a matter of writing one more description that fits this shape — the shell needs no changes. The note about the centre area ("Risk 3") is there so a future reader does not mistake the contract for a rule that each stage may show only one thing.

.. CG-EXPLANATION-END id=module-header

``type StageId``
----------------

.. CG-BLOCK id=type:StageId lines=31-45

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageDescriptor.ts
   :language: typescript
   :lines: 31-45
   :lineno-match:

.. CG-EXPLANATION-START id=type:StageId

**What this does.** Names the seven work stages the app moves through, as a fixed list: ``data``, ``sections``, ``geology``, ``lithology``, ``geotechnical``, ``parameters`` and ``export``. Written as a *type*, this is a note to the rest of the code that a "stage id" value is only ever allowed to be one of these seven words and nothing else. The written description below the list introduces ``StageSummary``, the small shape shown next.

**Why it is here.** The docstring records that the order is not arbitrary — it mirrors the real engineering sequence an engineer walks: raw data first, then sections, the geological and lithological models, the geotechnical subdivision, derived parameters, and finally export. It also notes that ``parameters`` is the sixth slot added by owner directive of 21 May 2026. Fixing the seven names as a closed list means a misspelt stage id (``"litho"`` instead of ``lithology``) is caught by the build before the app is ever run.

.. CG-EXPLANATION-END id=type:StageId

``interface StageSummary``
--------------------------

.. CG-BLOCK id=interface:StageSummary lines=46-84

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageDescriptor.ts
   :language: typescript
   :lines: 46-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StageSummary

**What this does.** Describes the small live summary a stage reports for its spine button and inspector header: a short ``label``, an optional ``badge`` (the little dot-with-text that overlays the button's icon — ``null`` means no badge), and an optional ``badgeIntent`` that sets the badge's colour (neutral, amber or red). The lines after it are the written description of ``StageDescriptor``, the full stage contract shown in the next block.

**Why it is here.** Every stage can surface a small "something needs attention here" signal on its own button without the shell knowing what that signal means — the stage computes it, the shell just paints the dot. Amber and red are the app's standard "attention" and "problem" colours, so the badge reads the same way it does everywhere else in the interface.

.. CG-EXPLANATION-END id=interface:StageSummary

``interface StageDescriptor``
-----------------------------

.. CG-BLOCK id=interface:StageDescriptor lines=85-97

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageDescriptor.ts
   :language: typescript
   :lines: 85-97
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StageDescriptor

**What this does.** The full shape of a stage description. Each stage supplies: its ``id`` (one of the seven names); an ``icon`` to draw on the spine button; a short ``spineLabel`` under that icon; ``useStageSummary``, a hook the shell calls to get the live badge summary; and three components — ``CanvasComponent`` for the centre area, ``ToolbarComponent`` for the stage's slice of the top bar, and ``InspectorComponent`` for the right-hand panel.

**Why it is here.** The docstring states the payoff plainly: the shell reads one of these and populates all four of a stage's zones from it, and — crucially — it passes no avalanche of inputs into those three components; they each read the shared bus through ``useShell()`` instead. The comment on ``icon`` records why its type is the library's own ``LucideIcon`` and not a narrower hand-written one: every stage assigns a real Lucide icon, and the narrower type wrongly rejected those actual values.

.. CG-EXPLANATION-END id=interface:StageDescriptor

