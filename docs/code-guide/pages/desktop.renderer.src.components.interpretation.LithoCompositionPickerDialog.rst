desktop.renderer.src.components.interpretation.LithoCompositionPickerDialog
===========================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's documentation comment and its imports. The comment describes a two-tab dialog opened when the user picks a depth on the lithostratigraphic section axis: tab one lists existing litho units grouped by their parent geological formation, and tab two is a composition builder — a main-soil choice, a growable list of admixture rows, and a live name preview — that creates a new unit on confirm. It explains that existing units carry a server-resolved parent name used directly for the group headings, while the parent-name input prop is the geology context at the click point (resolved only at commit, so null for new placements). It imports React hooks, two icons, the admixture and formation types, a logger, the lithology colour table, the label helpers, the shared Button and Modal, and the translation helper.

**Why it is here.** This is the composition side of the click-to-place workflow, built on the shared Modal and Button (see the ``desktop.renderer.src.components.ui.Modal`` page). The comment records a key correctness rule from review B1: confirming a new unit must not also run the existing-unit select, because that would re-post the same contact and raise a duplicate error on every successful placement. The import comment states the label strategy plainly — English labels at the presentation boundary with the raw DOV code in parentheses so an engineer can cross-check against the source — the translate-at-the-boundary rule, with the label table kept in one shared file.

.. CG-EXPLANATION-END id=module-header

``const MAIN_SOIL_CODES``
-------------------------

.. CG-BLOCK id=const:MAIN_SOIL_CODES lines=52-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 52-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAIN_SOIL_CODES

**What this does.** The fixed list of main soil codes offered: gravel, sand, silt, clay and peat (in their Dutch codes).

**Why it is here.** These are the five main lithology classes a new unit can be built from; listing them once fixes the choices offered in the builder.

.. CG-EXPLANATION-END id=const:MAIN_SOIL_CODES

``type MainSoilCode``
---------------------

.. CG-BLOCK id=type:MainSoilCode lines=53-57

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 53-57
   :lineno-match:

.. CG-EXPLANATION-START id=type:MainSoilCode

**What this does.** A type standing for exactly one of the five main soil codes, followed by the comment introducing the admixture option tables.

**Why it is here.** Deriving the type from the code list means the two can never drift apart — the allowed main-soil value is always exactly one of the five listed, checked before the app runs.

.. CG-EXPLANATION-END id=type:MainSoilCode

``const ADMIXTURE_SOIL_OPTIONS``
--------------------------------

.. CG-BLOCK id=const:ADMIXTURE_SOIL_OPTIONS lines=58-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 58-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_SOIL_OPTIONS

**What this does.** The admixture soil-code dropdown options: each a raw DOV code paired with an English label that repeats the code in parentheses.

**Why it is here.** The code is shown in the label because the code itself is the stored value for the admixture, so keeping it visible orients the user — the show-the-raw-token side of the translate-at-the-boundary rule.

.. CG-EXPLANATION-END id=const:ADMIXTURE_SOIL_OPTIONS

``const ADMIXTURE_AMOUNT_OPTIONS``
----------------------------------

.. CG-BLOCK id=const:ADMIXTURE_AMOUNT_OPTIONS lines=67-88

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 67-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_AMOUNT_OPTIONS

**What this does.** The admixture amount dropdown options: an unspecified blank plus the DOV amount grades from weakly to strongly, each an English label with the raw code in parentheses.

**Why it is here.** The same label-with-raw-code approach as the soil options, so the engineer sees both the readable grade and the source code that will be stored.

.. CG-EXPLANATION-END id=const:ADMIXTURE_AMOUNT_OPTIONS

``function groupByParent``
--------------------------

.. CG-BLOCK id=function:groupByParent lines=89-137

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 89-137
   :lineno-match:

.. CG-EXPLANATION-START id=function:groupByParent

**What this does.** Groups the litho formations by their parent geological formation. It buckets each litho unit under its parent id, picks a group heading from the server-resolved parent name (falling back to a lookup in the geological formations, then to the id), sorts the named groups by the parent's display order, and appends an "Unassigned" group for units with no parent.

**Why it is here.** Grouping by parent lets tab one read like the geological column, and ordering the groups by the parent's display order keeps that column order. Preferring the server-resolved parent name avoids a client-side join, and the fallbacks keep the grouping working even for a unit whose parent name has not been resolved yet — the comment marks this as orphan-safe.

.. CG-EXPLANATION-END id=function:groupByParent

``interface LithoCompositionPickerProps``
-----------------------------------------

.. CG-BLOCK id=interface:LithoCompositionPickerProps lines=138-192

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 138-192
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoCompositionPickerProps

**What this does.** Lists the dialog's inputs: whether it is open; the litho formations for tab one; the geological formations for the headings; the anchor context for the subtitle; the parent formation name (shown as context, null when resolved only at commit); an optional parent formation id to filter tab one to units within the clicked geological formation; the existing-unit select handler; the new-unit create handler; and cancel.

**Why it is here.** The comments record two dogfeed-driven decisions: a null parent name shows a neutral "resolved automatically" note rather than an alarming warning (review S1), because the geology lookup runs at commit not on click; and the parent-id filter narrows the existing-units list to those inside the geological formation at the click, an owner directive from a 2026-05-27 dogfeed ("only suggest litho's in the geological unit in which we're clicking"), falling back to the full list when no geological backdrop is present.

.. CG-EXPLANATION-END id=interface:LithoCompositionPickerProps

``interface AdmixtureRow``
--------------------------

.. CG-BLOCK id=interface:AdmixtureRow lines=193-209

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 193-209
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AdmixtureRow

**What this does.** Describes one editable admixture row in the builder: a stable numeric id, a soil code, an amount, and a locally flag.

**Why it is here.** The id is a stable key so React can track each row across edits and removals without confusing them; the other three fields are the composition the user is editing.

.. CG-EXPLANATION-END id=interface:AdmixtureRow

``function LithoCompositionPickerDialog``
-----------------------------------------

.. CG-BLOCK id=function:LithoCompositionPickerDialog lines=210-596

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/LithoCompositionPickerDialog.tsx
   :language: tsx
   :lines: 210-596
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoCompositionPickerDialog

**What this does.** The dialog component. It filters the litho units to the clicked geological formation (via a *memo*), keeps the active tab, the currently-committing existing-unit id, and the new-unit builder state — the main soil code, the admixture rows, and a creating flag — with a per-instance counter for row keys. It computes a live name preview from the current composition. Picking an existing unit marks it busy and awaits the select; the builder can add, remove and edit admixture rows; confirming builds the admixture list, logs the attempt, calls the create handler, and on success resets and closes without re-selecting, or on a null result logs why and stays open. It draws the Modal with the title, anchor and parent context, the tab bar, the grouped existing-units list or the builder, and the footer buttons.

**Why it is here.** The busy flags disable the whole dialog while a placement or a create is in flight, so a contact cannot be committed twice — the same lock the shared Modal enforces. On a successful create it deliberately does not chain into the existing-unit select, because that re-posts the same contact and triggers a false duplicate error (review B1). The diagnostic logs were added after a 2026-05-23 dogfeed where "create new layer does nothing" gave no signal: the create path now traces each leg and, on a null result, logs the most likely cause (no active litho model or no selected section) so a silent failure is diagnosable from the console. The row-key counter is per-instance rather than module-level (review C1) so two open dialogs cannot clash keys. The colour swatches and names come through the lithology colour table and the display-name helper — translation at the presentation boundary.

.. CG-EXPLANATION-END id=function:LithoCompositionPickerDialog

