groundmodel.infrastructure.exporters.dxf_layer_style
====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dxf_layer_style.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dxf_layer_style.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-59

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_layer_style.py
   :language: python
   :lines: 1-59
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description of two CAD-visible defects the owner reported, a deferred (type-checking-only) import of ezdxf's colour types, and the styling constants: ``THIN_LAYER_LINEWEIGHT`` (the thin line weight to give an exported layer, in hundredths of a millimetre) and the first and last usable palette-index values.

**Why it is here.** Both defects lived in the layer table, not the geometry. A DXF layer can carry both a true 24-bit colour and a classic *ACI* index colour (ACI = AutoCAD Color Index, the old 256-entry palette); most CAD renderers draw a filled face's EDGES from the index colour, which defaults to white, so an ochre sand panel was outlined in white. And every layer used the drawing's default (heavy) line weight. The value ``9`` (0.09 mm) is the thinnest weight that still plots reliably on paper. ezdxf is imported lazily (only inside the function that needs it) so pulling this styling helper in at API boot does not pay ezdxf's load cost (docs/exports.md: the heavy libraries are imported on first use to keep the boot fast).

.. CG-EXPLANATION-END id=module-header

Function ``def nearest_aci``
----------------------------

.. CG-BLOCK id=function:nearest_aci lines=60-94

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_layer_style.py
   :language: python
   :lines: 60-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearest_aci

**What this does.** Given a true colour, returns the palette index between 1 and 255 whose colour is closest, measured as squared distance in red/green/blue. It loads ezdxf's palette on first use.

**Why it is here.** The index colour drives a filled face's edges, so it has to approximate the true colour or the edge reads white. Squared RGB distance is not perceptually perfect — a proper match would work in a colour space like CIELAB — but the palette is coarse and the edge only has to read as the same material; being one step off is invisible, being white was the bug. It never returns 0 or 256, which are references rather than real colours.

.. CG-EXPLANATION-END id=function:nearest_aci

Function ``def style_layer``
----------------------------

.. CG-BLOCK id=function:style_layer lines=95-113

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_layer_style.py
   :language: python
   :lines: 95-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:style_layer

**What this does.** In one call, gives a layer its true colour, a matching index colour (via ``nearest_aci``), and the thin line weight.

**Why it is here.** One call so the fence exporter and the section exporter cannot style their layers differently — a CAD user opening either file should meet the same conventions.

.. CG-EXPLANATION-END id=function:style_layer

