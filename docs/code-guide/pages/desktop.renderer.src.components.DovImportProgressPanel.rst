desktop.renderer.src.components.DovImportProgressPanel
======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/DovImportProgressPanel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/DovImportProgressPanel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the DOV import progress panel. The docstring lists what it draws: a labelled progress bar for each phase that has a known total, a pulsing bar for phases whose duration is not known, a short summary when the import finishes, an error message when it fails, and a spoken-updates region for screen readers. The imports bring in the TypeScript shapes for the import's live state and its finished-result payloads, the table of phase labels, a helper that reads any failed sub-phases out of a result, and the translator.

**Why it is here.** A DOV import runs on the engine and streams its progress back to the window over a live connection (a server-sent-events stream), so this panel exists to turn that running state into something an engineer can watch. It goes through the API stream rather than touching the engine directly — the frontend always talks through the API (CLAUDE.md).

.. CG-EXPLANATION-END id=module-header

``function isCptDone``
----------------------

.. CG-BLOCK id=function:isCptDone lines=30-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 30-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:isCptDone

**What this does.** A one-line test that reports whether a finished result is a CPT import result, based on its kind.

**Why it is here.** This is a *type guard* — a small function that both answers a yes/no and tells the type-checker "inside the yes branch, treat this result as the CPT shape" — so the code below can safely read the CPT-only fields without a cast.

.. CG-EXPLANATION-END id=function:isCptDone

``function isBoreholeDone``
---------------------------

.. CG-BLOCK id=function:isBoreholeDone lines=37-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 37-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:isBoreholeDone

**What this does.** The mirror of the previous helper: it reports whether a finished result is a borehole import result.

**Why it is here.** Same reason — it narrows the result to the borehole shape so the borehole-only fields (attached observations and samples, sub-phase failures) can be read safely.

.. CG-EXPLANATION-END id=function:isBoreholeDone

``function isIndeterminate``
----------------------------

.. CG-BLOCK id=function:isIndeterminate lines=45-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 45-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:isIndeterminate

**What this does.** Answers whether a phase's progress cannot be measured: true for the commit phase, or for any phase reporting a total of zero.

**Why it is here.** Some phases have no countable total to show a filling bar against — the commit phase's length is unknown, and a phase over an empty result has a total of zero — so those get the pulsing "working" bar instead, as the docstring notes.

.. CG-EXPLANATION-END id=function:isIndeterminate

``interface ProgressBarProps``
------------------------------

.. CG-BLOCK id=interface:ProgressBarProps lines=53-57

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 53-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProgressBarProps

**What this does.** The single input to the bar: a percentage from 0 to 100, or -1 to mean "indeterminate".

**Why it is here.** Folding "we don't know" into the same number as the percentage keeps the bar's input one simple value, with -1 as the agreed signal for the pulsing style.

.. CG-EXPLANATION-END id=interface:ProgressBarProps

``function ProgressBar``
------------------------

.. CG-BLOCK id=function:ProgressBar lines=58-83

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 58-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:ProgressBar

**What this does.** Draws the bar: a rounded track holding either a half-width pulsing stripe when indeterminate, or a filled portion whose width is the percentage, animated as it grows.

**Why it is here.** The pulsing stripe fills only half the track (per the comment) so the motion reads as "working", not "complete". The bar is marked up as a progress bar for assistive tools, reporting its value only when there is a real value to report.

.. CG-EXPLANATION-END id=function:ProgressBar

``interface DoneRowProps``
--------------------------

.. CG-BLOCK id=interface:DoneRowProps lines=84-88

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 84-88
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DoneRowProps

**What this does.** The inputs to one summary row: a label and a value (a number or text).

**Why it is here.** A tiny named shape so the finished-summary rows all take the same two inputs.

.. CG-EXPLANATION-END id=interface:DoneRowProps

``function DoneRow``
--------------------

.. CG-BLOCK id=function:DoneRow lines=89-102

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 89-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:DoneRow

**What this does.** Draws one label-and-value row of the completion summary, drawing nothing when the value is empty (but still showing a real zero).

**Why it is here.** Rows with no value are hidden to keep the summary compact, while a genuine zero (say, zero duplicates) is still worth showing, so the check distinguishes "empty" from "zero".

.. CG-EXPLANATION-END id=function:DoneRow

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=103-111

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 103-111
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The panel's one input: the import's live state, as produced by the import-stream hook.

**Why it is here.** Handing the panel the whole state object lets it decide which of the running, done, error or idle views to draw from that single value.

.. CG-EXPLANATION-END id=interface:Props

``function DovImportProgressPanel``
-----------------------------------

.. CG-BLOCK id=function:DovImportProgressPanel lines=112-256

.. literalinclude:: ../../../desktop/src/renderer/src/components/DovImportProgressPanel.tsx
   :language: tsx
   :lines: 112-256
   :lineno-match:

.. CG-EXPLANATION-START id=function:DovImportProgressPanel

**What this does.** The panel component. It looks at the state's status and draws one of four things. While running, it reads the latest phase, its label and its done/total counts, works out the percentage (or the indeterminate signal), and draws the phase label, an optional count, the bar, and a spoken progress line. When done, it reads any failed sub-phases, shows a "complete" or "finished with errors" heading, the imported/already-existed/failed counts, and — for a borehole import — the attached observations and samples plus any sub-phase failure rows and a warning line. On error it shows a failure heading and the message. When idle it draws nothing.

**Why it is here.** The running and done views announce themselves politely to screen readers so a blind user hears progress without focus jumping, while the error view announces assertively because it is an alert. The sub-phase-failure handling records a real lesson (audit 2026-08-02): a routine gap — the DOV observations service being briefly down — is recorded by the engine as a counter, not an error, so the panel must read that counter or it would show a broken import as if it were clean. The comment on the failure rows also notes why a non-retryable gap's label is shown as-is: it is already a full sentence, and appending "failed" would be wrong twice. Drawing nothing when idle leaves the caller in charge of when the panel appears.

.. CG-EXPLANATION-END id=function:DovImportProgressPanel

