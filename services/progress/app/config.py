"""All configuration comes from environment variables; nothing is hardcoded per environment."""

import os
from dataclasses import dataclass

SERVICE_NAME = "progress"


@dataclass(frozen=True)
class Settings:
    database_url: str
    host: str = "0.0.0.0"  # noqa: S104 - inside a container, listening on all interfaces is the point
    port: int = 8000
    # the browser origins allowed to call this API (the UI), comma-separated in env
    allowed_origins: tuple[str, ...] = ("http://localhost:8080",)
    version: str = "dev"
    # startup waits for the database: SQL Server boot or Azure serverless resume
    db_connect_attempts: int = 10
    # where the workouts service lives, and how long to wait for it before giving up
    workouts_url: str = "http://localhost:8001"
    workouts_timeout_s: float = 3.0


def _origins(raw: str) -> tuple[str, ...]:
    return tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())


def load_settings() -> Settings:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        # fail at boot, not on the first request
        raise RuntimeError("DATABASE_URL is not set")
    return Settings(
        database_url=database_url,
        host=os.environ.get("HOST", "0.0.0.0"),  # noqa: S104
        port=int(os.environ.get("PORT", "8000")),
        allowed_origins=_origins(os.environ.get("ALLOWED_ORIGINS", "http://localhost:8080")),
        version=os.environ.get("GIT_SHA", "dev"),
        db_connect_attempts=int(os.environ.get("DB_CONNECT_ATTEMPTS", "10")),
        workouts_url=os.environ.get("WORKOUTS_URL", "http://localhost:8001"),
        workouts_timeout_s=float(os.environ.get("WORKOUTS_TIMEOUT_S", "3")),
    )
