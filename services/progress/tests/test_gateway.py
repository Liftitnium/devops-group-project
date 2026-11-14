"""The HTTP seam to the workouts service, with a fake transport: no network needed."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config
from app.errors import NotFoundError, UpstreamError, UpstreamUnavailableError
from app.gateway import HttpWorkoutsGateway
from app.main import create_app


def gateway(handler) -> HttpWorkoutsGateway:
    return HttpWorkoutsGateway("http://workouts.test/", timeout_s=0.5, transport=httpx.MockTransport(handler))


def test_returns_json_on_200_and_passes_params():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(200, json=[{"id": 1}])

    assert gateway(handler).get_json("/workouts", {"exercise_id": 3}) == [{"id": 1}]
    assert seen["url"] == "http://workouts.test/workouts?exercise_id=3"


def test_timeout_becomes_503_with_a_readable_message():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(UpstreamUnavailableError, match="did not answer in time"):
        gateway(handler).get_json("/workouts")


def test_connection_refused_becomes_503():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(UpstreamUnavailableError, match="unavailable"):
        gateway(handler).get_json("/workouts")


@pytest.mark.parametrize("status", [502, 503, 504])
def test_upstream_gateway_errors_become_503(status):
    with pytest.raises(UpstreamUnavailableError):
        gateway(lambda r: httpx.Response(status)).get_json("/workouts")


def test_404_becomes_not_found():
    with pytest.raises(NotFoundError):
        gateway(lambda r: httpx.Response(404)).get_json("/workouts/9")


def test_unexpected_status_becomes_502():
    with pytest.raises(UpstreamError):
        gateway(lambda r: httpx.Response(418)).get_json("/workouts")


def test_upstream_errors_reach_the_client_as_json_not_a_trace():
    app = create_app(config.Settings(database_url="mssql://u:p@127.0.0.1:1/x"))

    def failing(request):
        raise httpx.ConnectError("refused", request=request)

    app.state.workouts = gateway(failing)

    @app.get("/probe")
    def probe():
        return app.state.workouts.get_json("/workouts")

    response = TestClient(app).get("/probe")
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]


def test_load_settings_reads_workouts_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "mssql://u:p@h/db")
    monkeypatch.setenv("WORKOUTS_URL", "http://workouts:8000")
    monkeypatch.setenv("WORKOUTS_TIMEOUT_S", "2.5")
    s = config.load_settings()
    assert (s.workouts_url, s.workouts_timeout_s) == ("http://workouts:8000", 2.5)
