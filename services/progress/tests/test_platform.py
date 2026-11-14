"""Health, CORS, logging, config and migrations: the parts every service must get right."""

import io
import json
import logging
from dataclasses import replace

import pymssql
import pytest
from fastapi.testclient import TestClient

from app import config, logs
from app.db import _batches, _connect_args, connect, migrate
from app.main import create_app

UNREACHABLE = "mssql://nobody:nothing@127.0.0.1:1/nowhere"


def offline_app(**overrides):
    """An app whose startup (which needs the database) is never run: no `with` around the client."""
    return create_app(config.Settings(database_url=UNREACHABLE, **overrides))


def test_health_ok_reports_db_and_version(settings):
    with TestClient(create_app(replace(settings, version="abc123"))) as c:
        response = c.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok", "version": "abc123"}


def test_health_503_when_database_unreachable():
    response = TestClient(offline_app()).get("/health")
    assert response.status_code == 503
    assert response.json()["db"] == "unreachable"
    assert set(response.json()) == {"status", "db", "version"}


def test_cors_allows_only_the_ui_origin():
    c = TestClient(offline_app(allowed_origins=("http://localhost:8080",)))
    preflight = {"Access-Control-Request-Method": "GET"}
    ok = c.options("/health", headers={"Origin": "http://localhost:8080", **preflight})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:8080"
    bad = c.options("/health", headers={"Origin": "https://evil.example", **preflight})
    assert "access-control-allow-origin" not in bad.headers


def test_unexpected_error_is_500_without_stack_trace():
    app = offline_app()

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret internals")

    response = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert response.status_code == 500
    assert response.json() == {"detail": "internal error"}


def test_every_request_is_logged_once_as_one_json_line():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logs.JsonFormatter(config.SERVICE_NAME))
    logger = logging.getLogger(config.SERVICE_NAME)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        TestClient(offline_app()).get("/health")
    finally:
        logger.removeHandler(handler)
    lines = [json.loads(line) for line in stream.getvalue().splitlines()]
    requests = [e for e in lines if "duration_ms" in e]
    assert len(requests) == 1
    entry = requests[0]
    assert (entry["method"], entry["path"], entry["status"]) == ("GET", "/health", 503)
    assert entry["service"] == config.SERVICE_NAME
    assert entry["msg"] == "GET /health 503"
    assert entry["duration_ms"] >= 0


def test_configure_installs_a_single_json_handler():
    logs.configure(config.SERVICE_NAME, "info")
    root = logging.getLogger()
    assert len(root.handlers) == 1
    assert isinstance(root.handlers[0].formatter, logs.JsonFormatter)
    assert root.level == logging.INFO


def test_migrations_are_recorded_and_not_rerun(settings, tmp_path):
    (tmp_path / "001_init.sql").write_text("CREATE TABLE t1 (id INT)")
    conn = connect(settings.database_url)
    assert migrate(conn, tmp_path) == ["001_init.sql"]
    assert migrate(conn, tmp_path) == []
    rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    assert [r["version"] for r in rows] == ["001_init.sql"]
    conn.close()


def test_failed_migration_leaves_nothing_behind(settings, tmp_path):
    (tmp_path / "001_ok.sql").write_text("CREATE TABLE ok_table (id INT)")
    (tmp_path / "002_bad.sql").write_text("CREATE TABLE half (id INT)\nGO\nSELECT * FROM missing_table")
    conn = connect(settings.database_url)
    with pytest.raises(pymssql.Error):
        migrate(conn, tmp_path)
    applied = [r["version"] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()]
    assert applied == ["001_ok.sql"]
    assert conn.execute("SELECT OBJECT_ID('half') AS id").fetchone()["id"] is None
    conn.close()


def test_batches_split_on_go_lines():
    assert _batches("A\nGO\n\nB\ngo\n") == ["A", "\nB"]


def test_database_url_parsing():
    args = _connect_args("mssql://app:p%40ss@db.example:14330/thedb")
    assert (args["server"], args["port"], args["user"], args["password"], args["database"]) == (
        "db.example",
        "14330",
        "app",
        "p@ss",
        "thedb",
    )
    with pytest.raises(ValueError):
        _connect_args("postgres://u:p@h/db")


def test_load_settings_reads_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", UNREACHABLE)
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://a.example/, http://b.example")
    monkeypatch.setenv("GIT_SHA", "deadbeef")
    s = config.load_settings()
    assert s.allowed_origins == ("http://a.example", "http://b.example")
    assert (s.version, s.port) == ("deadbeef", 8000)


def test_load_settings_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError):
        config.load_settings()
