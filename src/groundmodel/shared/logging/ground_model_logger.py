import logging

from groundmodel.shared.logging.levels import SUCCESS, TRACE


class GroundModelLogger:
    """Typed logger wrapper exposing all standard levels plus TRACE and SUCCESS."""

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger

    @property
    def name(self) -> str:
        return self._logger.name

    def trace(self, msg: str, *args: object, **kwargs: object) -> None:
        self._logger.log(TRACE, msg, *args, **kwargs)

    def debug(self, msg: str, *args: object, **kwargs: object) -> None:
        self._logger.debug(msg, *args, **kwargs)

    def info(self, msg: str, *args: object, **kwargs: object) -> None:
        self._logger.info(msg, *args, **kwargs)

    def warning(self, msg: str, *args: object, **kwargs: object) -> None:
        self._logger.warning(msg, *args, **kwargs)

    def error(self, msg: str, *args: object, **kwargs: object) -> None:
        self._logger.error(msg, *args, **kwargs)

    def critical(self, msg: str, *args: object, **kwargs: object) -> None:
        self._logger.critical(msg, *args, **kwargs)

    def success(self, msg: str, *args: object, **kwargs: object) -> None:
        self._logger.log(SUCCESS, msg, *args, **kwargs)

    def exception(self, msg: str, *args: object, **kwargs: object) -> None:
        self._logger.exception(msg, *args, **kwargs)
