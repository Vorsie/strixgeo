desktop.renderer.src.components.interpretation.FormationDialog
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/interpretation/FormationDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/interpretation/FormationDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationDialog.tsx
   :language: tsx
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's documentation comment and its imports. The comment says this dialog creates or edits a geological formation, using the same shared Modal and Button shell as the new-project dialog, with three fields: a name (with a catalog autocomplete that autofills the colour and regional code when a known formation is picked), a colour, and an optional regional reference. It explains that a null starting value means create mode and a filled one means edit mode, that submit is asynchronous and locks the dialog while it runs, and which backend fields are deliberately not surfaced yet. It imports React hooks, the formation and catalog types, two catalog hooks, the shared Button and Modal, and the translation helper.

**Why it is here.** The dialog is built on the shared Modal and Button (see the ``desktop.renderer.src.components.ui.Modal`` and ``desktop.renderer.src.components.ui.Button`` pages) so its dismissal, focus and styling match every other dialog. The autocomplete offers the canonical catalog names but still accepts free text, so informal, foreign or custom formation names are not blocked. The comment records that some backend fields are left out until the formations list needs them — the additive-only rule means unshown fields simply stay unset.

.. CG-EXPLANATION-END id=module-header

``const DEFAULT_COLOR``
-----------------------

.. CG-BLOCK id=const:DEFAULT_COLOR lines=43-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationDialog.tsx
   :language: tsx
   :lines: 43-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_COLOR

**What this does.** The default colour for a new formation: a neutral grey.

**Why it is here.** It matches the backend's own default grey, so a formation created without picking a colour looks the same whether the default is applied in the dialog or on the server.

.. CG-EXPLANATION-END id=const:DEFAULT_COLOR

``const MAX_SUGGESTIONS``
-------------------------

.. CG-BLOCK id=const:MAX_SUGGESTIONS lines=44-45

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationDialog.tsx
   :language: tsx
   :lines: 44-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAX_SUGGESTIONS

**What this does.** The most autocomplete suggestions to show at once: eight.

**Why it is here.** The comment records the reason: it bounds the dropdown height, and a typical name-prefix search returns fewer than eight hits anyway.

.. CG-EXPLANATION-END id=const:MAX_SUGGESTIONS

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=46-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationDialog.tsx
   :language: tsx
   :lines: 46-67
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Lists the dialog's inputs: whether it is ``open``, the ``initialValue`` (null for create, a formation for edit), the ``onSubmit`` handler, and the ``onCancel`` handler.

**Why it is here.** Passing the starting value as null-or-a-formation lets one dialog serve both create and edit, and leaving the submit and cancel to the caller keeps this component to the form itself while the caller owns what saving means.

.. CG-EXPLANATION-END id=interface:Props

``function rankFormationSuggestions``
-------------------------------------

.. CG-BLOCK id=function:rankFormationSuggestions lines=68-97

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationDialog.tsx
   :language: tsx
   :lines: 68-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:rankFormationSuggestions

**What this does.** Ranks catalog formations for a typed query. It lowercases the query, then collects formations whose Dutch name starts with it (ranked first) and, separately, those whose name or abbreviation merely contains it (ranked after), returning the combined list up to the limit.

**Why it is here.** The two-tier ranking puts the most expected hit at the top: a prefix match on the name is the common case, while the substring match catches mid-word typing and code-style queries. It relies on the catalog already being sorted youngest-first, so no extra sort is needed. It is exported so the automated tests can check the ranking directly.

.. CG-EXPLANATION-END id=function:rankFormationSuggestions

``function rankFormalSuggestions``
----------------------------------

.. CG-BLOCK id=function:rankFormalSuggestions lines=98-118

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationDialog.tsx
   :language: tsx
   :lines: 98-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:rankFormalSuggestions

**What this does.** Ranks formal-stratigraphy units for a typed query the same way, matching on either the Dutch name or the code, with prefix matches ranked ahead of substring matches.

**Why it is here.** The same two-tier idea as the function above, extended so a query can match either the readable name or the short code — typing the code surfaces the same unit as typing its name. It is likewise exported for the tests.

.. CG-EXPLANATION-END id=function:rankFormalSuggestions

``function FormationDialog``
----------------------------

.. CG-BLOCK id=function:FormationDialog lines=119-487

.. literalinclude:: ../../../desktop/src/renderer/src/components/interpretation/FormationDialog.tsx
   :language: tsx
   :lines: 119-487
   :lineno-match:

.. CG-EXPLANATION-START id=function:FormationDialog

**What this does.** The dialog component. It keeps the three field values plus a busy flag as *state*, along with the state for two autocomplete dropdowns — one for the formation name against the catalog, one for linking a formal-stratigraphy code. An *effect* resets and prefills every field each time the dialog opens and focuses the name box. Two *memos* compute the live suggestion lists. Picking a name suggestion autofills the name, colour and regional code; picking a formal unit stores its code as the link. Submitting trims the name and sends the payload, staying busy until the save resolves. It draws the Modal with the title, the name box and its suggestion dropdown, the colour and regional-reference fields, the formal-stratigraphy link with its dropdown, and the Cancel and Save buttons.

**Why it is here.** Resetting on open is essential: the comment notes that without it the dialog would leak field values across cancel-and-reopen and edit-and-create cycles. The busy flag disables the fields and buttons while the save runs, so the write cannot be fired twice — the same locking the shared Modal enforces for its dismissal. The suggestion dropdowns close on a short delay so a click on an option registers before the box loses focus. The catalog names shown are the Dutch source names, translated only as display while the stored code stays raw — the translate-at-the-presentation-boundary rule. The Save button is disabled until the name is non-empty, so an unnamed formation cannot be created.

.. CG-EXPLANATION-END id=function:FormationDialog

