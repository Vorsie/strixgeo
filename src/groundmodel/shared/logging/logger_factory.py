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
        from groundmodel.shared.config import settings  # late import avoids circular dependency

        level = logging.getLevelName(settings.log_level.upper())
        if not isinstance(level, int):
            level = TRACE  # fall back to TRACE if the value in .env is invalid

        logging.basicConfig(
            format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            level=level,
        )
        cls._handlers_configured = True
