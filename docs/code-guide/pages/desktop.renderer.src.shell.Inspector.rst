desktop.renderer.src.shell.Inspector
====================================

.. CG-PAGE source=desktop/src/renderer/src/shell/Inspector.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/Inspector.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/shell/Inspector.tsx
   :language: tsx
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file draws the panel on the right of the screen. The comments describe it as push-mode and non-modal: when it opens it takes width from the centre canvas (pushing it narrower) rather than floating over it, so the user can work with both at once; there is no dimmed backdrop. Opening and closing is a width slide. It shows the active stage's own inspector component and hands it no inputs — that component reads what it needs from the shared bus. The imports bring in the stage-id type, the registry, and the translation hook.

**Why it is here.** This is the app's detail-panel rule written into the shell: Apple's interface guidance calls this a non-modal Inspector, and the project follows it — the panel is push-mode, not an overlay. The slide animation is wrapped so a reduced-motion viewer sees an instant toggle, and only theme tokens are used for its colours.

.. CG-EXPLANATION-END id=module-header

``const WIDTH_OPEN``
--------------------

.. CG-BLOCK id=const:WIDTH_OPEN lines=21-22

.. literalinclude:: ../../../desktop/src/renderer/src/shell/Inspector.tsx
   :language: tsx
   :lines: 21-22
   :lineno-match:

.. CG-EXPLANATION-START id=const:WIDTH_OPEN

**What this does.** The width the panel takes when open: 420 pixels.

**Why it is here.** 420 pixels is the project's fixed inspector width — wide enough to hold small tables and charts, narrow enough not to dominate the screen. Naming it once means the open state cannot drift to a different width by accident.

.. CG-EXPLANATION-END id=const:WIDTH_OPEN

``const WIDTH_CLOSED``
----------------------

.. CG-BLOCK id=const:WIDTH_CLOSED lines=23-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/Inspector.tsx
   :language: tsx
   :lines: 23-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:WIDTH_CLOSED

**What this does.** The width the panel takes when closed: zero.

**Why it is here.** Collapsing to zero width, rather than being removed from the layout, is what lets the centre canvas smoothly reclaim the freed space and lets the open/close slide animate between the two widths.

.. CG-EXPLANATION-END id=const:WIDTH_CLOSED

``interface InspectorProps``
----------------------------

.. CG-BLOCK id=interface:InspectorProps lines=25-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/Inspector.tsx
   :language: tsx
   :lines: 25-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InspectorProps

**What this does.** Describes the two inputs the panel needs: the ``activeStageId`` (so it can fetch that stage's inspector component) and ``open`` (whether it is currently expanded).

**Why it is here.** The docstring explains the mechanism: when ``open`` is false the panel collapses to zero width and its contents are clipped, and because the body row is a flex layout the centre canvas claims the freed space on its own. The contents never need to know the open state — they are simply hidden by the collapse.

.. CG-EXPLANATION-END id=interface:InspectorProps

``function Inspector``
----------------------

.. CG-BLOCK id=function:Inspector lines=56-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/Inspector.tsx
   :language: tsx
   :lines: 56-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:Inspector

**What this does.** Draws the panel. It looks up the active stage's inspector component, then returns a side panel whose width is 420 pixels when open and zero when closed, sliding between the two. An inner container is held at the full 420-pixel width and clipped by the outer panel, and the stage's inspector content is drawn inside it.

**Why it is here.** The comments record why the width is split across two containers: the outer panel owns the animated width while the inner container stays at its target width, so the content does not reflow awkwardly during the slide — it is simply revealed or clipped. Clipping the overflow also stops a stray horizontal scrollbar appearing on the body row mid-animation.

.. CG-EXPLANATION-END id=function:Inspector

