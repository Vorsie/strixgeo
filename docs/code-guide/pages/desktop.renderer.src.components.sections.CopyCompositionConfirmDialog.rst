desktop.renderer.src.components.sections.CopyCompositionConfirmDialog
=====================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/CopyCompositionConfirmDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/CopyCompositionConfirmDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CopyCompositionConfirmDialog.tsx
   :language: tsx
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the confirm dialog shown when an Alt+drag copy of a soil composition would overwrite an existing edit on the drop target. The imports pull in the suggestion data type, a display-name helper, the generic confirm dialog, and the translation helper.

**Why it is here.** It exists because of an owner directive (debt #86): confirm before overwriting. It is a thin wrapper over the shared confirm dialog, naming both the source composition and the one being replaced so the engineer sees exactly what is at stake.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=14-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CopyCompositionConfirmDialog.tsx
   :language: tsx
   :lines: 14-24
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: whether the dialog is open, the composition being copied (the dragged layer), the label of the composition currently on the drop target, confirm and cancel callbacks, and a busy flag.

**Why it is here.** Naming both compositions is the whole point — the dialog's job is to show what is being replaced so consent is informed.

.. CG-EXPLANATION-END id=interface:Props

``function CopyCompositionConfirmDialog``
-----------------------------------------

.. CG-BLOCK id=function:CopyCompositionConfirmDialog lines=25-79

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CopyCompositionConfirmDialog.tsx
   :language: tsx
   :lines: 25-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:CopyCompositionConfirmDialog

**What this does.** The component. It builds a readable name for the source composition, then renders the generic confirm dialog with a 'from … to currently …' body and a 'Replace' action button.

**Why it is here.** It uses the shared confirm dialog so it inherits the destructive-action safeguards — default focus on Cancel and an action-named button ('Replace', never 'OK') — following the UX rule for overwrites.

.. CG-EXPLANATION-END id=function:CopyCompositionConfirmDialog

