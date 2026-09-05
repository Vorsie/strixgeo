desktop.renderer.src.components.borelog.components.TrackHeader
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/TrackHeader.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/TrackHeader.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/TrackHeader.tsx
   :language: tsx
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the header-height constant, the ``truncate`` helper and the translation helper. The comment describes the title block at the top of every track — a faint background with a bold title and an optional muted subtitle — and documents each input: the position and width, the translated title, the optional subtitle, the raw upstream token, and an optional hide handler.

**Why it is here.** The comment records several decisions: text is horizontal because diagonal reads poorly at screen sizes; the title and subtitle are trimmed to fixed character counts because SVG cannot measure text on the spot, and those counts were tuned against the default column widths. Most importantly, when a raw token is supplied it is shown as the header's hover tooltip so a domain expert can verify the translation without leaving the app — the translate-at-the-presentation-boundary rule from the UX conventions and CLAUDE.md, which requires showing the raw upstream token behind every translated label.

.. CG-EXPLANATION-END id=module-header

``function TrackHeader``
------------------------

.. CG-BLOCK id=function:TrackHeader lines=56-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/TrackHeader.tsx
   :language: tsx
   :lines: 56-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:TrackHeader

**What this does.** The header component. It reads the translation helper and picks the tooltip text — the raw token normally, or a "Hide column" hint when a hide handler is wired. It draws a group that, when hidden is enabled, becomes clickable with a pointer cursor and a button role; inside it draws the background rectangle (carrying the tooltip), the trimmed bold title, and the trimmed subtitle when present.

**Why it is here.** Showing the raw token as the tooltip is the raw-token half of the translate-at-the-boundary rule, letting the engineer confirm that, say, the Dutch source token maps to the shown English label. When a hide handler is present the header turns into a click-to-hide control, which is a reversible action — hiding a column is undoable — so it fires immediately with a plain pointer affordance rather than a confirmation. The click priority is recorded in the comment: the "Hide column" hint replaces the raw-token tooltip because the action takes precedence over the informational label. All colours come from theme variables so the header is legible in both themes without threading the theme through every sub-component.

.. CG-EXPLANATION-END id=function:TrackHeader

