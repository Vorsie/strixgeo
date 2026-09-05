desktop.renderer.src.shell.EmptyState
=====================================

.. CG-PAGE source=desktop/src/renderer/src/shell/EmptyState.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/EmptyState.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/shell/EmptyState.tsx
   :language: tsx
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds two small, reusable pieces of interface: one for an empty surface (nothing to show yet) and one for a surface that is still loading. The comments point at the rule they follow — an empty area should show an icon and words, never just blank space, and something still loading should show motion so the user can tell "working" from "stuck". The single import brings in a spinner icon.

**Why it is here.** The comment records that this shape was lifted out of the Geology canvas, which already did an empty state well (an icon plus a line telling the user what to do), so the several plainer spots that just showed bare text can adopt the same look instead of each re-inventing it. It notes the project's "extract on the second copy" rule was already met — roughly six places need this — so making it a shared piece is warranted, not premature.

.. CG-EXPLANATION-END id=module-header

``interface EmptyStateProps``
-----------------------------

.. CG-BLOCK id=interface:EmptyStateProps lines=14-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/EmptyState.tsx
   :language: tsx
   :lines: 14-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EmptyStateProps

**What this does.** Describes the inputs an empty-state block takes: an ``icon`` to show, a ``title`` line saying what the surface is or why it is empty, an optional ``hint`` line telling the user what to do about it, optional ``children`` (any extra content, such as a button, drawn underneath), and a ``compact`` flag for a smaller version used inside lists and panels. The ``children`` and ``icon`` fields are typed as anything React can draw.

**Why it is here.** The fields mirror the good Geology-canvas empty state the docstring names as the reference: an icon, a primary line, an optional guidance line, and room for a call-to-action. The compact variant exists because the same block is needed both filling a whole pane and tucked into a small list, and the two want different sizes.

.. CG-EXPLANATION-END id=interface:EmptyStateProps

``function EmptyState``
-----------------------

.. CG-BLOCK id=function:EmptyState lines=53-93

.. literalinclude:: ../../../desktop/src/renderer/src/shell/EmptyState.tsx
   :language: tsx
   :lines: 53-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:EmptyState

**What this does.** Draws a centred block: the icon on top (larger in the full version, smaller in the compact one), then the title line, then the optional hint line beneath it, then any extra content passed in. Everything is centred both across and down its area.

**Why it is here.** The docstring states it deliberately mirrors the Geology-canvas empty-state layout that the project's interface guide holds up as the reference — a muted icon over centred, width-limited text — so every empty surface in the app looks and reads the same way.

.. CG-EXPLANATION-END id=function:EmptyState

``interface LoadingStateProps``
-------------------------------

.. CG-BLOCK id=interface:LoadingStateProps lines=94-114

.. literalinclude:: ../../../desktop/src/renderer/src/shell/EmptyState.tsx
   :language: tsx
   :lines: 94-114
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LoadingStateProps

**What this does.** Describes the single input a loading block takes: a ``label`` saying what is loading, such as "Loading chart…".

**Why it is here.** Keeping it to one field makes the loading block trivial to drop in anywhere; the only thing that varies from place to place is the wording of what the user is waiting for.

.. CG-EXPLANATION-END id=interface:LoadingStateProps

``function LoadingState``
-------------------------

.. CG-BLOCK id=function:LoadingState lines=115-126

.. literalinclude:: ../../../desktop/src/renderer/src/shell/EmptyState.tsx
   :language: tsx
   :lines: 115-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:LoadingState

**What this does.** Draws a centred spinning icon next to the label, and marks the area as a live status region so assistive tools announce it.

**Why it is here.** The docstring records that this replaces bare "Loading …" text because the interface guide requires motion while waiting, so the user can tell a working surface from a hung one. Marking it as a polite live status region means a screen reader speaks the loading message without interrupting whatever the user is doing.

.. CG-EXPLANATION-END id=function:LoadingState

