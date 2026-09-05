desktop.renderer.src.shell.stages.sections.useLithoSuggestVerbs
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useLithoSuggestVerbs.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useLithoSuggestVerbs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoSuggestVerbs.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the litho Suggest / Accept verbs' state and derivations — the focused-anchor lookup, the ghost-suggestion counts, the bulk-anchor list, the three busy flags, and the five handlers behind the Suggest split-button.

**Why it is here.** Extracted verbatim from ``SectionsToolbar`` (debt #201). The split-button's primary-mode label stays in the toolbar because it also reads ``canSuggest`` and the bulk anchors out of this hook.

.. CG-EXPLANATION-END id=module-header

``interface UseLithoSuggestVerbsDeps``
--------------------------------------

.. CG-BLOCK id=interface:UseLithoSuggestVerbsDeps lines=27-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoSuggestVerbs.ts
   :language: typescript
   :lines: 27-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoSuggestVerbsDeps

**What this does.** The shell state and handlers the verbs read: axis and section flags, the active litho model, the section's focused column, the selection ids, the unified ghost map and focused-anchor flag, the busy flag and litho contacts, the four suggest/accept handlers, and the section and investigation lists.

**Why it is here.** One interface for the whole Suggest concern; the verbs derive the counts and anchors from it.

.. CG-EXPLANATION-END id=interface:UseLithoSuggestVerbsDeps

``interface UseLithoSuggestVerbsResult``
----------------------------------------

.. CG-BLOCK id=interface:UseLithoSuggestVerbsResult lines=50-81

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoSuggestVerbs.ts
   :language: typescript
   :lines: 50-81
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoSuggestVerbsResult

**What this does.** What it returns: whether suggest is possible, whether focused suggestions exist, the bulk and per-kind ghost counts, the three busy flags, the bulk-confirm state, the bulk and new-test anchor lists, and the five async handlers.

**Why it is here.** The toolbar renders the Suggest split-button and its transient pills from these.

.. CG-EXPLANATION-END id=interface:UseLithoSuggestVerbsResult

``function useLithoSuggestVerbs``
---------------------------------

.. CG-BLOCK id=function:useLithoSuggestVerbs lines=82-272

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoSuggestVerbs.ts
   :language: typescript
   :lines: 82-272
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithoSuggestVerbs

**What this does.** Derives the focused anchor (the section's right-click-focused column on the litho axis), whether it has suggestions, the bulk anchor count, and per-kind ghost counts; builds the bulk-anchor list from investigations that actually land on the section (minus its exclusions and any with no elevation); filters that to new tests with no contacts yet; and provides handlers to suggest for the focused column, accept all focused, confirm the bulk suggest, suggest for new tests, and accept all bulk.

**Why it is here.** On the litho axis the source is the section-local focused column (right-click then Focus), not the global map/data selection. The bulk anchors route through the same on-section projection the overlays use, after an earlier bug reported the project's full test count ('will run for 68 investigations') instead of the section's. Accept threads the section id and the section-update callback so the just-accepted contacts pass the explicit-content filter immediately — the recurring #57 bug.

.. CG-EXPLANATION-END id=function:useLithoSuggestVerbs

