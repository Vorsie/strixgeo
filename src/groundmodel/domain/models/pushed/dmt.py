"""Flat Dilatometer Test (DMT) domain model."""
from dataclasses import dataclass

from groundmodel.domain.models.base.insitu_test import InSituTest


@dataclass
class DMT(InSituTest):
    """Flat Dilatometer Test — pushed-in, measures lateral stress and stiffness."""
    name: str = ""
