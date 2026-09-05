desktop.renderer.src.api.clients.geotechBands
=============================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/geotechBands.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/geotechBands.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geotechBands.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the geotech packing-band hand-edit client — the preview and commit calls for splitting a band, merging bands, moving a boundary, restating a contact, setting a band's class by hand, and choosing the representative-qc statistic. It imports the shared POST helper and the response types from the geology types file.

**Why it is here.** The comment explains it is a separate file rather than four more methods on the already-oversized geology client (debt #201), but its calls are spread back into ``api.geology.*`` so callers keep one path. Two rules are load-bearing: every path here takes the geotechnical model id (the router refuses any other model kind with a 422), the opposite of the subdivide/divide calls that take the litho parent; and the preview calls write nothing — they exist so the consequence of an edit (which way the representative qc moves, what class results) can be shown before it is committed, and what comes back is advisory, never a veto (owner rulings). Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page.

.. CG-EXPLANATION-END id=module-header

``const geotechBandsClient``
----------------------------

.. CG-BLOCK id=const:geotechBandsClient lines=26-216

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geotechBands.ts
   :language: typescript
   :lines: 26-216
   :lineno-match:

.. CG-EXPLANATION-START id=const:geotechBandsClient

**What this does.** The object of typed calls for editing packing bands: set a borehole band's NAD class by hand; preview and then commit a split, a merge (of two bands or a whole run), a boundary move, and a restated-contact move; and set the model's representative-qc statistic. The preview calls return both resulting intervals with their re-derived class and the advisory consequences; the commit calls apply the change in one transaction and re-derive the affected bands.

**Why it is here.** Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page. The docstrings carry the domain rules: a borehole band's class is donor-extrapolated so the engineer's judgement may override it, but the server still refuses a CPT band or an out-of-family class with a 422; the litho hierarchy is never overruled, so a split depth or a boundary outside the band's own litho body 422s (a boundary between two litho parents is a contact, not a packing boundary); a merge re-derives the class over the whole union so it can differ from both inputs; accepted correlation ties are flagged for review rather than silently cascaded away (flag-not-drop); and setting the statistic writes one column and only marks the bands stale rather than re-deriving them. These are characterisation outputs — a NAD packing class — not design-ready parameters.

.. CG-EXPLANATION-END id=const:geotechBandsClient

