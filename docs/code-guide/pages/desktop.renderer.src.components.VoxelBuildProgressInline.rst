desktop.renderer.src.components.VoxelBuildProgressInline
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/VoxelBuildProgressInline.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/VoxelBuildProgressInline.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/VoxelBuildProgressInline.tsx
   :language: tsx
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the inline 3-D voxel-build progress control (debt #282). It draws the current phase, a progress bar and a Cancel button in place of the Build button while a build runs. It imports a close icon, the build state and phase types, the message-key type, the translator, and a toolbar-button primitive.

**Why it is here.** The docstring records that the toolbar swaps the Build button for this control while a background build job runs, and reverts to the Build button on every finished state. It reuses the DOV import panel's bar look (see the ``DovImportProgressPanel`` page) so the two progress indicators read alike rather than each inventing its own.

.. CG-EXPLANATION-END id=module-header

``function phaseLabelKey``
--------------------------

.. CG-BLOCK id=function:phaseLabelKey lines=21-33

.. literalinclude:: ../../../desktop/src/renderer/src/components/VoxelBuildProgressInline.tsx
   :language: tsx
   :lines: 21-33
   :lineno-match:

.. CG-EXPLANATION-START id=function:phaseLabelKey

**What this does.** Maps each build phase (label, reconcile, extract, persist) to the catalogue key for its progress wording.

**Why it is here.** Keeping the phase codes and their display keys in one lookup follows the translate-at-the-presentation-boundary rule (CLAUDE.md) — the engine reports a plain phase code and the words are looked up when drawn — so a wording change is one edit in the catalogue.

.. CG-EXPLANATION-END id=function:phaseLabelKey

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=34-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/VoxelBuildProgressInline.tsx
   :language: tsx
   :lines: 34-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The control's inputs: the build state, a cancel handler, and an optional test id for the Cancel button.

**Why it is here.** The Cancel test id is configurable (per its comment) so the litho and geotech toolbars each address their own Cancel button independently, while defaulting to the litho id leaves the litho toolbar unchanged (debt #282).

.. CG-EXPLANATION-END id=interface:Props

``function VoxelBuildProgressInline``
-------------------------------------

.. CG-BLOCK id=function:VoxelBuildProgressInline lines=52-112

.. literalinclude:: ../../../desktop/src/renderer/src/components/VoxelBuildProgressInline.tsx
   :language: tsx
   :lines: 52-112
   :lineno-match:

.. CG-EXPLANATION-START id=function:VoxelBuildProgressInline

**What this does.** The control component. It draws nothing unless a build is running. While running it reads the latest phase, its label and its done/total counts, works out the percentage or an indeterminate signal, and draws the phase label (or a "cancelling" note), an optional percentage, a determinate-or-pulsing bar, and a Cancel button that disables itself once a cancel has been requested.

**Why it is here.** Drawing nothing except while running lets the toolbar revert to the Build button on every finished state without extra logic. A phase with no measurable total shows the pulsing "working" bar instead of a filling one, exactly like the DOV import bar. Disabling Cancel once cancellation is requested stops a second cancel being fired while the first is being honoured, and the control announces its progress politely to assistive tools.

.. CG-EXPLANATION-END id=function:VoxelBuildProgressInline

