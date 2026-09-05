desktop.renderer.src.shell.StageSpine
=====================================

.. CG-PAGE source=desktop/src/renderer/src/shell/StageSpine.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/StageSpine.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageSpine.tsx
   :language: tsx
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file draws the left rail of workflow buttons — the *spine* — with one button per stage. The comments describe the button (icon plus a short label, with a small dot badge in the corner when a stage has something to flag), note that the switch animations run only when the viewer has not asked the system to reduce motion, and that every colour comes from the app's named theme tokens rather than raw colour values. The ``import`` lines bring in the stage contract and registry, the shared bus (``useShell``), the logger, and ``useT`` — the translation hook (explained just below).

**Why it is here.** The comments record two standing rules the file obeys. Animations are wrapped so a viewer who has set "reduce motion" in their system sees an instant switch, honouring the accessibility motion budget. And colours are taken only from semantic theme tokens (``bg-spine-active``, ``text-text-muted`` and the like) so the rail recolours correctly in both light and dark mode without any value being hand-picked here.

.. CG-EXPLANATION-END id=module-header

``const SPINE_LABEL_KEYS``
--------------------------

.. CG-BLOCK id=const:SPINE_LABEL_KEYS lines=22-34

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageSpine.tsx
   :language: tsx
   :lines: 22-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:SPINE_LABEL_KEYS

**What this does.** A small table that turns each stage name into a *catalogue key* such as ``spine.data`` or ``spine.geology``. The interface text of the app is not written into the components; instead it lives in per-language catalogues (one for English, one for Dutch), and a component asks for a piece of text by its key and receives the string for the language currently in use. This table just supplies the key for each stage's button label.

**Why it is here.** This is the app's translate-at-the-presentation-boundary rule applied to interface chrome: the component never hard-codes the word "Data" or "Geologie", it asks the catalogue for ``spine.data`` and gets whichever language is active. A companion test checks the English and Dutch catalogues carry the same set of keys, so a button can never end up with text in one language but blank in the other.

.. CG-EXPLANATION-END id=const:SPINE_LABEL_KEYS

``interface SpineButtonProps``
------------------------------

.. CG-BLOCK id=interface:SpineButtonProps lines=35-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageSpine.tsx
   :language: tsx
   :lines: 35-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SpineButtonProps

**What this does.** Describes the three inputs one spine button needs: the ``descriptor`` for its stage, whether it is the ``active`` one, and an ``onSelect`` function to call when it is clicked.

**Why it is here.** The comment states the real reason a single button is its own component rather than drawn inline in a loop: each button calls the stage's own summary hook, and the rules of hooks require that hooks be called in the same number and order on every redraw. Isolating one hook call per button means the total number of hook calls stays constant no matter how the stage list changes — the loop draws N identical buttons instead of making N hook calls directly in one component.

.. CG-EXPLANATION-END id=interface:SpineButtonProps

``function SpineButton``
------------------------

.. CG-BLOCK id=function:SpineButton lines=58-119

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageSpine.tsx
   :language: tsx
   :lines: 58-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:SpineButton

**What this does.** Draws one button on the rail. It calls the stage's ``useStageSummary`` hook to get the live badge, reads the stage's icon, and looks up the translated label. It then returns a clickable button carrying a stable test id (``stage-tab-<stage>``), the accessible name and tooltip, and a "pressed" marker when active; the icon sits in the middle, a small dot badge overlays its top-right corner when the summary has one to show (coloured red, amber, or neutral), and the short label sits underneath. Clicking it switches to that stage — but only when it is not already the active one.

**Why it is here.** The comment on the test id records that these ids are stable anchors used both by the guided tutorial ("open the … tab") and by the automated tests, so they must not drift. The badge's colours are taken from the same status tokens the rest of the app uses, so a red or amber dot here means the same thing it means anywhere else. The click guard (act only when not already active) avoids logging and re-firing a switch to the stage the user is already on.

.. CG-EXPLANATION-END id=function:SpineButton

``interface StageSpineProps``
-----------------------------

.. CG-BLOCK id=interface:StageSpineProps lines=120-145

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageSpine.tsx
   :language: tsx
   :lines: 120-145
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StageSpineProps

**What this does.** Describes the two inputs the whole rail needs: ``activeStageId`` (which stage is currently showing) and ``onSelectStage`` (the function to call to switch stages).

**Why it is here.** Keeping the rail's inputs this small is deliberate — it needs only to know which button to mark active and whom to tell when one is clicked. Everything else each button needs it reads for itself from the registry and the shared bus.

.. CG-EXPLANATION-END id=interface:StageSpineProps

``function StageSpine``
-----------------------

.. CG-BLOCK id=function:StageSpine lines=146-195

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageSpine.tsx
   :language: tsx
   :lines: 146-195
   :lineno-match:

.. CG-EXPLANATION-START id=function:StageSpine

**What this does.** Draws the rail itself: a fixed-width (64-pixel) vertical navigation column with a border on its right. It walks the ``STAGE_ORDER`` list, looks each stage up in the registry, and draws a ``SpineButton`` for it, marking the one that matches ``activeStageId`` as active. Below the buttons it places the ``SelectionFooter``.

**Why it is here.** The comment on the registry lookup explains the guard that skips a missing stage: the registry is sealed when the app is built, so every name in the order list does map to a description — the check guards against a future partial edit, not a real run-time gap. The footer is included (debt #44) so the cross-stage selection the engineer made with a marquee in the Data stage stays visible from every other stage, giving feedback that the selection travelled with them.

.. CG-EXPLANATION-END id=function:StageSpine

``function SelectionFooter``
----------------------------

.. CG-BLOCK id=function:SelectionFooter lines=196-226

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageSpine.tsx
   :language: tsx
   :lines: 196-226
   :lineno-match:

.. CG-EXPLANATION-START id=function:SelectionFooter

**What this does.** The small block at the bottom of the rail. It reads the shared set of marquee-selected investigations; when that set is empty it draws nothing but an empty spacer, and when it is not, it draws a clickable amber badge reading the count ("N selected") that clears the whole selection when pressed.

**Why it is here.** The docstring records the choices: it is hidden when empty so the rail stays uncluttered in the common case, and it is amber-tinted to match every other "active / unsaved" marker in the app. Clearing the selection is a reversible action, so — per the app's reversible-versus-irreversible rule — it fires straight away with no confirmation dialog. The comment on the abbreviated label notes that the visible "sel." is shortened for space while the accessible name announces the full word "selected", so a screen reader still says it in full.

.. CG-EXPLANATION-END id=function:SelectionFooter

