"""CPT interpretation use case.

Stub kept as a class so the body can land in Phase 5 without
restructuring the call sites or the logging hierarchy. The
``GroundModelLogger`` base wires the project-standard log
methods (``self.info``, ``self.success``, ``self.debug``, ...) —
matches every other application-layer use case.
"""

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class RunInterpretation(GroundModelLogger):
    """Run EC7 soil classification + Robertson Ic for a stored CPT.

    Phase 5 deliverable. The current stub is a placeholder so the
    class identity, the inheritance, and the call surface are
    already in place — Phase 5 fills in ``execute`` and the
    matching tests without churning callers.
    """

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    async def execute(self, cpt_id: str) -> None:
        """Run interpretation for the CPT identified by ``cpt_id``.

        Parameters
        ----------
        cpt_id : str
            UUID of the CPT to interpret.

        Raises
        ------
        NotImplementedError
            Always — Phase 5 not yet implemented.
        """
        raise NotImplementedError("CPT interpretation is a Phase 5 deliverable")
