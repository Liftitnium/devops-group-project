"""Goals (#21) end to end over HTTP against a real SQL Server, with a fake workouts service."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.errors import NotFoundError, UpstreamUnavailableError
from app.main import create_app

NEXT_MONTH = (date.today() + timedelta(days=30)).isoformat()
BENCH = {"id": 3, "name": "Bench press", "body_part": "upper", "rep_range_min": 8, "rep_range_max": 12}
GOAL = {"exercise_id": 3, "target_weight_kg": 60, "target_reps": 8, "target_date": NEXT_MONTH}


class FakeWorkouts:
    """Stands in for the workouts service: knows exercise 3 and its history, or is down."""

    def __init__(self):
        self.down = False
        self.sessions = []

    def get_json(self, path, params=None):
        if self.down:
            raise UpstreamUnavailableError(
                "The workouts service is unavailable right now. Try again shortly."
            )
        if path == "/exercises/3":
            return BENCH
        if path == "/exercises/3/history":
            return {"exercise": BENCH, "sessions": self.sessions}
        raise NotFoundError("not found in the workouts service")

    def close(self):
        pass


@pytest.fixture
def workouts():
    return FakeWorkouts()


@pytest.fixture
def client(settings, workouts):
    app = create_app(settings)
    app.state.workouts = workouts
    with TestClient(app) as c:
        yield c


def make_goal(client, **overrides):
    response = client.post("/goals", json={**GOAL, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


# ---------- CRUD ----------


def test_goal_crud_round_trip(client):
    created = make_goal(client)
    assert created == {"id": created["id"], **GOAL}

    assert client.get(f"/goals/{created['id']}").json() == created
    assert client.get("/goals").json() == [created]

    updated = client.put(f"/goals/{created['id']}", json={**GOAL, "target_weight_kg": 62.5})
    assert updated.status_code == 200
    assert updated.json()["target_weight_kg"] == 62.5  # DECIMAL(6,2) keeps the half kilo

    assert client.delete(f"/goals/{created['id']}").status_code == 204
    assert client.get(f"/goals/{created['id']}").status_code == 404


def test_list_is_ordered_by_deadline_and_filters_by_exercise(client):
    later = make_goal(client)
    sooner = make_goal(client, target_date=date.today().isoformat())
    assert [g["id"] for g in client.get("/goals").json()] == [sooner["id"], later["id"]]
    assert client.get("/goals", params={"exercise_id": 3}).status_code == 200
    assert client.get("/goals", params={"exercise_id": 99}).json() == []


def test_missing_goal_is_404_on_every_route(client):
    assert client.get("/goals/999").json() == {"detail": "Goal 999 not found."}
    assert client.put("/goals/999", json=GOAL).status_code == 404
    assert client.delete("/goals/999").status_code == 404
    assert client.get("/goals/999/progress").status_code == 404


# ---------- validation ----------


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("target_weight_kg", 0),
        ("target_weight_kg", 1001),
        ("target_weight_kg", 60.125),
        ("target_reps", 0),
        ("target_date", "next week"),
        ("exercise_id", 0),
    ],
)
def test_invalid_fields_are_422_naming_the_field(client, field, value):
    response = client.post("/goals", json={**GOAL, field: value})
    assert response.status_code == 422
    assert response.json()["detail"].startswith(field)


def test_new_goal_in_the_past_is_422_but_an_old_goal_can_be_edited(client):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    response = client.post("/goals", json={**GOAL, "target_date": yesterday})
    assert response.status_code == 422
    assert response.json() == {"detail": "target_date must be today or later."}

    goal = make_goal(client)
    assert client.put(f"/goals/{goal['id']}", json={**GOAL, "target_date": yesterday}).status_code == 200


def test_unknown_exercise_is_422(client):
    response = client.post("/goals", json={**GOAL, "exercise_id": 42})
    assert response.status_code == 422
    assert response.json() == {"detail": "Exercise 42 does not exist."}


# ---------- how close am I ----------


def test_progress_uses_the_best_set_with_enough_reps(client, workouts):
    goal = make_goal(client)
    workouts.sessions = [
        {
            "workout_id": 2,
            "performed_on": "2026-11-17",
            "sets": [{"set_number": 1, "weight_kg": 70, "reps": 5}],
        },
        {
            "workout_id": 1,
            "performed_on": "2026-11-12",
            "sets": [{"set_number": 1, "weight_kg": 54, "reps": 9}],
        },
    ]
    body = client.get(f"/goals/{goal['id']}/progress").json()
    assert body["exercise_name"] == "Bench press"
    assert (body["best_weight_kg"], body["best_on"], body["percent"], body["achieved"]) == (
        54.0,
        "2026-11-12",
        90,
        False,
    )
    assert body["days_left"] == 30


def test_progress_with_no_history_is_zero(client):
    goal = make_goal(client)
    body = client.get(f"/goals/{goal['id']}/progress").json()
    assert (body["best_weight_kg"], body["percent"], body["achieved"]) == (None, 0, False)


# ---------- workouts down: partial failure ----------


def test_crud_keeps_working_when_workouts_is_down(client, workouts):
    goal = make_goal(client)
    workouts.down = True
    assert client.get("/goals").status_code == 200
    assert client.get(f"/goals/{goal['id']}").status_code == 200
    assert client.put(f"/goals/{goal['id']}", json={**GOAL, "target_reps": 6}).status_code == 200
    assert client.delete(f"/goals/{goal['id']}").status_code == 204


def test_progress_and_create_are_503_with_a_readable_message_when_workouts_is_down(client, workouts):
    goal = make_goal(client)
    workouts.down = True
    for response in (client.get(f"/goals/{goal['id']}/progress"), client.post("/goals", json=GOAL)):
        assert response.status_code == 503
        assert "unavailable" in response.json()["detail"]
