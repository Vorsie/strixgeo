"""Value object: the ``GeologicalModel.kind`` discriminator + its
creation-ordering invariant.

The three-level modelling hierarchy (CLAUDE.md "Modelling hierarchy",
``memory/project_litho_geotech_three_level_model.md``) is realised as
sibling ``GeologicalModel`` rows discriminated by ``kind`` rather than
a schema fork — the whole contact → build → TIN → section → export →
bundle pipeline is reused at every level.

Type aliases + constant mappings, not classes — the single source of
truth shared by the API schema layer, the repository, and the crossing
validator. It lives in ``shared/constants/`` (the explicitly
cross-layer-permitted home) so the API layer can reference it without
importing from the domain layer (debt #54, layer purity).
"""

from __future__ import annotations

from typing import Literal

ModelKind = Literal["geological", "lithostratigraphic", "geotechnical"]

MODEL_KIND_GEOLOGICAL: ModelKind = "geological"
MODEL_KIND_LITHOSTRATIGRAPHIC: ModelKind = "lithostratigraphic"
MODEL_KIND_GEOTECHNICAL: ModelKind = "geotechnical"

MODEL_KINDS: tuple[ModelKind, ...] = (
    MODEL_KIND_GEOLOGICAL,
    MODEL_KIND_LITHOSTRATIGRAPHIC,
    MODEL_KIND_GEOTECHNICAL,
)

# The creation-ordering invariant (owner-locked): a model of kind K may
# only be created when a model of REQUIRED_PARENT_KIND[K] exists in the
# same project and is named as the parent. ``None`` = must have NO
# parent. This is the single source the creation endpoint enforces —
# the column is DB-nullable (geological models share it and have no
# parent) but "not optional for litho/geotech" is enforced here.
REQUIRED_PARENT_KIND: dict[ModelKind, ModelKind | None] = {
    MODEL_KIND_GEOLOGICAL: None,
    MODEL_KIND_LITHOSTRATIGRAPHIC: MODEL_KIND_GEOLOGICAL,
    MODEL_KIND_GEOTECHNICAL: MODEL_KIND_LITHOSTRATIGRAPHIC,
}

# Kinds whose surfaces do NOT obey strict stratigraphic superposition
# (interfingering sand/clay is real geology, not a model error) — the
# crossing validator and Build's auto-age reorder skip these.
NON_STRATIGRAPHIC_KINDS: frozenset[str] = frozenset(
    {MODEL_KIND_LITHOSTRATIGRAPHIC, MODEL_KIND_GEOTECHNICAL}
)
