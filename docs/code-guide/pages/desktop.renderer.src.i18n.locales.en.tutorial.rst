desktop.renderer.src.i18n.locales.en.tutorial
=============================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/tutorial.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/tutorial.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/tutorial.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``TUTORIAL`` catalogue — the words for the guided tutorial: its chapter titles, the coach-card chrome (Back, Next, Skip, Finish and the progress line), and a title-and-body pair for every step of the eight chapters. It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language. The header records that the wording is a DRAFT for the owner's review, that the behaviour each step describes is taken from the real controls and never invented, and that product names (StrixGeo, DOV, Plaxis, D-Stability, DXF, NAD) stay raw tokens. It cites debt #93 and the tutorial-design spec.

.. CG-EXPLANATION-END id=module-header

``const TUTORIAL``
------------------

.. CG-BLOCK id=const:TUTORIAL lines=13-189

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/tutorial.ts
   :language: typescript
   :lines: 13-189
   :lineno-match:

.. CG-EXPLANATION-START id=const:TUTORIAL

**What this does.** The key-to-text pairs for the guided tour. It opens with the eight chapter titles (Your project, Import data, Cross-sections, Stratigraphic model, Lithological model, Geotechnical model, Parameters & statistics, Export) and the coach-card buttons, then gives each step a ``.title`` and a ``.body`` of two-to-four short sentences walking the engineer through one real control at a time — naming the project and setting the CRS and vertical datum, importing from DOV or GEF, drawing and framing a section, filling and building stratigraphy, accepting and correlating litho layers, running the packing pipeline, reading per-unit statistics, and exporting. Values with a ``{current}`` / ``{total}`` slot are filled in at display time.

**Why it is here.** The bodies describe only what the controls actually do — the segmenter reads the CPT with a Robertson classification and proposes layers to accept, the geotech classes are CPT-derived characterisation estimates and not design values, and the design numbers come later in the design tool. This keeps the tutorial honest to the platform's scope: it teaches the workflow that exists, and states plainly where characterisation ends and design begins.

.. CG-EXPLANATION-END id=const:TUTORIAL

