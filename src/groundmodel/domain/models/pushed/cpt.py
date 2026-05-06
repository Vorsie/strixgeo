"""Cone Penetration Test (CPT) domain model."""
from dataclasses import dataclass

from groundmodel.domain.models.base.insitu_test import InSituTest


@dataclass
class CPT(InSituTest):
    """CPT — location, cone properties, and link to raw depth series."""
    name: str = ""
    water_depth_m: float | None = None
    cone_area_ratio: float | None = None
