desktop.renderer.src.components.ProjectMetadataDialog
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/ProjectMetadataDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ProjectMetadataDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports. The comment says this is the full editor for a project's details, opened by clicking the project name in the sidebar, and it records two behaviours: every field opens pre-filled with the project's current value (with a faint hint shown only on fields that are truly empty), and when the user saves, only the fields they actually changed are sent onward. The imports bring in three React *hooks* — ``useEffect``, ``useRef`` and ``useState`` (a hook is a helper whose name starts with ``use…`` that lets a piece of interface remember a value or run a side task) — a small close (×) icon, the shared ``Button`` and ``Modal`` building blocks, the TypeScript shapes for a project and an update payload, the lists of pickable horizontal and vertical coordinate systems with their labels, an array-equality helper, and ``useT``, the translation helper.

**Why it is here.** This is a *component* — a reusable piece of on-screen interface written as a function that returns what to draw — and specifically a *dialog*: a small window that opens on top of the app to ask for something, here the project's name, number, client, site, tags, coordinate systems, phase and status. It is drawn inside a *Modal* (a dialog that greys out and blocks the rest of the window until it is dismissed), so the editor has the engineer's full attention while open. Gathering every field's plumbing in one file keeps this one editor self-contained. The two rules in the header comment — pre-fill from current values, and send only what changed — are the whole point of the file and are implemented by the helpers below.

.. CG-EXPLANATION-END id=module-header

``const PHASES``
----------------

.. CG-BLOCK id=const:PHASES lines=34-40

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 34-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:PHASES

**What this does.** A fixed list of the four project phases — feasibility, design, construction and monitoring — each paired with a plain English label. It becomes the choices in the phase dropdown.

**Why it is here.** Listing the allowed phases in one place means the dropdown and the stored value can never drift apart; the code label here is a fallback, while the on-screen text comes from the translation catalogue (see the label-keys blocks below).

.. CG-EXPLANATION-END id=const:PHASES

``const STATUSES``
------------------

.. CG-BLOCK id=const:STATUSES lines=41-49

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 41-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:STATUSES

**What this does.** A fixed list of the three project statuses — active, on hold and completed — each with a plain English label. It becomes the choices in the status dropdown.

**Why it is here.** Same reason as the phases list: one authoritative set of allowed values keeps the dropdown and the stored status in step.

.. CG-EXPLANATION-END id=const:STATUSES

``const PHASE_LABEL_KEYS``
--------------------------

.. CG-BLOCK id=const:PHASE_LABEL_KEYS lines=50-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 50-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:PHASE_LABEL_KEYS

**What this does.** A small table mapping each phase value (``feasibility``, ``design``, …) to the catalogue key that holds its display text (``project.phaseFeasibility`` and so on).

**Why it is here.** This is the *translate at the presentation boundary* rule (CLAUDE.md; Data Integrity Rule 2): the app stores a plain code and looks up the words to show at the moment it draws them, so a future language or a wording change is one edit in the catalogue, not a change to every stored project. The comment notes that ``as const`` keeps each value an exact catalogue key so the translator accepts it without an extra import.

.. CG-EXPLANATION-END id=const:PHASE_LABEL_KEYS

``const STATUS_LABEL_KEYS``
---------------------------

.. CG-BLOCK id=const:STATUS_LABEL_KEYS lines=57-62

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 57-62
   :lineno-match:

.. CG-EXPLANATION-START id=const:STATUS_LABEL_KEYS

**What this does.** The same idea as the phase table, for statuses: it maps ``active`` / ``on_hold`` / ``completed`` to their catalogue keys.

**Why it is here.** The same translate-at-the-boundary rule — the stored value is a code, the shown words are looked up when drawing.

.. CG-EXPLANATION-END id=const:STATUS_LABEL_KEYS

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=63-89

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 63-89
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares the *props* this dialog takes — props are the inputs passed into a component. There are five: ``open`` (is the dialog showing), ``project`` (the live project the form pre-fills from), ``saved`` (the last snapshot written to disk and database), ``onSubmit`` (called with the changed-fields patch when the user saves), and ``onCancel`` (called when they back out).

**Why it is here.** The long comments record a deliberate split that drives the whole dialog: the form fills from ``project`` (which may already hold unsaved live edits), but the per-field "unsaved" highlighting compares against ``saved`` — what is actually on disk. This is the *two-stage save* model (memory): clicking Save here does NOT talk to the engine; it hands the patch to the app, which merges it into the live project, and the real commit to database and the ``.strix`` file happens later via File → Save. Splitting live-versus-saved lets a field show it differs from what is stored even after the user has "saved" it inside this dialog.

