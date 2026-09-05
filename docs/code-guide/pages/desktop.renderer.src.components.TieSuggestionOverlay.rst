desktop.renderer.src.components.TieSuggestionOverlay
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/TieSuggestionOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/TieSuggestionOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/TieSuggestionOverlay.tsx
   :language: tsx
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the tie-suggestion overlay. The docstring says it draws auto-proposed tie-sections as green dashed ghost lines on the map, and that right-clicking a ghost opens a small Accept/Reject menu — there is no left-click action and no reject dot. The imports bring in ``Fragment`` and the ``useState`` hook, a portal helper, the map's polyline and tooltip pieces, the mouse-event type, the shared context-menu component, a helper that turns a tie into map line coordinates, the suggested-tie shape, and the translator.

**Why it is here.** An *overlay* is a drawing layer painted on top of the map. This one shows the suggested tie-sections (proposed cross-section lines linking related investigations) as faint ghosts the engineer can accept or reject. The docstring explains why the menu is drawn through a *portal* — React drawing into a different part of the page: the menu is placed into the page body so it escapes the map's own drawing tree and can sit at the exact screen position of the click, using the viewport coordinates the map's right-click event carries.

.. CG-EXPLANATION-END id=module-header

``interface TieMenuState``
--------------------------

.. CG-BLOCK id=interface:TieMenuState lines=30-38

.. literalinclude:: ../../../desktop/src/renderer/src/components/TieSuggestionOverlay.tsx
   :language: tsx
   :lines: 30-38
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieMenuState

**What this does.** The little bundle of state kept while the menu is open: the screen x and y to place it at, and the index of the tie it belongs to.

**Why it is here.** The menu needs to remember where it was opened and which ghost it acts on, so those three values are held together while it is showing and cleared when it closes.

.. CG-EXPLANATION-END id=interface:TieMenuState

``interface TieContextMenuProps``
---------------------------------

.. CG-BLOCK id=interface:TieContextMenuProps lines=39-78

.. literalinclude:: ../../../desktop/src/renderer/src/components/TieSuggestionOverlay.tsx
   :language: tsx
   :lines: 39-78
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieContextMenuProps

**What this does.** The inputs to the menu: the screen x and y to anchor it, the tie's index, an accept handler, a reject handler, and a close handler for an outside-click or Escape.

**Why it is here.** Passing the index through unchanged lets the parent map the menu's choice straight back to the right tie; separating accept, reject and close keeps the menu itself decision-free — it only reports what the user picked.

.. CG-EXPLANATION-END id=interface:TieContextMenuProps

``function TieContextMenu``
---------------------------

.. CG-BLOCK id=function:TieContextMenu lines=79-119

.. literalinclude:: ../../../desktop/src/renderer/src/components/TieSuggestionOverlay.tsx
   :language: tsx
   :lines: 79-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:TieContextMenu

**What this does.** Draws the small Accept/Reject menu at the given screen position, using the shared context-menu component in its viewport-positioned mode. Accept and Reject each call their handler with the tie's index.

**Why it is here.** It mirrors the correlation-edge menu so the two right-click menus feel the same. The Reject item is deliberately NOT styled as destructive, and the comment says why: rejecting only drops the ghost from the in-memory suggestion list — no engine or database write — and is fully undone by asking for suggestions again, so it is a reversible action, unlike the genuinely destructive "Delete correlation" on the sibling menu.

.. CG-EXPLANATION-END id=function:TieContextMenu

``interface TieSuggestionOverlayProps``
---------------------------------------

.. CG-BLOCK id=interface:TieSuggestionOverlayProps lines=120-156

.. literalinclude:: ../../../desktop/src/renderer/src/components/TieSuggestionOverlay.tsx
   :language: tsx
   :lines: 120-156
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieSuggestionOverlayProps

**What this does.** The overlay's inputs: the list of suggested ties, the coordinate-system code to project them with, and index-keyed accept and reject handlers.

**Why it is here.** Accept creates a real section and reject drops the suggestion, but neither decision is made here — the overlay reports the index and the parent acts, keeping the overlay purely about drawing.

.. CG-EXPLANATION-END id=interface:TieSuggestionOverlayProps

``function TieSuggestionOverlay``
---------------------------------

.. CG-BLOCK id=function:TieSuggestionOverlay lines=157-238

.. literalinclude:: ../../../desktop/src/renderer/src/components/TieSuggestionOverlay.tsx
   :language: tsx
   :lines: 157-238
   :lineno-match:

.. CG-EXPLANATION-START id=function:TieSuggestionOverlay

**What this does.** The overlay component. It remembers whether a menu is open, and for each suggested tie it projects the tie into map coordinates and draws two lines on top of each other: a slim, non-clickable green dashed line the user sees, and a fat fully-transparent line beneath it that owns the right-click and shows a hover tooltip. A right-click records the click position and tie index to open the menu, and the menu is drawn through the portal when open.

**Why it is here.** The fat invisible line is a deliberate trick (dogfeed 2026-06-10): a 3-pixel dashed line is a tiny target when zoomed out, so a wider transparent band widens the clickable area without thickening the visible ghost. The comment notes the band uses a hair of opacity rather than zero, because the browser only registers clicks on a stroke that is actually painted — a truly invisible band would receive none. The projection turns the tie's metric coordinates into map latitude/longitude using the given coordinate-system code (an EPSG number naming a specific coordinate reference system). The hover tooltip telegraphs the right-click gesture because this is the first right-clickable thing on the map.

.. CG-EXPLANATION-END id=function:TieSuggestionOverlay

