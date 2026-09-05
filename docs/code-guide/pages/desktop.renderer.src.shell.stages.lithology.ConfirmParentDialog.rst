desktop.renderer.src.shell.stages.lithology.ConfirmParentDialog
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/ConfirmParentDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/ConfirmParentDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/ConfirmParentDialog.tsx
   :language: tsx
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its tools. It imports the React hooks it uses (``useEffect``, ``useMemo``, ``useRef``, ``useState``), the type that describes a geological-formation record coming back from the engine, the shared ``Button`` and ``Modal`` building blocks, and the translation helper ``useT``. The long comment at the top lays out the dialog's job and its three actions.

**Why it is here.** React is the library that builds the screen from small functions; a ``hook`` is a ``use...`` function that lets one of those functions use a React feature. This dialog exists because a litho unit's parent geological formation is sometimes only a guess. Under the "A2" rule a litho unit is accepted with no parent, and the engine later infers one by extrapolating the geology surfaces (debt #87); the unit may also have no parent at all (an orphan). The dialog is how the engineer confirms the guessed parent, picks a different one (reassign), or clears it (detach). The comment records the keyboard flow — the parent dropdown gets focus so the engineer glances at the suggestion and presses Enter, while Cancel or Esc leaves the row exactly as it was.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=26-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/ConfirmParentDialog.tsx
   :language: tsx
   :lines: 26-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Describes, as a TypeScript ``interface`` (a note naming the shape of an object), the inputs the dialog expects from its parent: whether it is ``open``, the litho ``formation`` being reviewed, the list of candidate parent ``geoFormations`` to choose from, an ``onSubmit`` callback fired with the chosen parent id (or ``null`` for detach), an ``onCancel`` callback for Cancel/Esc/backdrop, and an optional ``busy`` flag.

**Why it is here.** ``props`` are the inputs a parent hands a component; typing them makes the contract explicit so a caller cannot forget one or pass the wrong kind. The comments pin down two domain points: the candidate parents are the project's geological formations only (never litho rows), and the same PATCH that writes the chosen parent also clears the "this parent was extrapolated" flag, so confirming a guess and correcting a guess are one action to the engine.

.. CG-EXPLANATION-END id=interface:Props

``function ConfirmParentDialog``
--------------------------------

.. CG-BLOCK id=function:ConfirmParentDialog lines=40-144

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/ConfirmParentDialog.tsx
   :language: tsx
   :lines: 40-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:ConfirmParentDialog

**What this does.** The dialog component itself. It keeps a local ``selectedParentId`` (``state`` — a value the component remembers between redraws), seeded from the unit's current parent and reset every time the dialog opens on a new unit. One effect focuses the parent dropdown when the dialog opens; a memoised list sorts the candidate parents by ``display_order`` (oldest first). It draws a ``Modal`` with a title and blurb that change for the orphan versus the extrapolated case, a labelled dropdown of parent options (with a "no parent" choice at the top), and a Cancel button beside a primary button whose label reads Detach, Confirm, or Reassign depending on what is selected.

**Why it is here.** The primary button names the actual action — Detach when nothing is selected, Confirm when the selection still equals the current parent, Reassign when it differs — so the engineer always sees the verb for the choice in front of him rather than a generic "OK". Sorting the parents oldest-first matches the superposition convention every other screen uses, so the list reads like a stratigraphic column. The dropdown is given focus on open so the keyboard flow is glance-then-Enter. The selection is reset on each open so a previous review never bleeds into the next unit.

.. CG-EXPLANATION-END id=function:ConfirmParentDialog

