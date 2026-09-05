groundmodel.infrastructure.exporters.fence_panel_source
=======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/fence_panel_source.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/fence_panel_source.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/fence_panel_source.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description and its imports: ``Sequence``, ``Protocol`` and ``runtime_checkable``, plus an ``__all__`` naming the one public type. A *Protocol* is a structural interface — it says ``anything with these fields fits`` without the fitting types having to inherit from it.

**Why it is here.** The fence exporter needs a certain shape from a wall panel, but it is INFRASTRUCTURE and must not import the API request schema that happens to carry those fields today — an ``infrastructure -> api.schemas`` import would invert the one-way dependency arrow the whole codebase keeps (API -> Application -> Domain <- Infrastructure; see start-here). A Protocol states the requirement structurally and costs nothing: any object with the right fields satisfies it, with no adapter.

.. CG-EXPLANATION-END id=module-header

Class ``FencePanelSource`` — header
-----------------------------------

.. CG-BLOCK id=class:FencePanelSource lines=29-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/fence_panel_source.py
   :language: python
   :lines: 29-38
   :lineno-match:

.. CG-EXPLANATION-START id=class:FencePanelSource

**What this does.** Declares the structural interface for one triangulated vertical wall of the 3-D fence diagram, as a set of read-only properties.

**Why it is here.** Read-only properties rather than plain attributes so a caller may hand in a ``list`` where a ``Sequence`` is asked for — a mutable attribute would demand the exact container type declared here.

.. CG-EXPLANATION-END id=class:FencePanelSource

Method ``FencePanelSource``. ``def formation_id``
-------------------------------------------------

.. CG-BLOCK id=method:FencePanelSource.formation_id lines=39-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/fence_panel_source.py
   :language: python
   :lines: 39-43
   :lineno-match:

.. CG-EXPLANATION-START id=method:FencePanelSource.formation_id

**What this does.** The lithostratigraphic formation this wall belongs to.

**Why it is here.** It is the panel's stable identity handle: the export route uses it to look up the wall's NAD class and soil code (which the panel itself does not carry) so the layer can be named by the machine identifier.

.. CG-EXPLANATION-END id=method:FencePanelSource.formation_id

Method ``FencePanelSource``. ``def body_id``
--------------------------------------------

.. CG-BLOCK id=method:FencePanelSource.body_id lines=44-48

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/fence_panel_source.py
   :language: python
   :lines: 44-48
   :lineno-match:

.. CG-EXPLANATION-START id=method:FencePanelSource.body_id

**What this does.** The resolver-assigned body identity, or ``None`` when the wall is untied to any body.

**Why it is here.** It is part of the panel's full declared shape, but the fence DXF exporter does not read it — it names layers from ``formation_id``. Why: not recorded — ask the owner.

.. CG-EXPLANATION-END id=method:FencePanelSource.body_id

Method ``FencePanelSource``. ``def name``
-----------------------------------------

.. CG-BLOCK id=method:FencePanelSource.name lines=49-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/fence_panel_source.py
   :language: python
   :lines: 49-53
   :lineno-match:

.. CG-EXPLANATION-START id=method:FencePanelSource.name

**What this does.** The display label, already resolved; it becomes the DXF layer name on the fallback path (when no machine identifier could be resolved for the unit).

**Why it is here.** It is resolved at the presentation boundary (a translated lithology label), so the server uses what the renderer produced rather than re-deriving a name that might disagree with the screen.

.. CG-EXPLANATION-END id=method:FencePanelSource.name

Method ``FencePanelSource``. ``def color``
------------------------------------------

.. CG-BLOCK id=method:FencePanelSource.color lines=54-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/fence_panel_source.py
   :language: python
   :lines: 54-62
   :lineno-match:

.. CG-EXPLANATION-START id=method:FencePanelSource.color

**What this does.** The hex layer colour, resolved at the presentation boundary.

**Why it is here.** NAD packing colours override the inherited lithology colour and are never stored, so the server must not re-derive this — the renderer-computed colour is the only correct one (docs/exports.md, the fence DXF exporter).

.. CG-EXPLANATION-END id=method:FencePanelSource.color

Method ``FencePanelSource``. ``def vertices``
---------------------------------------------

.. CG-BLOCK id=method:FencePanelSource.vertices lines=63-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/fence_panel_source.py
   :language: python
   :lines: 63-67
   :lineno-match:

.. CG-EXPLANATION-START id=method:FencePanelSource.vertices

**What this does.** The wall's corner points, each an ``(x, y, elevation)`` triple in metres.

**Why it is here.** The coordinates are PROJECTED project-CRS metres (Lambert 72 for Belgium, RD New for the Netherlands), never longitude/latitude — the same space the renderer builds the walls in and the space the DXF is written in, so no reprojection ever happens.

.. CG-EXPLANATION-END id=method:FencePanelSource.vertices

Method ``FencePanelSource``. ``def triangles``
----------------------------------------------

.. CG-BLOCK id=method:FencePanelSource.triangles lines=68-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/fence_panel_source.py
   :language: python
   :lines: 68-71
   :lineno-match:

.. CG-EXPLANATION-START id=method:FencePanelSource.triangles

**What this does.** The wall's triangle faces, each a triple of index numbers pointing into ``vertices``.

**Why it is here.** The wall arrives already cut into triangles by the renderer (the server has no twin able to rebuild it), and the exporter writes one DXF face per triangle.

.. CG-EXPLANATION-END id=method:FencePanelSource.triangles