.. CG-EXPLANATION-END id=interface:Props

``interface FieldDirty``
------------------------

.. CG-BLOCK id=interface:FieldDirty lines=90-102

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 90-102
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FieldDirty

**What this does.** A shape with one true/false flag per editable field (name, project number, client, site, description, tags, the two coordinate systems, phase, status), saying whether each differs from the saved snapshot.

**Why it is here.** The renderer needs the answer per field so it can paint an amber border on exactly the inputs that are unsaved; keeping these flags in one named shape mirrors the field list used by the diff and dirty checks so the three stay aligned.

.. CG-EXPLANATION-END id=interface:FieldDirty

``function computeFieldDirty``
------------------------------

.. CG-BLOCK id=function:computeFieldDirty lines=103-145

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 103-145
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeFieldDirty

**What this does.** Compares the current form values against the saved snapshot and returns the per-field true/false flags. If there is no saved snapshot yet it returns all-false. For each field it uses the same equality rule the save step uses; the name field is treated specially — a blank name is counted as "no change" rather than as an edit.

**Why it is here.** The per-field highlighting must use exactly the same comparison the save step uses, or a field could glow "unsaved" while the save step decides nothing changed (or the reverse). Sharing ``normaliseText`` and the array-equality helper keeps the highlight and the actual patch in lock-step. Blank name is excluded because an empty name is never saved — it would just preserve the existing name — so it is not really a pending change.

.. CG-EXPLANATION-END id=function:computeFieldDirty

``interface FormState``
-----------------------

.. CG-BLOCK id=interface:FormState lines=146-159

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 146-159
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormState

**What this does.** The shape of everything the form holds while open: the text fields, the tag list plus an in-progress tag draft, the two coordinate-system numbers (or none), the phase (or none) and the status.

**Why it is here.** The form needs its own editable copy of the project's values so the user's typing can diverge from the stored project without touching it; text fields seed from the project with a missing value becoming an empty box, and the save step later compares this copy back against the project to find what changed.

.. CG-EXPLANATION-END id=interface:FormState

``function fromProject``
------------------------

.. CG-BLOCK id=function:fromProject lines=160-179

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 160-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:fromProject

**What this does.** Builds a fresh ``FormState`` from a project: it copies each text field (turning a missing value into an empty string), copies the tag array into a new list, and copies the coordinate systems, phase and status.

**Why it is here.** Seeding the form from the project is what makes every field open pre-filled. The tag array is copied rather than shared so that removing a chip in the form never quietly edits the underlying project's own tag list.

.. CG-EXPLANATION-END id=function:fromProject

``function normaliseText``
--------------------------

.. CG-BLOCK id=function:normaliseText lines=180-188

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 180-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:normaliseText

**What this does.** Takes a text field's value, trims the spaces off the ends, and returns either the trimmed text or "nothing" (null) when the user cleared the field.

**Why it is here.** The database stores a cleared optional field as "nothing", not an empty string, so this one helper defines that conversion once and is reused by both the change-detection and the patch-building code so they always agree on what "empty" means.

.. CG-EXPLANATION-END id=function:normaliseText

``function toPatch``
--------------------

.. CG-BLOCK id=function:toPatch lines=189-231

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 189-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:toPatch

**What this does.** Builds the update payload sent when the user saves, including ONLY the fields that actually differ from the current project. Name is required, so a blank name is skipped (the existing name is kept); the optional text fields go through ``normaliseText`` and are added only when changed; the tag list is included only when it differs; and each dropdown is added only when its value moved.

**Why it is here.** Sending only changed fields is the header comment's second rule. It means an untouched form produces an empty payload, which lets the caller skip the whole apply step — a no-op save costs nothing. The additive, patch-style shape also fits the *additive-only API* contract (``docs/api.md``): fields are optional, and leaving one out means "do not touch it".

.. CG-EXPLANATION-END id=function:toPatch

``function isDirty``
--------------------

.. CG-BLOCK id=function:isDirty lines=232-247

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 232-247
   :lineno-match:

.. CG-EXPLANATION-START id=function:isDirty

**What this does.** Answers a single yes/no: has the form deviated from the project at all? It runs through the same field comparisons as the patch builder (plus one extra — an unsubmitted tag still sitting in the draft box counts as a change) and returns true at the first difference it finds.

