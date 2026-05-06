"""Grain size distribution lab test."""
from dataclasses import dataclass

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class GrainSize(LabTest):
    """Grain size distribution — sieve and hydrometer analysis results."""
    pass
