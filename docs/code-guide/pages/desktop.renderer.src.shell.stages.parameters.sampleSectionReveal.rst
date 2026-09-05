desktop.renderer.src.shell.stages.parameters.sampleSectionReveal
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/sampleSectionReveal.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/sampleSectionReveal.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/sampleSectionReveal.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's documentation. It explains that this module answers two questions for the "go to this lab sample on a cross-section" feature: which cross-section a sample's borehole should be revealed on, and what to say when the borehole is on no section at all.

**Why it is here.** Owner ask (2026-08-28): let a right-click on a grain-size (PSD) curve jump to that sample's borehole on the Sections stage. Two decisions are kept pure here rather than guessed live. First, WHICH section: the module never re-derives section membership — it reads the same map the caller already built with the canonical rule (in the corridor and between the endpoints, exclusions honoured), and when several sections carry the hole it picks the first in that map's order, so the answer is stable rather than "whichever happened to come first". Second, ON NO SECTION: an honest sentence naming the sample and saying what to do, mirroring the pending-tie chip, rather than failing silently. The navigation itself reuses the existing deep-link machinery; this module only decides the target and the fallback words.

.. CG-EXPLANATION-END id=module-header

``interface SampleIdentity``
----------------------------

.. CG-BLOCK id=interface:SampleIdentity lines=32-64

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/sampleSectionReveal.ts
   :language: typescript
   :lines: 32-64
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleIdentity

**What this does.** Declares the handful of sample fields the "on no section" sentence needs to name a sample: the borehole name, the sample number (or nothing when the lab recorded none), and the sample interval's top and base depths below the collar. The documentation below it describes the section-picking function that follows. An interface names the shape of an object.

**Why it is here.** These are exactly the fields that let the engineer recognise which sample the message is about — the hole, the number, the depth — so the sentence can identify it without carrying the whole sample record.

.. CG-EXPLANATION-END id=interface:SampleIdentity

``function pickSectionForInvestigation``
----------------------------------------

.. CG-BLOCK id=function:pickSectionForInvestigation lines=65-75

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/sampleSectionReveal.ts
   :language: typescript
   :lines: 65-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:pickSectionForInvestigation

**What this does.** Given the caller's per-section member map and an investigation id (a borehole or CPT), it returns the first section whose member set contains that investigation, or nothing when none does.

**Why it is here.** It reads the caller's canonical membership map rather than deriving membership a second time, so its answer cannot drift from what the section view actually draws. "First in the map" is deterministic because the map is in the sections' own list order, so the same sample always opens the same section.

.. CG-EXPLANATION-END id=function:pickSectionForInvestigation

``function sampleClause``
-------------------------

.. CG-BLOCK id=function:sampleClause lines=76-96

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/sampleSectionReveal.ts
   :language: typescript
   :lines: 76-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleClause

**What this does.** A tiny helper that produces the phrase for a sample — "sample 3" when the lab numbered it, or "this sample" when it did not. The documentation below it describes the message function that follows.

**Why it is here.** It keeps the numbered-versus-unnumbered wording in one place so the sentence reads naturally whether or not a sample number exists.

.. CG-EXPLANATION-END id=function:sampleClause

``function sampleNotOnAnySectionMessage``
-----------------------------------------

.. CG-BLOCK id=function:sampleNotOnAnySectionMessage lines=97-105

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/sampleSectionReveal.ts
   :language: typescript
   :lines: 97-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleNotOnAnySectionMessage

**What this does.** Builds the one-sentence message shown when a sample's borehole is on no cross-section. It names the sample (borehole, number, depth range), states that its borehole projects onto none of the project's section lines, and tells the engineer what to do — draw a section through the hole, or widen a section's corridor to reach it. The result is plain English, ready to hand to a toast (a small temporary on-screen message).

**Why it is here.** The message ends on an action, not a diagnosis — the same shape the pending-tie chip uses — so the engineer is never left with a dead end. Naming the sample lets him recognise which one he right-clicked.

.. CG-EXPLANATION-END id=function:sampleNotOnAnySectionMessage

