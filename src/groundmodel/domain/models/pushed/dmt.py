from dataclasses import dataclass
from groundmodel.domain.models.base.insitu_test import InSituTest


@dataclass
class DMT(InSituTest):
    name: str = ""
