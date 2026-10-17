"""Logger factory — configures Python logging once and vends GroundModelLogger."""

import logging

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.logging.levels import TRACE


class LoggerFactory:
    """Singleton configurator — call get_logger() everywhere; configure() runs once."""

    _handlers_configured = False

    @classmethod
    def get_logger(cls, name: str) -> GroundModelLogger:
        """Configure logging if needed and return a GroundModelLogger for name."""
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
            format=(
                "%(asctime)s | %(levelname)-8s | %(name)s | %(filename)s:%(lineno)d | %(message)s"
            ),
            level=level,
        )
        cls._handlers_configured = True
