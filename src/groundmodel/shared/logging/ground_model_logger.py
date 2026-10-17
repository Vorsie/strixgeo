"""Typed logger wrapper adding TRACE and SUCCESS levels."""

import logging

from groundmodel.shared.logging.levels import SUCCESS, TRACE

_STACKLEVEL = 2  # frames between user call site and the stdlib logger call


class GroundModelLogger:
    """Typed logger wrapper exposing all standard levels plus TRACE and SUCCESS.

    Can be used directly via LoggerFactory.get_logger(), or subclassed — subclasses
    call ``super().__init__(__name__)`` and gain all log methods on ``self``.
    """

    def __init__(self, logger: logging.Logger | str) -> None:
        self._logger = logging.getLogger(logger) if isinstance(logger, str) else logger

    @property
    def name(self) -> str:
        """Return the underlying logger name."""
        return self._logger.name

    def trace(self, msg: str, *args: object, **kwargs: object) -> None:
        """Log at TRACE (5) level."""
        self._logger.log(TRACE, msg, *args, stacklevel=_STACKLEVEL, **kwargs)

    def debug(self, msg: str, *args: object, **kwargs: object) -> None:
        """Log at DEBUG (10) level."""
        self._logger.debug(msg, *args, stacklevel=_STACKLEVEL, **kwargs)

    def info(self, msg: str, *args: object, **kwargs: object) -> None:
        """Log at INFO (20) level."""
        self._logger.info(msg, *args, stacklevel=_STACKLEVEL, **kwargs)

    def warning(self, msg: str, *args: object, **kwargs: object) -> None:
        """Log at WARNING (30) level."""
        self._logger.warning(msg, *args, stacklevel=_STACKLEVEL, **kwargs)

    def error(self, msg: str, *args: object, **kwargs: object) -> None:
        """Log at ERROR (40) level."""
        self._logger.error(msg, *args, stacklevel=_STACKLEVEL, **kwargs)

    def critical(self, msg: str, *args: object, **kwargs: object) -> None:
        """Log at CRITICAL (50) level."""
        self._logger.critical(msg, *args, stacklevel=_STACKLEVEL, **kwargs)

    def success(self, msg: str, *args: object, **kwargs: object) -> None:
        """Log at SUCCESS (25) level."""
        self._logger.log(SUCCESS, msg, *args, stacklevel=_STACKLEVEL, **kwargs)

    def exception(self, msg: str, *args: object, **kwargs: object) -> None:
        """Log at ERROR level with exception traceback."""
        self._logger.exception(msg, *args, stacklevel=_STACKLEVEL, **kwargs)