**Why it is here.** This one boolean drives the Save button's enabled state and the "you have unsaved changes" prompt when closing. The comment notes it mirrors the patch builder exactly so that "the form is dirty" and "the patch is non-empty" always mean the same thing — otherwise the Save button could be enabled while the save does nothing, or disabled while a real change waits.

.. CG-EXPLANATION-END id=function:isDirty

``function ProjectMetadataDialog``
----------------------------------

.. CG-BLOCK id=function:ProjectMetadataDialog lines=248-573

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 248-573
   :lineno-match:

.. CG-EXPLANATION-START id=function:ProjectMetadataDialog

**What this does.** The dialog component itself. It first calls its hooks in a fixed order: ``useT`` for translation, a ``useState`` holding the form (a hook that remembers a value between redraws, starting empty), and a ``useRef`` pointing at the name box (a hook that holds a value across redraws without causing one). A ``useEffect`` (a hook that runs a side task after a redraw) re-seeds the form from the project every time the dialog opens and focuses the name box, so a second opening never shows stale text from the first. ``handleSubmit`` first folds any half-typed tag into the tag list, builds the changed-fields patch, and either hands it to ``onSubmit`` or, if nothing changed, just cancels. Then comes an early ``return`` that draws nothing when the dialog is closed. Below that it computes the overall dirty flag and the per-field flags, and defines small helpers to update one field, commit a tag, handle Enter/comma/Backspace in the tag box, and remove a chip. Finally it returns the drawing: a ``Modal`` containing a titled header, a two-column grid of all the fields (name, number, client, site, description, a chip-style tag editor, horizontal and vertical coordinate systems, phase and status), and a footer with a Cancel button and a Save button that is disabled unless something changed.

**Why it is here.** The hooks all sit above the early ``return`` on purpose: React's *rules of hooks* require the same hooks to run in the same order on every redraw, so a ``return`` must never come before a hook or the app crashes on the next render. Re-seeding on open is what guarantees the pre-fill rule holds every time, not just the first. Folding the pending tag on save spares the user the surprise of a typed-but-not-Entered tag vanishing. The Save button is disabled when nothing changed because, as the comment puts it, saving with nothing to apply is just a Cancel in disguise. Nothing here calls the engine — consistent with the two-stage save: this Save only updates the in-memory project.

.. CG-EXPLANATION-END id=function:ProjectMetadataDialog

``const fieldClass``
--------------------

.. CG-BLOCK id=const:fieldClass lines=574-581

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 574-581
   :lineno-match:

.. CG-EXPLANATION-START id=const:fieldClass

**What this does.** One string of styling shared by every input, box and dropdown in the form — width, border, padding, text size and the blue focus ring.

**Why it is here.** Defining the input look once means a future restyle is a single edit rather than a change on every field, which is the codebase's don't-repeat-yourself default applied to styling.

.. CG-EXPLANATION-END id=const:fieldClass

``const dirtyFieldClass``
-------------------------

.. CG-BLOCK id=const:dirtyFieldClass lines=582-583

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 582-583
   :lineno-match:

.. CG-EXPLANATION-START id=const:dirtyFieldClass

**What this does.** The extra styling layered onto a field that differs from the saved snapshot: an amber border and a faint amber background.

**Why it is here.** Amber, never red, marks unsaved state (memory; the comment says so explicitly): red is reserved for validation errors in a form, so using amber for "not yet saved" avoids overloading the two meanings and keeps the at-a-glance signal honest.

.. CG-EXPLANATION-END id=const:dirtyFieldClass

``function fieldClassFor``
--------------------------

.. CG-BLOCK id=function:fieldClassFor lines=584-587

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 584-587
   :lineno-match:

.. CG-EXPLANATION-START id=function:fieldClassFor

**What this does.** Picks the styling for one field: the shared base class on its own, or the base class plus the amber unsaved styling when the field is dirty.

**Why it is here.** A tiny helper so every input asks one question — "am I unsaved?" — and gets the right combined styling, keeping the amber-marking rule in one place.

.. CG-EXPLANATION-END id=function:fieldClassFor

``function Label``
------------------

.. CG-BLOCK id=function:Label lines=588-606

.. literalinclude:: ../../../desktop/src/renderer/src/components/ProjectMetadataDialog.tsx
   :language: tsx
   :lines: 588-606
   :lineno-match:

.. CG-EXPLANATION-START id=function:Label

**What this does.** A small sub-component that draws a form field's label, and optionally a red asterisk when the field is required.

**Why it is here.** Every field needs the same small, consistent label styling and the same accessible link to its input, so it is written once here and reused above rather than repeated at each field.

.. CG-EXPLANATION-END id=function:Label

