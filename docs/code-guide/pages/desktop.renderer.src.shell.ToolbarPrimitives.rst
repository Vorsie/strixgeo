desktop.renderer.src.shell.ToolbarPrimitives
============================================

.. CG-PAGE source=desktop/src/renderer/src/shell/ToolbarPrimitives.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/ToolbarPrimitives.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and brings in its tools. This file holds the shared building-block buttons every stage toolbar is made of — a plain button, a highlighted primary button, a drop-down, and a split button. They are *components*: reusable pieces of on-screen interface, written with React (the library that builds the interface out of such pieces) as functions that return what to draw. It imports two small icons, React's memory-and-effect helpers, the tool that draws a menu into a separate layer of the page, and the translation helper. The comment block that follows the imports is the plain-English contract for the first helper, shown in the next section.

**Why it is here.** The header comment records why these pieces were gathered here (debt #46). The plain and primary buttons had been copy-pasted, body-for-body, into two separate stage toolbars, with a third copy due — past the project's rule that a pattern repeated a third time must be lifted into one shared place. They were moved here unchanged, and one improvement was added along the way: a ``busy`` switch that swaps a button's icon for a spinning one, because docs/ux.md requires a long-running action to both disable itself and show motion, yet only one button had wired that up. Putting the spinner in the shared button gives every slow verb — Fill, Seed, Dedupe, the Plaxis export, delete — that feedback for free.

.. CG-EXPLANATION-END id=module-header

``function iconOnlyProps``
--------------------------

.. CG-BLOCK id=function:iconOnlyProps lines=29-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 29-38
   :lineno-match:

.. CG-EXPLANATION-START id=function:iconOnlyProps

**What this does.** A small helper that works out the tooltip and the spoken (screen-reader) name for a button that might be shown as just an icon. When the button is icon-only it gives back the short verb as the spoken name and the fuller text as the tooltip; when the button still shows its label it leaves the spoken name off (the visible label already serves) and keeps whatever tooltip was supplied.

**Why it is here.** The docstring makes the point that a screen-reader or voice-control user wants the short verb — they say “click Bodies” and scan a toolbar as a verb list — not a five-sentence description. So the accessible name is the short verb and the long description stays where a description belongs: the hover tooltip. Centralising this rule means every icon-only button announces itself the same correct way.

.. CG-EXPLANATION-END id=function:iconOnlyProps

``interface PrimaryToolbarButtonProps``
---------------------------------------

.. CG-BLOCK id=interface:PrimaryToolbarButtonProps lines=39-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 39-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PrimaryToolbarButtonProps

**What this does.** Lists the inputs the primary (accent-filled) button accepts. This is an *interface* — a note fixing which named inputs a value must carry, checked before the app runs and then gone. The inputs are: the ``icon`` to show, the text ``label``, the ``onClick`` action, an optional ``disabled`` switch, a ``title`` tooltip, a ``busy`` switch, a ``testid`` for automated tests to find the button by, and an ``iconOnly`` switch. The comment block below the list is the plain-English contract for the button function shown next.

**Why it is here.** The comments record two deliberate contracts. ``busy`` only adds the spinning motion docs/ux.md requires — the caller still owns disabling the button and swapping its label — so the primitive stays simple and the caller stays in control. ``iconOnly`` is the narrow-width rung of the responsive ladder: dropping the text does not lose the label, it moves it into the tooltip and the spoken name, so the control is still hoverable and still announced.

.. CG-EXPLANATION-END id=interface:PrimaryToolbarButtonProps

``function PrimaryToolbarButton``
---------------------------------

.. CG-BLOCK id=function:PrimaryToolbarButton lines=83-117

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 83-117
   :lineno-match:

.. CG-EXPLANATION-START id=function:PrimaryToolbarButton

**What this does.** Draws the accent-filled button a stage uses for its main entry action. It returns a single clickable button showing the icon (or a spinning icon while busy) and, unless it is icon-only, the label; disabled buttons are dimmed and made non-clickable. The look is the filled accent colour with a hover shade.

**Why it is here.** This is the shared, single copy of what used to be duplicated across toolbars, so every stage's primary verb looks and behaves identically. The comment on the spoken-name line notes the careful rule: a labelled button keeps its old contract (its spoken name is the full description), while an icon-only button takes the short verb as its spoken name — matching the ``iconOnlyProps`` helper — so no button ever announces itself as a blank.

.. CG-EXPLANATION-END id=function:PrimaryToolbarButton

``interface ToolbarButtonProps``
--------------------------------

.. CG-BLOCK id=interface:ToolbarButtonProps lines=118-166

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 118-166
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ToolbarButtonProps

**What this does.** Lists the inputs for the ordinary (secondary) toolbar button. Same core inputs as the primary button — icon, label, onClick, disabled, title, busy, testid, iconOnly — plus two tint switches: ``amber`` and ``danger``. The comment block that follows is the contract for the button function shown next.

**Why it is here.** The two tints carry meaning, not decoration: ``amber`` marks a control tied to a stale, not-yet-rebuilt surface, and ``danger`` marks a destructive verb in red. Giving them named switches keeps the meaning consistent everywhere the button is used, rather than each toolbar hand-colouring its own.

.. CG-EXPLANATION-END id=interface:ToolbarButtonProps

``function ToolbarButton``
--------------------------

.. CG-BLOCK id=function:ToolbarButton lines=167-211

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 167-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:ToolbarButton

**What this does.** Draws the compact button used for a stage's secondary verbs. Like the primary button it shows an icon (or a spinner when busy) and, unless icon-only, a label, and dims when disabled — but its colour follows the tint rules: red when marked dangerous, amber when marked stale, otherwise the quiet default with a hover shade. Below the function is a comment introducing the drop-down control described in the next sections.

**Why it is here.** It borrows the ``iconOnlyProps`` helper so its tooltip and spoken name obey the same accessibility rule as every other primitive. The tint order matters — dangerous wins over amber wins over default — so a destructive verb always reads as destructive even if it were somehow also marked stale.

.. CG-EXPLANATION-END id=function:ToolbarButton

``interface ToolbarDropdownItem``
---------------------------------

.. CG-BLOCK id=interface:ToolbarDropdownItem lines=212-263

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 212-263
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ToolbarDropdownItem

**What this does.** The shape of one row inside a drop-down menu: its ``label``, an optional leading ``icon``, the ``onClick`` it fires (the menu closes itself afterwards), an optional ``disabled`` switch with tooltip, a ``testid``, an optional trailing ``tag`` pill (such as a “Phase 4” not-yet-available marker), and two shortcut fields — ``shortcut`` and ``shortcutHint``. The comment block after the shape is the contract for the shared menu-state hook shown next.

**Why it is here.** The comments draw a sharp line between the two shortcut fields, and it is a line that prevents a real bug. ``shortcut`` is a live key: it is shown after the label in parentheses (the owner's 2026-08-31 request, “like between parentheses at the back”) and the shortcuts hook actually fires it. ``shortcutHint`` looks identical on screen but is only a reminder for a key that some other, dedicated piece of code already handles (the bare toggles L for litho fill, F for geotech fill, P for sample markers). Setting a real ``shortcut`` for one of those would fire it twice — the hook and the old handler both — and a fill toggled twice is a fill that never moves, so the display-only field exists to show the key without claiming to dispatch it.

.. CG-EXPLANATION-END id=interface:ToolbarDropdownItem

``function usePortalMenu``
--------------------------

.. CG-BLOCK id=function:usePortalMenu lines=264-306

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 264-306
   :lineno-match:

.. CG-EXPLANATION-START id=function:usePortalMenu

**What this does.** A shared *hook* — a ``use``-named helper that lets a component remember things — that owns the open/closed state of a floating menu and where it should appear. It remembers whether the menu is open and the on-screen rectangle of the button that anchors it, and while the menu is open it wires up the two ways to dismiss it: a mouse press anywhere outside, and the Escape key. It hands back the open flag, the anchor rectangle, a ``toggle`` to open or close, and a ``close``.

**Why it is here.** The docstring notes it exists so the same open/anchor/dismiss plumbing is written exactly once and reused by the drop-down, the split button and the Data-stage import menu. The comment on the dismiss listener explains it watches for the mouse press (mousedown) rather than the full click, so the menu closes before the following click can land on something behind it — matching the context-menu behaviour used elsewhere in the app. Presses inside the anchoring button are ignored here because that button's own handler already toggles the menu.

.. CG-EXPLANATION-END id=function:usePortalMenu

``interface PortalMenuProps``
-----------------------------

.. CG-BLOCK id=interface:PortalMenuProps lines=307-342

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 307-342
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PortalMenuProps

**What this does.** Lists the inputs for the floating menu: the ``anchorRect`` (the rectangle of the button it hangs beneath), an ``ariaLabel`` spoken name, the ``items`` to list, an ``onClose`` called after an item runs, an ``align`` of left or right, an optional ``widthPx``, and optional extra styling classes. The comment block below is the contract for the menu function shown next.

**Why it is here.** The comments explain the alignment choice: left is the default, but right-alignment pins the menu to the button's right edge using the given width, so a menu full of wide items does not bleed off the edge of a narrow window. Requiring a width for right alignment is what lets the menu be positioned from its right edge at all.

.. CG-EXPLANATION-END id=interface:PortalMenuProps

``function PortalMenu``
-----------------------

.. CG-BLOCK id=function:PortalMenu lines=343-407

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 343-407
   :lineno-match:

.. CG-EXPLANATION-START id=function:PortalMenu

**What this does.** Draws the small floating menu shared by every toolbar drop-down. It renders into a separate top layer of the page (a *portal*) positioned just under the anchoring button, then lists each item as a row showing its optional icon, its label, any shortcut in parentheses, and any trailing tag pill. Clicking an enabled row runs its action and then closes the menu; disabled rows are dimmed and do nothing. A mouse press inside the menu is deliberately stopped from travelling further.

**Why it is here.** Rendering into a separate top layer is the key trick: the menu escapes any toolbar zone that hides its own overflow, so it can never be clipped by the very bar it belongs to, and it floats above everything else on the page. Swallowing the inside mouse-press is what stops the outside-press dismiss from immediately treating the menu's own click as an outside click and closing it. The shortcut and hint are shown identically — both simply appear in parentheses — because to the eye there is no difference; only the code behind them differs.

.. CG-EXPLANATION-END id=function:PortalMenu

``interface ToolbarDropdownProps``
----------------------------------

.. CG-BLOCK id=interface:ToolbarDropdownProps lines=408-432

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 408-432
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ToolbarDropdownProps

**What this does.** Lists the inputs for the drop-down control: its trigger ``icon`` and ``label``, an optional ``title`` tooltip, a ``disabled`` switch, the ``items`` to show when it opens, a ``testid``, and an ``iconOnly`` switch. The comment block that follows is the contract for the drop-down function shown next.

**Why it is here.** Disabling the trigger is called out as cascading: when the button itself is disabled every item inside becomes unreachable, which is the intended all-or-nothing behaviour for a menu whose whole group of verbs does not currently apply.

.. CG-EXPLANATION-END id=interface:ToolbarDropdownProps

``function ToolbarDropdown``
----------------------------

.. CG-BLOCK id=function:ToolbarDropdown lines=433-488

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 433-488
   :lineno-match:

.. CG-EXPLANATION-START id=function:ToolbarDropdown

**What this does.** Draws a button that, when clicked, opens the shared floating menu of secondary actions. It uses the shared menu-state hook to track open/closed and position, matches the ordinary toolbar button's look with a small down-arrow added to signal that it opens a menu, and shows the menu beneath itself while open. Below the function is a comment introducing the split button described next.

**Why it is here.** The docstring explains the point of the control: it collapses a set of related verbs (for example Export DXF and Plaxis 3D under a single “Export ▾”) into one slot so the main bar stays uncluttered without losing any verb. It leans on the shared hook and shared menu so its dismiss behaviour and appearance match every other menu in the app.

.. CG-EXPLANATION-END id=function:ToolbarDropdown

``interface SplitToolbarButtonProps``
-------------------------------------

.. CG-BLOCK id=interface:SplitToolbarButtonProps lines=489-552

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 489-552
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SplitToolbarButtonProps

**What this does.** Lists the inputs for the split button — a main action welded to a little menu arrow. Alongside the familiar icon, label, onClick, disabled, title, busy, testid and iconOnly, it adds ``primary`` and ``amber`` look switches and an ``items`` list for the secondary actions under the arrow. The comment block below is the contract for the split-button function shown next.

**Why it is here.** The comments fix the behaviour precisely: disabling affects only the main action, leaving the arrow usable so the secondary items stay reachable; ``amber`` and ``primary`` are two looks, and if both are somehow set amber wins, because signalling an active mode matters more to the user than the primary-verb accent fill. The long docstring explains why this is a separate primitive rather than a reused drop-down: a drop-down has no distinct main action — it only opens a menu on click — whereas the split button promotes the most common verb to a single click and buries its variants under the arrow (for example Suggest litho as the click, Suggest all and Suggest for new tests under the arrow), which is exactly the toolbar-shrinking the #97 refactor needed.

.. CG-EXPLANATION-END id=interface:SplitToolbarButtonProps

``function SplitToolbarButton``
-------------------------------

.. CG-BLOCK id=function:SplitToolbarButton lines=553-699

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ToolbarPrimitives.tsx
   :language: tsx
   :lines: 553-699
   :lineno-match:

.. CG-EXPLANATION-START id=function:SplitToolbarButton

**What this does.** Draws the split button: a main action button on the left welded to a small arrow button on the right that shares one rounded outline. The main button runs its action directly (or shows a spinner while busy); the arrow opens the shared floating menu of secondary actions. Most of the code chooses the exact tint of each half for its three looks — amber, primary-accent, or plain — across their normal, disabled and hover states, and there is one special case: when the main action is disabled but the arrow still has usable items, the main button is repurposed as a second way to open that menu rather than looking dead.

**Why it is here.** That special case is a recorded dogfeed fix (2026-05-23): before it, a user saw the whole control as inert and gave up before hunting for the tiny arrow, so a disabled main verb that still has reachable options now becomes a clickable route into them, styled faded-but-alive. Crucially the fallback only fires when at least one menu item is actually usable — when every item shares the same gate as the main verb and is disabled together (as with the Sections correlation triad that all wait on the same condition, #141), no fallback is offered and the button is honestly, fully disabled, because leading the user to a dead menu would be worse than a plainly disabled button. The arrow always carries its own spoken name so a screen-reader user can tell the two halves apart, and its menu right-aligns so wide items do not spill off the toolbar's left edge on a narrow window.

.. CG-EXPLANATION-END id=function:SplitToolbarButton

