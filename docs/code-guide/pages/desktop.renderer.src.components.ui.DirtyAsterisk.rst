desktop.renderer.src.components.ui.DirtyAsterisk
================================================

.. CG-PAGE source=desktop/src/renderer/src/components/ui/DirtyAsterisk.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ui/DirtyAsterisk.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/DirtyAsterisk.tsx
   :language: tsx
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment. It says this file draws a small amber asterisk that means "there are unsaved changes", used next to the project name in the sidebar, next to each CPT and borehole row, and anywhere else that wants the same marker.

**Why it is here.** This is the single source of truth for the unsaved-changes mark, so the same glyph looks and behaves the same everywhere. The comment records the deliberate colour rule: the asterisk is amber, never red, because red is reserved for validation errors in forms; the whole app's unsaved-changes language is amber (sidebar asterisks, the window-title asterisk, edited field borders).

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=11-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/DirtyAsterisk.tsx
   :language: tsx
   :lines: 11-24
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Lists the component's inputs: a required ``title`` (the tooltip text), an optional ``className`` for spacing tweaks, and an optional ``data-testid`` used only by the automated test harness.

**Why it is here.** ``title`` is required because the asterisk on its own is ambiguous — every place that shows it must supply a phrase saying what is unsaved ("Imported since last save…", "Unsaved metadata changes…"), so hovering explains the mark. The other two inputs are optional because the defaults already suit the common case of an asterisk sitting just after a name.

.. CG-EXPLANATION-END id=interface:Props

``function DirtyAsterisk``
--------------------------

.. CG-BLOCK id=function:DirtyAsterisk lines=25-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/DirtyAsterisk.tsx
   :language: tsx
   :lines: 25-35
   :lineno-match:

.. CG-EXPLANATION-START id=function:DirtyAsterisk

**What this does.** The component. It draws a single ``*`` character styled amber, refusing to shrink when space is tight, carrying the caller's tooltip and any extra classes and test id.

**Why it is here.** Keeping the marker in one tiny shared component means the amber-never-red convention is decided in one place; see the shared-primitive pattern introduced on the ``desktop.renderer.src.components.ui.Button`` page. The amber colour is the project's agreed unsaved-changes signal, kept distinct from the red used for errors.

.. CG-EXPLANATION-END id=function:DirtyAsterisk

