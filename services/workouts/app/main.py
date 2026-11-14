"""The workouts service: exercises, workouts and sets, in its own database.

Skeleton: platform only (health, request logging, CORS, migrations on startup, error
mapping). Domain routers are added by including them at the bottom of create_app.
"""

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import SERVICE_NAME, Settings, load_settings
from app.db import check_health, connect, migrate
from app.errors import DomainError

log = logging.getLogger(SERVICE_NAME)
MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        conn = connect(settings.database_url, attempts=settings.db_connect_attempts)
        try:
            migrate(conn, MIGRATIONS_DIR)
        finally:
            conn.close()
        yield

    app = FastAPI(title="Workouts service", version=settings.version, lifespan=lifespan)
    app.state.settings = settings

    # only the UI's origin may call this API from a browser
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            ms = round((time.perf_counter() - start) * 1000, 1)
            log.info(
                "%s %s %d",
                request.method,
                request.url.path,
                status,
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": status,
                    "duration_ms": ms,
                },
            )

    @app.exception_handler(DomainError)
    async def handle_domain_error(request: Request, exc: DomainError):
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception):
        # the stack trace goes to the log, never to the client
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "internal error"})

    @app.get("/health")
    def health():
        try:
            conn = connect(settings.database_url, login_timeout=3)
            try:
                check_health(conn)
            finally:
                conn.close()
        except Exception as e:
            log.warning("health check: database unavailable: %s", e)
            return JSONResponse(
                status_code=503,
                content={"status": "unavailable", "db": "unreachable", "version": settings.version},
            )
        return {"status": "ok", "db": "ok", "version": settings.version}

    # app.include_router(workouts_router)  <- domain routes go here
    return app
