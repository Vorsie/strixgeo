import logging

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.logging.levels import TRACE


class LoggerFactory:
    _handlers_configured = False

    @classmethod
    def get_logger(cls, name: str) -> GroundModelLogger:
        if not cls._handlers_configured:
            cls._configure()
        return GroundModelLogger(logging.getLogger(name))

    @classmethod
    def _configure(cls) -> None:
        logging.basicConfig(
            format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            level=TRACE,
        )
        cls._handlers_configured = True
