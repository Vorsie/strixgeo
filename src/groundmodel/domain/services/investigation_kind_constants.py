"""The investigation kinds that can anchor a litho layer.

A litho layer hangs off exactly one anchor — a CPT or a borehole (the XOR
``cpt_id`` / ``borehole_id`` pair on ``LithoLayerOrm``).  Several consumers need
to tell the two apart without re-deriving it from which foreign key is null:

* :class:`~groundmodel.domain.services.litho_body_pick.BodyLayerPick` carries the
  kind so the anchor branch that resolves coordinates does not throw it away;
* :mod:`~groundmodel.domain.services.voxel_litho.honor_precedence` ranks a cone
  above a borehole when two investigations share one voxel column.

The constants live here rather than beside either consumer because they describe
an INVESTIGATION, not a voxel rule or a pick — putting them in the voxel package
would make the repository import a 3-D-builder module to fill in a generic field.
"""

from __future__ import annotations

__all__ = ["KIND_BOREHOLE", "KIND_CPT"]

# The values stamped on a ``BodyLayerPick.kind`` by
# ``LithoLayerRepository.load_body_picks``.  Lowercase, matching the anchor
# column names (``cpt_id`` / ``borehole_id``) rather than a display label —
# these are domain tokens, translated at the presentation boundary if ever shown.
KIND_CPT: str = "cpt"
KIND_BOREHOLE: str = "borehole"
