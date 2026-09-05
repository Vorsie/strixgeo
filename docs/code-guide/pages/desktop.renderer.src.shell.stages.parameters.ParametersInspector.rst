desktop.renderer.src.shell.stages.parameters.ParametersInspector
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/ParametersInspector.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/ParametersInspector.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersInspector.tsx
   :language: tsx
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the Parameters stage inspector file — the right-hand panel — and imports React's hooks, the icons, the API client and its response types, numeric-input helpers, the litho-segmenter preference reader, the logger, the empty and loading states, the shell context, the translators, the message-key type, the depth-panels component and the unit list pane.

**Why it is here.** The docstring records two owner rulings. On the per-test tab (dogfeed 2026-08-03) this empty pane BECAME the per-CPT plot surface: clicking a row selects the CPT and the pane shows a header, the water-table line and the tall depth-synced panels. On the per-unit tab (ruling R3, 2026-08-27) it is the UNIT LIST instead, because the statistics moved to the canvas. It owns two things nothing else does: the behaviour-type profile fetch, done on demand at selection (never eagerly for every CPT — a 250-CPT project would fetch 250 profiles nobody asked for) and under the same unit weights the litho segmenter uses so the strip and the ghost boundaries share one effective-stress profile; and the water-table edit, which re-normalises everything above it and so must say where its value came from, save as a real engine patch, and mark the project unsaved.

.. CG-EXPLANATION-END id=module-header

``const GWT_PROVENANCE_LABEL_KEY``
----------------------------------

.. CG-BLOCK id=const:GWT_PROVENANCE_LABEL_KEY lines=48-65

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersInspector.tsx
   :language: tsx
   :lines: 48-65
   :lineno-match:

.. CG-EXPLANATION-START id=const:GWT_PROVENANCE_LABEL_KEY

**What this does.** A small lookup from a water-table provenance value (recorded, engineer, assumed) to the translation key that names it.

**Why it is here.** The water-table line must say where its number came from, and this table maps each provenance to a catalogue key so the wording is resolved in the active language at render time rather than hard-coded.

.. CG-EXPLANATION-END id=const:GWT_PROVENANCE_LABEL_KEY

``function ParametersInspector``
--------------------------------

.. CG-BLOCK id=function:ParametersInspector lines=66-305

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersInspector.tsx
   :language: tsx
   :lines: 66-305
   :lineno-match:

.. CG-EXPLANATION-START id=function:ParametersInspector

**What this does.** The inspector component. It reads the project, CPT list, plot cache, selection and toast sink from the shell; holds the fetched profile, an own-fetched plot fallback, loading and error flags, a refetch nonce, and the inline water-table draft. One effect fetches the behaviour-type profile for the selected CPT (and the plot too, if nothing else fetched it), guarded against races; another clears the draft when the selection changes; and a callback commits or clears the water table. After all hooks, it early-returns the unit list on the per-unit tab, an empty state when nothing is selected, else the header, the water-table line and the depth panels (or an error with a Retry, or a loading state).

**Why it is here.** All hooks run before any early return, so React's hook order stays fixed no matter which branch renders — the standard rule. The profile fetch re-checks the shared plot cache before spending a second request and only fetches the plot itself when the concurrent shared load failed and swallowed its failure — otherwise the pane could sit on "Loading depth series…" forever. Committing a water table saves it as an engine patch, marks the project unsaved (a decision that only lived in the database would be silently dropped on the next file open, since opening restores the database from the file), and bumps the nonce to re-derive the profile because the whole normalisation hangs off that number. The server bounds the depth and its error message is surfaced verbatim so an absurd value explains itself.

.. CG-EXPLANATION-END id=function:ParametersInspector

``function WaterTableLine``
---------------------------

.. CG-BLOCK id=function:WaterTableLine lines=306-396

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersInspector.tsx
   :language: tsx
   :lines: 306-396
   :lineno-match:

.. CG-EXPLANATION-START id=function:WaterTableLine

**What this does.** The sub-component drawing the single water-table line: a droplet icon and label, then either an inline text input while editing (Enter commits, Escape and blur cancel), a dash when there is no profile yet, or the value as a dotted-underline button with its provenance text and — only for an engineer-set value — a clear button.

**Why it is here.** It reads the value from the PROFILE, not the CPT detail row, so the label and the maths can never disagree — they come from the same response. Blur CANCELS rather than commits, because clicking away with a half-typed depth must not silently re-normalise the whole profile; Enter is the deliberate commit gesture and the hint says so. The clear button appears only when the engineer set the value, since that is the only case there is an override to undo.

.. CG-EXPLANATION-END id=function:WaterTableLine

