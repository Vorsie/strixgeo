class GroundModelError(Exception):
    pass


class ParseError(GroundModelError):
    pass


class DomainValidationError(GroundModelError):
    pass


class NotFoundError(GroundModelError):
    pass


class RepositoryError(GroundModelError):
    pass
