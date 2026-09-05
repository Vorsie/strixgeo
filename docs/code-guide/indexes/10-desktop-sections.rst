10. Desktop — the Sections stage (the editing surface)
======================================================

.. CG-EXPLANATION-START id=intro

The Sections stage is the heart of StrixGeo: the cross-section is the surface on
which the engineer edits and views all three model levels (geological,
lithostratigraphic, geotechnical). This is the largest desktop group because it
carries both the on-screen editor (``components/sections/`` and
``shell/stages/sections/``) and the geometry engine behind it.

That engine is the **partition fill** — ``utils/partitionFillV2/`` turns the
contacts and correlation lines the engineer draws into the coloured bands,
wedges and lenses that fill the section — together with the **geotech
hierarchical fill** (``utils/geotechHierarchicalFill/``) that refines those
bands into NAD packing-class units, and the section-partition and golden-master
helpers that keep the result stable. These are pure TypeScript, tested against
frozen reference sections, and mirror the same 2/1/0 contact-correlation model
described in the backend's fill design note.

.. CG-EXPLANATION-END id=intro

.. toctree::
   :maxdepth: 1


