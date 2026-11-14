"""The seam between the progress and workouts services.

Progress code depends on WorkoutsGateway (a Protocol), never on httpx directly, so unit
tests pass a fake and only this module knows about HTTP. Every call has a timeout, and
every failure becomes a DomainError with a message the UI can show as-is: the user sees
"Progress unavailable", never a stack trace or a request that hangs.
"""

import logging
from typing import Any, Protocol

import httpx

from app.errors import NotFoundError, UpstreamError, UpstreamUnavailableError

log = logging.getLogger(__name__)

UNAVAILABLE = "The workouts service is unavailable right now. Try again shortly."


class WorkoutsGateway(Protocol):
    def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any: ...


class HttpWorkoutsGateway:
    def __init__(self, base_url: str, timeout_s: float, transport: httpx.BaseTransport | None = None):
        # one client for the app's lifetime, so connections are reused
        self._client = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout_s, transport=transport)

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            response = self._client.get(path, params=params)
        except httpx.TimeoutException as e:
            log.warning("workouts service timed out on %s: %s", path, e)
            raise UpstreamUnavailableError(
                "The workouts service did not answer in time. Your workouts are safe; try again shortly."
            ) from e
        except httpx.TransportError as e:
            log.warning("workouts service unreachable on %s: %s", path, e)
            raise UpstreamUnavailableError(UNAVAILABLE) from e

        if response.status_code == 200:
            return response.json()
        if response.status_code == 404:
            raise NotFoundError("not found in the workouts service")
        if response.status_code in (502, 503, 504):
            raise UpstreamUnavailableError(
                "The workouts service is unavailable right now. Try again shortly."
            )
        log.error("workouts service answered %d on %s", response.status_code, path)
        raise UpstreamError(f"the workouts service answered {response.status_code}")

    def close(self) -> None:
        self._client.close()
