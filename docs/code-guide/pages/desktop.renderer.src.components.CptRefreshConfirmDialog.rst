desktop.renderer.src.components.CptRefreshConfirmDialog
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/CptRefreshConfirmDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/CptRefreshConfirmDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptRefreshConfirmDialog.tsx
   :language: tsx
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the CPT-refresh confirmation. The comment explains the situation: re-importing a GEF file whose CPT is already stored replaces that CPT's readings and header in place, there is no undo, and every contact and litho layer anchored on the old depths now sits against different numbers — so the engineer is asked per file, and asked about the numbers rather than the filename. The imports bring in the diff shape from the API client, the shared ``ConfirmDialog``, and the translator.

**Why it is here.** This is the archetype irreversible-action confirmation for the whole app, and the comment cites ``docs/ux.md`` "Reversible vs irreversible" directly: an irreversible write gets a confirmation dialog, Cancel holds default focus, and the go-ahead button names the action ("Replace data", never "OK"). It is the desktop side of the *consented CPT refresh* contract (``docs/api.md``): a re-import that would overwrite is refused by the engine with a diff and writes nothing until the user confirms, and this dialog is where that consent is asked. It is asked on the numbers, not the filename, because a truncated download and the good original share the same name.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=16-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptRefreshConfirmDialog.tsx
   :language: tsx
   :lines: 16-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, the name of the file being imported, the old-versus-new numbers the engine returned when it refused, a confirm callback for "Replace data", and a cancel callback for Cancel, Escape or a backdrop click.

**Why it is here.** The diff comes straight from the engine's refusal (per the comments): rather than guess, the engine hands back the stored depth and reading count next to the incoming file's, so the dialog can show the engineer exactly what would change. Cancel leaving the stored CPT untouched is the safe default the reversible-versus-irreversible rule requires.

.. CG-EXPLANATION-END id=interface:Props

``function depth``
------------------

.. CG-BLOCK id=function:depth lines=30-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptRefreshConfirmDialog.tsx
   :language: tsx
   :lines: 30-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:depth

**What this does.** Formats a depth for the comparison table — the value in metres to two decimals, or a dash when the engine has no value.

**Why it is here.** A tiny shared formatter so both the stored and incoming depth cells render the same way, including the case where a number is missing.

.. CG-EXPLANATION-END id=function:depth

``function rows``
-----------------

.. CG-BLOCK id=function:rows lines=35-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptRefreshConfirmDialog.tsx
   :language: tsx
   :lines: 35-43
   :lineno-match:

.. CG-EXPLANATION-START id=function:rows

**What this does.** Formats a reading count for the comparison table — the number, or a dash when it is unknown.

**Why it is here.** The same idea as the depth formatter, for the reading-count row.

.. CG-EXPLANATION-END id=function:rows

``function CptRefreshConfirmDialog``
------------------------------------

.. CG-BLOCK id=function:CptRefreshConfirmDialog lines=44-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptRefreshConfirmDialog.tsx
   :language: tsx
   :lines: 44-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:CptRefreshConfirmDialog

**What this does.** The dialog component. It draws a ``ConfirmDialog`` (drawn only when open and a diff is present) with a title naming the CPT, a body that shows the file name and a two-row table comparing the stored depth and readings against the incoming file's, plus a note when the fresh parse carried warnings. The go-ahead button reads "Replace data" and is styled as destructive.

**Why it is here.** Showing the old-versus-new table is the point: the engineer decides on the actual numbers, so a shorter or broken file is obvious before it overwrites good data. The confirm button is destructive-styled and named for its action, and Cancel is the safe default — the reversible-versus-irreversible rule from ``docs/ux.md`` that this dialog is the template for. The whole exchange realises the consented-refresh flow: nothing is overwritten in the project until this confirmation is given.

.. CG-EXPLANATION-END id=function:CptRefreshConfirmDialog

