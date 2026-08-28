"""How an exported DXF layer carries its colour and its line weight.

Owner dogfeed 2026-08-28, verbatim: *"the dxf looks good, only the white
bounding lines are a bit thick"*. Both causes were read off his own exported
fence file, and both live in the layer table rather than in the geometry:

* **The white outline.** Every layer carried the true colour (``layer.rgb``)
  but left the INDEX colour at its default, ``aci = 7`` — white/black. A
  3DFACE's visible edges are drawn from the index colour in most CAD
  renderers even when the face itself is shaded from the true colour, so an
  ochre sand panel was outlined in white. Setting an index colour that
  approximates the true colour makes the outline read as a darker edge of
  the same material.
* **The heavy outline.** Every layer carried ``lineweight = -3``
  (``LWDEFAULT``) — whatever the drawing default happens to be, commonly
  0.25 mm. On a fence panel the information is the fill; the outline only
  has to separate neighbours.

Shared by the fence and section exporters so the two cannot drift on
something a CAD user sees immediately.

NOTE for a later cleanup: ``_parse_hex_color`` is still duplicated between
``dxf_fence_exporter`` and ``dxf_section_exporter``. It belongs here too, but
moving it is a wider change than the defect above and is left deliberately
untouched.
"""

from __future__ import annotations

from ezdxf.colors import DXF_DEFAULT_COLORS, RGB, int2rgb
from ezdxf.entities.layer import Layer

# The colour a caller may hand us: ezdxf's ``RGB`` named tuple, or the plain
# 3-tuple the exporters' own default constants are written as. Both are read
# by index, so widening the parameter is honest rather than a cast.
RgbLike = RGB | tuple[int, int, int]

# Line weight for an exported layer, in 1/100 mm (the DXF unit).
#
# 0.09 mm is the thinnest weight that still plots reliably on paper: 0 means
# "thinnest the device can draw" and disappears on some plotters, while the
# 0.25 mm default the owner saw reads as a drawn line in its own right rather
# than the edge of a filled panel. It must stay one of the weights the DXF
# spec enumerates or CAD silently rounds it to a neighbour.
THIN_LAYER_LINEWEIGHT = 9

# The ACI indices a layer may actually carry. 0 is ByBlock and 256 is ByLayer
# — both are references, not colours, and either would make a layer's own
# colour meaningless. 255 is the last real palette entry.
_FIRST_REAL_ACI = 1
_LAST_REAL_ACI = 255


def nearest_aci(rgb: RgbLike) -> int:
    """The palette index whose colour is closest to ``rgb``.

    Squared Euclidean distance in RGB. It is not perceptually uniform — a
    proper match would work in CIELAB — but the palette is coarse and the
    result only has to be recognisably the same material, not a colour-managed
    reproduction. Being wrong by one palette step is invisible on a panel
    edge; being white (the bug this replaces) is not.

    Parameters
    ----------
    rgb
        The layer's true colour.

    Returns
    -------
    int
        An index in ``[1, 255]`` — never ``0`` (ByBlock) or ``256``
        (ByLayer).
    """
    target = (int(rgb[0]), int(rgb[1]), int(rgb[2]))
    best_index = _FIRST_REAL_ACI
    best_distance = None
    for index in range(_FIRST_REAL_ACI, _LAST_REAL_ACI + 1):
        r, g, b = int2rgb(DXF_DEFAULT_COLORS[index])
        distance = (r - target[0]) ** 2 + (g - target[1]) ** 2 + (b - target[2]) ** 2
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_index = index
    return best_index


def style_layer(layer: Layer, rgb: RgbLike) -> None:
    """Give a layer its true colour, a matching index colour and a thin weight.

    One call so the fence and section exporters cannot style layers
    differently — a CAD user opening either file should see the same
    conventions.

    Parameters
    ----------
    layer
        The ``ezdxf`` layer table entry to style.
    rgb
        The material colour the layer represents.
    """
    layer.rgb = rgb
    # The index colour drives the EDGES in most renderers; without it they
    # default to white (aci 7) whatever the true colour says.
    layer.color = nearest_aci(rgb)
    layer.dxf.lineweight = THIN_LAYER_LINEWEIGHT
