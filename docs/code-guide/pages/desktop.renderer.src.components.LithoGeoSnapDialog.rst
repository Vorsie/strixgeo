desktop.renderer.src.components.LithoGeoSnapDialog
==================================================

.. CG-PAGE source=desktop/src/renderer/src/components/LithoGeoSnapDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/LithoGeoSnapDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/LithoGeoSnapDialog.tsx
   :language: tsx
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the litho-to-geological snap prompt (debt #134). The comment explains it opens when a litho-contact drag lands close to one or more geological contacts at the same investigation, and offers three choices: snap the litho contact to the geological one (cheap, no cascade, default focus), move the geological contact to the litho depth (heavy — triggers a surface rebuild and re-sync), or cancel and leave both at the raw drag depths. It imports ``useEffect``, ``useRef`` and ``useState``, the contact type, the translator, and the shared ``Button`` and ``Modal``.

**Why it is here.** The comment records the owner directive that the cheap, safe snap holds default focus so an accidental Enter takes the lightweight path — the reversible side of the reversible-versus-irreversible rule from the ``CptRefreshConfirmDialog`` page. The candidate list arrives pre-sorted (nearer first, deeper on a tie) so the nearest is the default choice, which the code trusts rather than re-sorting.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=25-47

.. literalinclude:: ../../../desktop/src/renderer/src/components/LithoGeoSnapDialog.tsx
   :language: tsx
   :lines: 25-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, the nearby geological candidates (pre-sorted), the raw litho drag depth, a snap-to-geo callback, a move-geo-to-litho callback, a cancel callback, and a busy flag.

**Why it is here.** The two action callbacks map onto the two directions of the snap, and their doc comments record the cost difference — one is a single lightweight change to the litho row, the other cascades a surface rebuild — which is exactly why the cheap one is the default and the busy flag disables everything while a cascade is in flight.

.. CG-EXPLANATION-END id=interface:Props

``function LithoGeoSnapDialog``
-------------------------------

.. CG-BLOCK id=function:LithoGeoSnapDialog lines=48-182

.. literalinclude:: ../../../desktop/src/renderer/src/components/LithoGeoSnapDialog.tsx
   :language: tsx
   :lines: 48-182
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoGeoSnapDialog

**What this does.** The dialog component. It remembers which candidate is selected (defaulting to the first), re-seeds it on open, and focuses the Snap button. It draws nothing when closed or with no candidates, and otherwise a ``Modal`` showing the drag depth, either a radio list of candidates (with their depths and distances) when there are two or more or a single depth readout, and three buttons: keep-separate (Cancel), move-geo-to-litho, and the default-focused snap-litho-to-geo.

**Why it is here.** Defaulting the selection and the focus to the cheap snap means the safer outcome is one keystroke away, per the owner directive. Cancel leaves both contacts at their raw depths, so the reflex dismissal changes nothing — the reversible-versus-irreversible rule applied to a drag.

.. CG-EXPLANATION-END id=function:LithoGeoSnapDialog

