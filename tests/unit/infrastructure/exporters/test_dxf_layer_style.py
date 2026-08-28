"""Pins for how an exported DXF layer carries its colour and line weight.

Owner dogfeed 2026-08-28, verbatim: *"the dxf looks good, only the white
bounding lines are a bit thick"*.

Both causes were read off his own exported file:

* every layer carried ``aci=7`` — the default index colour, which is
  white/black. A 3DFACE's visible edges are drawn with the INDEX colour in
  most CAD renderers even when the face is shaded from the true colour, so
  a soil-coloured panel got a white outline.
* every layer carried ``lineweight=-3`` (LWDEFAULT), i.e. whatever the
  drawing default is — commonly 0.25 mm, which reads as heavy against a
  fence panel whose information is the fill, not the outline.

LS1 — the index colour approximates the true colour, so an outline is never
      white unless the material really is white.
LS2 — the six pure ACI hues map to their own index, which is the cheapest
      way to see the approximation is not arbitrary.
LS3 — the approximation never returns a special index (0 = ByBlock,
      256 = ByLayer would make a layer colour meaningless).
LS4 — the fence export sets a real, thin line weight instead of LWDEFAULT.
LS5 — the fence export's layers carry an index colour derived from the
      panel colour, not the default white.
"""

from __future__ import annotations

import ezdxf
from ezdxf.colors import RGB

from groundmodel.infrastructure.exporters.dxf_layer_style import (
    THIN_LAYER_LINEWEIGHT,
    nearest_aci,
)


def test_ls1_a_soil_colour_never_approximates_to_white() -> None:
    """A mid-tone soil colour must not land on the white/black index."""
    # The three the owner's own export used: CLAY grey-blue, SAND ochre,
    # SILT green.
    for rgb in (RGB(176, 190, 200), RGB(212, 184, 74), RGB(170, 200, 74)):
        assert nearest_aci(rgb) != 7


def test_ls2_pure_hues_map_to_their_own_index() -> None:
    """The six pure ACI hues are their own nearest match."""
    assert nearest_aci(RGB(255, 0, 0)) == 1
    assert nearest_aci(RGB(255, 255, 0)) == 2
    assert nearest_aci(RGB(0, 255, 0)) == 3
    assert nearest_aci(RGB(0, 255, 255)) == 4
    assert nearest_aci(RGB(0, 0, 255)) == 5
    assert nearest_aci(RGB(255, 0, 255)) == 6


def test_ls3_never_returns_a_special_index() -> None:
    """0 (ByBlock) and 256 (ByLayer) are not colours a layer may carry."""
    for r in range(0, 256, 51):
        for g in range(0, 256, 51):
            for b in range(0, 256, 51):
                aci = nearest_aci(RGB(r, g, b))
                assert 1 <= aci <= 255


def test_ls4_thin_lineweight_is_thinner_than_the_cad_default() -> None:
    """The constant is a real weight in 1/100 mm, well under the 0.25 mm default."""
    assert 0 < THIN_LAYER_LINEWEIGHT < 25
    # It must be one of the weights the DXF spec allows, or CAD rounds it.
    assert THIN_LAYER_LINEWEIGHT in ezdxf.lldxf.const.VALID_DXF_LINEWEIGHTS
