desktop.renderer.src.shell.stages.sections.useLithoGeoSnapDialog
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the litho-to-geology snap prompt. When a litho-contact drag (or a single-suggestion accept) lands within tolerance of a geological contact, a three-option prompt opens: snap the litho contact to the geo depth, move the geo contact to the litho depth (with a surface rebuild), or keep them separate.

**Why it is here.** Extracted verbatim from the canvas (debt #201 round 2). Both axes that edit a litho contact ask it — the litho axis directly, the geotech axis through the band-boundary drag that resolves to the same litho row, because about a third of the owner's litho layers carry a geological-contact link, so that drag runs into a geological contact roughly one time in three, and the answer must be the SAME prompt (owner: 'same mental model'), not a second silent mechanism.

.. CG-EXPLANATION-END id=module-header

``interface LithoGeoSnapPrompt``
--------------------------------

.. CG-BLOCK id=interface:LithoGeoSnapPrompt lines=26-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts
   :language: typescript
   :lines: 26-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoGeoSnapPrompt

**What this does.** The open prompt: the litho contact id, the raw drag depth, the candidate geological contacts within tolerance, and which boundary of the contact the drag moved (top or base).

**Why it is here.** The field is required with no default so it can never be silently dropped again — a base-edge drag that snaps must write the base depth, not the top.

.. CG-EXPLANATION-END id=interface:LithoGeoSnapPrompt

``interface UseLithoGeoSnapDialogDeps``
---------------------------------------

.. CG-BLOCK id=interface:UseLithoGeoSnapDialogDeps lines=38-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts
   :language: typescript
   :lines: 38-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoGeoSnapDialogDeps

**What this does.** What the handlers consume: the project, the litho and geotech axis flags, the litho contacts, the geological contacts (the candidate search space), the per-project snap tolerance, the depth-update and backdrop-reload actions, and the toast.

**Why it is here.** The geotech flag is here because the geotech axis edits litho contacts too — its band-boundary drag lands on the litho row, and a third of those restate a geological contact, so the coupling question is the same one.

.. CG-EXPLANATION-END id=interface:UseLithoGeoSnapDialogDeps

``interface UseLithoGeoSnapDialogResult``
-----------------------------------------

.. CG-BLOCK id=interface:UseLithoGeoSnapDialogResult lines=74-104

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts
   :language: typescript
   :lines: 74-104
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoGeoSnapDialogResult

**What this does.** The prompt and busy state, the live contact-depth preview, and the five handlers — open the prompt, the live-preview setter, the snap-aware depth update, snap-litho-to-geo, move-geo-to-litho, and cancel.

**Why it is here.** The canvas renders the dialog from the prompt state and wires the three choices to the three handlers.

.. CG-EXPLANATION-END id=interface:UseLithoGeoSnapDialogResult

``function useLithoGeoSnapDialog``
----------------------------------

.. CG-BLOCK id=function:useLithoGeoSnapDialog lines=105-274

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts
   :language: typescript
   :lines: 105-274
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithoGeoSnapDialog

**What this does.** The snap-aware update commits the litho contact at the raw drag depth first, then (on either editing axis) searches for geological contacts within tolerance and opens the prompt if any exist. Snap-litho-to-geo patches the litho contact to the geo depth carrying the same field; move-geo-to-litho patches the geological contact to the litho depth, rebuilds the surfaces, reloads the backdrop, and rolls back on failure. It also owns the live-preview state that lets a committed contact follow a cross-store suggestion drag visually.

**Why it is here.** The litho contact commits first so the engineer sees the drag result immediately, then the coupling question follows. The move path rebuilds surfaces because moving a geological contact re-runs the TIN; it rolls back best-effort on failure and swallows a secondary rollback error since the engineer already saw the primary one.

.. CG-EXPLANATION-END id=function:useLithoGeoSnapDialog

