desktop.renderer.src.shell.stages.parameters.sampleColor
========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/sampleColor.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/sampleColor.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/sampleColor.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the tiny module that gives one stable colour per lab sample, shared by every lab-derived panel of the per-unit Parameters stage. It imports the project's deterministic hash-to-colour helper.

**Why it is here.** Owner ask 2026-08-28: one colour identifies one sample consistently across its grain-size curve (both the sieve and hydrometer portions) and that sample's dots in the scatter panels above, while the CPT-derived plots (qc / fs / Rf) keep their own channel colours and never call this. It is keyed on the SAMPLE id — not the series index or the grain-size-test id — so a sample split into a sieve record and a hydrometer record draws both in the one colour, and both the grain-size panel and the identification panels import this single source so the two surfaces cannot drift (the house 'extract on the second copy' rule). Delegating to the existing deterministic hash keeps the colour stable across renders, reloads and machines, and — because it is a pure function of the one id — independent of how the pool is ordered or which other samples are present.

.. CG-EXPLANATION-END id=module-header

``function sampleColor``
------------------------

.. CG-BLOCK id=function:sampleColor lines=44-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/sampleColor.ts
   :language: typescript
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleColor

**What this does.** Returns the six-digit hex colour for a sample by passing its id to the shared deterministic hash-colour function.

**Why it is here.** A pure function of the one id, so the colour is stable across renders and independent of any other sample present.

.. CG-EXPLANATION-END id=function:sampleColor

