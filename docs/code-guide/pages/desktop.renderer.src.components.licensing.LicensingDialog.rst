desktop.renderer.src.components.licensing.LicensingDialog
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/licensing/LicensingDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/licensing/LicensingDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment and the imports for the licensing / activation screen. This screen shows the computer's current licence state and drives the mock activation flow: type in a key and Activate, Start a free trial, or Deactivate / transfer this device. It imports the Modal and Button building blocks, a ConfirmDialog, the translator hook, and the shapes describing an activation status and an action result. (An Electron app runs as two programs: the main process, which has full access to files and other programs, and the renderer — the sandboxed web page the user sees. This file is renderer code; it asks the main process to do things over a fixed safe list of calls named ``window.electron.*``.)

**Why it is here.** The comment records the design and cites docs/design/onboarding-activation-updater-proto.md. Everything behind the buttons is the main-process activation service running a mock issuer with no network and no cryptography, and it honours the owner rulings: a 30-day offline grace, one device per Solo seat (which is why a deactivate/transfer flow has to exist), and a trial that travels the exact same path as a paid licence. It is labelled a prototype for debt #3.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=31-48

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 31-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Describes the inputs this dialog is handed. (In React — the library that builds the interface out of small reusable pieces called components — props are the inputs one component is given by the component that uses it.) The inputs are: whether the dialog is open, a close handler, an optional ``dismissable`` flag, and an optional ``onStatusChange`` callback.

**Why it is here.** The field docstrings carry the reasons. Passing ``dismissable`` as false makes the dialog a non-dismissable start screen (owner ruling A) — the close X is hidden and pressing Esc or clicking the backdrop do nothing — so a packaged build whose licence is blocked cannot simply be clicked past into the workspace. ``onStatusChange`` fires whenever the status is read or an action changes it, which is how the packaged start-screen gate unlocks itself the moment the verdict is no longer blocked.

.. CG-EXPLANATION-END id=interface:Props

``const STATE_LABEL_KEY``
-------------------------

.. CG-BLOCK id=const:STATE_LABEL_KEY lines=49-59

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 49-59
   :lineno-match:

.. CG-EXPLANATION-START id=const:STATE_LABEL_KEY

**What this does.** A table pairing each licence state — ``unactivated``, ``trial``, ``active``, ``grace``, ``expired``, ``clock-rollback``, ``device-mismatch`` — with the catalogue key for its on-screen label.

**Why it is here.** So the screen shows a translated, human word for each state instead of the raw internal name; routing every label through a catalogue key keeps it translatable at the presentation boundary like the rest of the interface (docs/ux.md §Translation & persistence).

.. CG-EXPLANATION-END id=const:STATE_LABEL_KEY

``const ERROR_KEY``
-------------------

.. CG-BLOCK id=const:ERROR_KEY lines=60-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 60-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:ERROR_KEY

**What this does.** A table pairing each possible activation-failure code — unknown key, device limit reached, already trialled, server unreachable — with the catalogue key for its message.

**Why it is here.** For the same reason as the state labels: a failure code from the activation service is turned into a translated, human sentence rather than shown to the user as a raw internal code.

.. CG-EXPLANATION-END id=const:ERROR_KEY

``const STATE_PILL``
--------------------

.. CG-BLOCK id=const:STATE_PILL lines=68-78

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 68-78
   :lineno-match:

.. CG-EXPLANATION-START id=const:STATE_PILL

**What this does.** A table pairing each state with the colour classes for its small status "pill": green for a live licence, amber for grace, red for a problem, and muted grey for none.

**Why it is here.** The comment records the meaning of the colours — green live, amber grace, red trouble, muted none — so the colour reinforces the state word rather than being decoration, letting a reader tell a healthy licence from one that needs attention at a glance.

.. CG-EXPLANATION-END id=const:STATE_PILL

``const PREVIEW_STATES``
------------------------

.. CG-BLOCK id=const:PREVIEW_STATES lines=79-89

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 79-89
   :lineno-match:

.. CG-EXPLANATION-START id=const:PREVIEW_STATES

**What this does.** The list of states the prototype "preview" control can force on screen. The comment block below leads into the date helper.

**Why it is here.** The module header explains this is a prototype-only aid so the owner can see each screen — trial, active, grace, expired, clock problem, not activated — without having to wait out a real clock to reach that state naturally.

.. CG-EXPLANATION-END id=const:PREVIEW_STATES

``function formatDate``
-----------------------

.. CG-BLOCK id=function:formatDate lines=90-95

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 90-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatDate

**What this does.** A tiny helper that turns a moment in time (counted in milliseconds) into a local calendar date, or an em dash "—" when there is no date at all. The comment block below leads into the status panel.

**Why it is here.** Dates in the code are stored as a plain millisecond count; showing the user "—" for an absent date, rather than a blank or a raw number, keeps the status panel readable.

.. CG-EXPLANATION-END id=function:formatDate

``function StatusPanel``
------------------------

.. CG-BLOCK id=function:StatusPanel lines=96-138

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 96-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:StatusPanel

**What this does.** A small component (a reusable piece of interface, written as a function that returns what to draw) that renders the status box from a verdict: a heading, the coloured state pill, the tier, the expiry date, and a day-count line — "N days remaining", or grace-days when in grace. The comment block below is the manual for the main dialog.

**Why it is here.** Splitting the read-only status display into its own piece keeps the big dialog below focused on the actions. The day-count line only appears when there is a positive count to show, so an expired or unactivated state shows no misleading "0 days remaining".

.. CG-EXPLANATION-END id=function:StatusPanel

``function LicensingDialog``
----------------------------

.. CG-BLOCK id=function:LicensingDialog lines=139-404

.. literalinclude:: ../../../desktop/src/renderer/src/components/licensing/LicensingDialog.tsx
   :language: tsx
   :lines: 139-404
   :lineno-match:

.. CG-EXPLANATION-START id=function:LicensingDialog

**What this does.** The dialog itself, and the largest piece here. At the top it sets up the values it remembers between redraws (in React these are state): the current status, the typed-in key, whether an action is running, any error or success message, and whether the deactivate confirmation is open. An effect (code that runs after a draw) reads the status fresh each time the dialog opens, and a second effect reports every status change out through ``onStatusChange``. It offers three actions — Activate with a key, Start free trial, and Deactivate — each run through one shared ``runAction`` helper that flips a "busy" flag, calls the main process, and then shows either the new status or a translated error. The screen is drawn as a Modal (a dialog that sits over everything and must be answered) with a header whose close X appears only when dismissable, the status panel, inline error and success banners, the key box with its Activate button, the trial and deactivate buttons, a device row, and — in development builds only — the row of preview buttons. Deactivate does not fire directly; it opens a separate ConfirmDialog first.

**Why it is here.** The comments carry the load-bearing reasons. Deactivate is irreversible — it frees the seat on the server — so it routes through a confirmation with Cancel default-focused and the action button named "Deactivate", per docs/ux.md "Reversible vs irreversible". The non-dismissable path makes Esc and the backdrop do nothing, so a blocked packaged build cannot be dismissed without activating. The preview row is withheld whenever the build is packaged — the row is hidden AND the main process withholds the backing call — so the prototype aid can never reach a shipped build. The inline error and success banners are built into the dialog on purpose so it works in both the welcome screen and the loaded-project screen, where the pop-up message host differs.

.. CG-EXPLANATION-END id=function:LicensingDialog

